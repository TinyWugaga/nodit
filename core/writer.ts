import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  CARD_KINDS,
  FIELD_SCHEMA,
  formatId,
  ID_RULES,
  idNumber,
  isStatus,
  LINK_FIELD,
  LINK_SCHEMA,
  MANAGED_SECTIONS,
  PRIORITIES,
  STATUSES,
  type CardKind,
  type LinkKind,
} from './domain'
import type { NoditConfig } from './config'
import { EditError, renderDoc, setFields } from './edit'
import { splitDoc } from './frontmatter'
import type { Owner } from './owner'
import { parseDoc, revisionOf, sha1, type ParsedDoc } from './parse'
import type { Diagnostic, FieldPatch } from './protocol'
import { scanDocs, TMP_MARK } from './scan'
import { resolveInScope } from './scope'
import { readSections, replaceSection } from './sections'

export class ConflictError extends Error {
  constructor(public current: ParsedDoc | null) {
    super('文件已在磁碟上被修改')
  }
}

export class ValidationError extends Error {
  constructor(public diagnostics: Diagnostic[]) {
    super(diagnostics[0]?.message ?? '驗證失敗')
  }
}

export type LinkChange = { rel: LinkKind; to: string }

export type InitOps = {
  read: (rel: string) => Promise<Buffer | null>
  /** atomic replace of an existing (or missing) file */
  replace: (rel: string, text: string) => Promise<void>
  /** exclusive create; fails with EEXIST if the file appeared meanwhile */
  create: (rel: string, text: string) => Promise<void>
  mkdir: (rel: string) => Promise<void>
}

export type DocPatch = { fields?: FieldPatch; sections?: Record<string, string> }

export type NewCard = {
  type: CardKind
  title: string
  fields?: FieldPatch
  sections?: Record<string, string>
  links?: LinkChange[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function invalid(doc: Pick<ParsedDoc, 'docKey' | 'path'> | null, code: string, message: string): Diagnostic {
  return { level: 'error', code, message, docKey: doc?.docKey, path: doc?.path }
}

function validateFields(kind: CardKind, doc: ParsedDoc | null, patch: FieldPatch): Diagnostic[] {
  const schema = FIELD_SCHEMA[kind]
  const out: Diagnostic[] = []
  for (const [key, value] of Object.entries(patch)) {
    const type = schema[key]
    if (!type) out.push(invalid(doc, 'field-unknown', `不能透過欄位 API 修改 ${key}`))
    else if (value === null || value === '') {
      if (key === 'title' || key === 'status') out.push(invalid(doc, 'field-required', `${key} 不能是空的`))
    } else if (typeof value !== 'string') out.push(invalid(doc, 'field-type', `${key} 必須是字串`))
    else if (type === 'status' && !isStatus(kind, value)) out.push(invalid(doc, 'status-invalid', `status 不合法：${value}`))
    else if (type === 'priority' && !(PRIORITIES as readonly string[]).includes(value)) out.push(invalid(doc, 'priority-invalid', `priority 不合法：${value}`))
    else if (type === 'date' && !DATE.test(value)) out.push(invalid(doc, 'date-format', `${key} 應為 YYYY-MM-DD`))
    else if (key === 'title' && !value.trim()) out.push(invalid(doc, 'title-missing', 'title 不能是空白'))
  }
  return out
}

function normalizeFields(patch: FieldPatch): Record<string, string | null> {
  return Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === '' ? null : v]))
}

export function slugify(title: string) {
  const ascii = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return ascii || 'card'
}

/**
 * Single write queue for one project. Every write re-reads the file, compares the base revision,
 * validates the result, writes a temp file in the same directory and renames it into place.
 */
export class Writer {
  private chain: Promise<unknown> = Promise.resolve()

  private getConfig: () => NoditConfig

  /**
   * `configProblems` returns the reasons the config must not be written against (an unreadable
   * or invalid nodit.config.json that was never accepted). Every queued write checks it, so the
   * server, offline CLI, init and import share one gate.
   */
  constructor(
    private root: string,
    config: NoditConfig | (() => NoditConfig),
    private owner: Owner,
    private configProblems: () => Diagnostic[] = () => [],
  ) {
    this.getConfig = typeof config === 'function' ? config : () => config
  }

  private get config() {
    return this.getConfig()
  }

  /**
   * Run a multi-file job (init) inside the same queue. Every path is checked against `allowed`.
   */
  exclusive<T>(allowed: string[], job: (ops: InitOps) => Promise<T>): Promise<T> {
    return this.enqueue(() => {
      const ops: InitOps = {
        read: async (rel) => {
          const abs = await resolveInScope(this.root, rel, allowed)
          try {
            return await readFile(abs)
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
            throw err
          }
        },
        replace: async (rel, text) => this.atomicWrite(await resolveInScope(this.root, rel, allowed), text),
        create: async (rel, text) => {
          const abs = await resolveInScope(this.root, rel, allowed)
          await mkdir(path.dirname(abs), { recursive: true })
          await resolveInScope(this.root, rel, allowed)
          this.owner.assertWritable()
          await writeFile(abs, text, { flag: 'wx' })
        },
        mkdir: async (rel) => {
          const abs = await resolveInScope(this.root, rel, allowed)
          this.owner.assertWritable()
          await mkdir(abs, { recursive: true })
        },
      }
      return job(ops)
    })
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(() => {
      this.owner.assertWritable()
      const problems = this.configProblems()
      if (problems.length) throw new ValidationError(problems)
      return job()
    })
    this.chain = run.catch(() => {})
    return run
  }

  private cardDirs() {
    return CARD_KINDS.map((k) => this.config.paths[k])
  }

  private async atomicWrite(abs: string, text: string) {
    await mkdir(path.dirname(abs), { recursive: true })
    const tmp = path.join(path.dirname(abs), `${TMP_MARK}${path.basename(abs)}.${randomBytes(4).toString('hex')}`)
    await writeFile(tmp, text, { flag: 'wx' })
    try {
      this.owner.assertWritable()
      await rename(tmp, abs)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
  }

  private async readCurrent(doc: Pick<ParsedDoc, 'path' | 'kind'>, baseRevision: string) {
    const abs = await resolveInScope(this.root, doc.path, this.cardDirs())
    let buf: Buffer
    try {
      buf = await readFile(abs)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new ConflictError(null)
      throw err
    }
    const current = parseDoc(doc.path, buf, doc.kind)
    if (revisionOf(buf) !== baseRevision) throw new ConflictError(current)
    return { abs, buf, current, raw: buf.toString('utf8') }
  }

  /** ids used by every other card document currently on disk (includes files written by AI or humans) */
  private async idsInUse(excludePath?: string) {
    const docs = await scanDocs(this.root, this.config)
    return new Map(docs.filter((d) => d.card && d.path !== excludePath).map((d) => [d.card!.id, d.path]))
  }

  private async finish(abs: string, pathRel: string, kind: CardKind, raw: string, next: string, current: ParsedDoc) {
    if (next === raw) return { doc: current, changed: false }
    const parsed = parseDoc(pathRel, Buffer.from(next, 'utf8'), kind)
    const errors = parsed.diagnostics.filter((d) => d.level === 'error')
    if (errors.length) throw new ValidationError(errors)
    await this.atomicWrite(abs, next)
    return { doc: parsed, changed: true }
  }

  updateDoc(doc: ParsedDoc, baseRevision: string, patch: DocPatch): Promise<{ doc: ParsedDoc; changed: boolean }> {
    return this.enqueue(async () => {
      const { abs, current, raw } = await this.readCurrent(doc, baseRevision)
      if (!current.writable) throw new ValidationError(current.diagnostics.filter((d) => d.level === 'error'))

      const problems = validateFields(doc.kind, current, patch.fields ?? {})
      const managed = MANAGED_SECTIONS[doc.kind]
      for (const name of Object.keys(patch.sections ?? {})) {
        if (!managed.includes(name)) problems.push(invalid(current, 'section-unknown', `${name} 不是受管段落`))
        else if (current.sectionStates[name]?.state === 'duplicate') {
          problems.push(invalid(current, 'section-duplicate', `## ${name} 出現多次，請改用 raw 編輯`))
        } else if (current.sectionStates[name]?.state !== 'ok') {
          problems.push(invalid(current, 'section-missing', `找不到 ## ${name}，請改用 raw 編輯新增`))
        }
      }
      if (problems.length) throw new ValidationError(problems)

      let next = raw
      const eol = splitDoc(raw).eol
      for (const [name, text] of Object.entries(patch.sections ?? {})) {
        const split = splitDoc(next)
        const state = readSections(next, split.bodyStart, [name])[name]
        if (state.state === 'ok') next = replaceSection(next, state, text, eol)
      }
      try {
        if (patch.fields && Object.keys(patch.fields).length) next = setFields(next, normalizeFields(patch.fields))
      } catch (err) {
        if (err instanceof EditError) throw new ValidationError([invalid(current, 'edit-failed', err.message)])
        throw err
      }
      return this.finish(abs, doc.path, doc.kind, raw, next, current)
    })
  }

  /** Replace the whole file. Refuses anything that would not parse cleanly or would duplicate an id. */
  writeRaw(doc: Pick<ParsedDoc, 'path' | 'kind' | 'docKey'>, baseRevision: string, text: string) {
    return this.enqueue(async () => {
      const { abs, current, raw } = await this.readCurrent(doc, baseRevision)
      const parsed = parseDoc(doc.path, Buffer.from(text, 'utf8'), doc.kind)
      const errors = parsed.diagnostics.filter((d) => d.level === 'error')
      if (parsed.legacy) errors.push(invalid(doc, 'frontmatter-required', '存檔內容必須包含 frontmatter'))
      if (parsed.card) {
        const taken = (await this.idsInUse(doc.path)).get(parsed.card.id)
        if (taken) errors.push(invalid(doc, 'id-duplicate', `ID ${parsed.card.id} 已被 ${taken} 使用`))
      }
      if (errors.length) throw new ValidationError(errors)
      return this.finish(abs, doc.path, doc.kind, raw, text, current)
    })
  }

  patchLinks(doc: ParsedDoc, baseRevision: string, change: { add?: LinkChange[]; remove?: LinkChange[] }) {
    return this.enqueue(async () => {
      const { abs, current, raw } = await this.readCurrent(doc, baseRevision)
      if (!current.writable || !current.card) throw new ValidationError(current.diagnostics.filter((d) => d.level === 'error'))
      const schema = LINK_SCHEMA[doc.kind]
      const links = current.card.links
      const lists: Record<string, string[]> = {
        implements: [...links.implements],
        depends: [...links.depends],
        supersedes: [...links.supersedes],
        relates: [...links.relates],
      }
      let milestone = links.milestone ?? null
      const problems: Diagnostic[] = []
      for (const r of change.remove ?? []) {
        if (r.rel === 'part-of') {
          if (milestone === r.to) milestone = null
        } else if (lists[LINK_FIELD[r.rel]]) lists[LINK_FIELD[r.rel]] = lists[LINK_FIELD[r.rel]].filter((x) => x !== r.to)
      }
      for (const a of change.add ?? []) {
        const rule = schema[a.rel]
        if (!rule) {
          problems.push(invalid(current, 'link-unsupported', `${doc.kind} 不能有 ${a.rel} 關聯`))
          continue
        }
        if (a.to === current.card.id) {
          problems.push(invalid(current, 'link-self', '不能連到自己'))
          continue
        }
        if (rule.single) milestone = a.to
        else if (!lists[LINK_FIELD[a.rel]].includes(a.to)) lists[LINK_FIELD[a.rel]].push(a.to)
      }
      if (problems.length) throw new ValidationError(problems)

      const fields: Record<string, string | string[] | null> = {}
      for (const rel of Object.keys(schema) as LinkKind[]) {
        const field = LINK_FIELD[rel]
        if (rel === 'part-of') {
          if ((links.milestone ?? null) !== milestone) fields[field] = milestone
          continue
        }
        const before = (links as unknown as Record<string, string[]>)[field]
        const after = lists[field]
        if (before.join('\n') !== after.join('\n')) fields[field] = after.length ? after : null
      }
      if (!Object.keys(fields).length) return { doc: current, changed: false }
      return this.finish(abs, doc.path, doc.kind, raw, setFields(raw, fields), current)
    })
  }

  deleteDoc(doc: Pick<ParsedDoc, 'path' | 'kind'>, baseRevision: string) {
    return this.enqueue(async () => {
      const { abs } = await this.readCurrent(doc, baseRevision)
      this.owner.assertWritable()
      await unlink(abs)
    })
  }

  /** Allocate the next id inside the queue (max on disk + 1) and create the file exclusively. */
  createCard(input: NewCard): Promise<ParsedDoc> {
    return this.enqueue(async () => {
      const kind = input.type
      if (!CARD_KINDS.includes(kind)) throw new ValidationError([invalid(null, 'type-invalid', `type 不合法：${String(kind)}`)])
      const fields: FieldPatch = { title: input.title, status: STATUSES[kind][0], ...input.fields }
      const problems = validateFields(kind, null, fields)
      for (const l of input.links ?? []) {
        if (!LINK_SCHEMA[kind][l.rel]) problems.push(invalid(null, 'link-unsupported', `${kind} 不能有 ${l.rel} 關聯`))
      }
      if (problems.length) throw new ValidationError(problems)

      const used = await this.idsInUse()
      let max = 0
      for (const id of used.keys()) {
        if (ID_RULES[kind].pattern.test(id)) max = Math.max(max, idNumber(id) ?? 0)
      }
      const id = formatId(kind, max + 1)
      const rel = path.posix.join(this.config.paths[kind], `${id}-${slugify(input.title)}.md`)
      const abs = await resolveInScope(this.root, rel, this.cardDirs())

      const linkFields: Record<string, string | string[]> = {}
      for (const l of input.links ?? []) {
        const field = LINK_FIELD[l.rel]
        if (l.rel === 'part-of') linkFields[field] = l.to
        else linkFields[field] = [...((linkFields[field] as string[]) ?? []), l.to]
      }
      const clean = Object.fromEntries(Object.entries(normalizeFields(fields)).filter(([, v]) => v !== null)) as Record<string, string>
      const text = renderDoc({
        kind,
        fields: { id, type: kind, ...clean, ...linkFields },
        sections: input.sections,
      })
      const parsed = parseDoc(rel, Buffer.from(text, 'utf8'), kind)
      const errors = parsed.diagnostics.filter((d) => d.level === 'error')
      if (errors.length) throw new ValidationError(errors)

      await mkdir(path.dirname(abs), { recursive: true })
      await resolveInScope(this.root, rel, this.cardDirs())
      this.owner.assertWritable()
      await writeFile(abs, text, { flag: 'wx' })
      return parsed
    })
  }

  /** Layout file; `absent` as base means the file must not exist yet. */
  writeLayout(baseRevision: string, data: Record<string, { x: number; y: number }>) {
    return this.enqueue(async () => {
      const rel = this.config.paths.layout
      const abs = await resolveInScope(this.root, rel, [rel])
      let current = 'absent'
      try {
        current = sha1(await readFile(abs))
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      if (current !== baseRevision) throw new ConflictError(null)
      const clean: Record<string, { x: number; y: number }> = {}
      for (const [id, p] of Object.entries(data)) {
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) clean[id] = { x: Math.round(p.x), y: Math.round(p.y) }
      }
      const text = JSON.stringify(clean, null, 2) + '\n'
      await this.atomicWrite(abs, text)
      return { revision: sha1(Buffer.from(text, 'utf8')), data: clean }
    })
  }
}
