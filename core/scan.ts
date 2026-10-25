import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { CARD_KINDS, LINK_FIELD, type CardKind } from './domain'
import type { NoditConfig } from './config'
import { docKeyOf, parseDoc, sha1, type ParsedDoc } from './parse'
import type { ClientReview, Diagnostic } from './protocol'
import { parseReview } from './review'
import { resolveReadable, ScopeError } from './scope'

export const TMP_MARK = '.nodit-tmp-'

async function listMarkdown(root: string, rel: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = (await readdir(path.join(root, rel), { recursive: true })) as string[]
  } catch (err) {
    // a missing folder is empty; any other failure must not look like "all cards were deleted"
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return entries
    .map((e) => e.split(path.sep).join('/'))
    .filter((e) => e.endsWith('.md') && !e.split('/').some((seg) => seg.startsWith('.')))
    .map((e) => path.posix.join(rel, e))
    .sort()
}

export function kindForPath(config: NoditConfig, rel: string): CardKind | undefined {
  return CARD_KINDS.find((k) => rel.startsWith(config.paths[k].replace(/\/$/, '') + '/'))
}

export async function readDoc(root: string, rel: string, kind: CardKind): Promise<ParsedDoc | null> {
  try {
    return parseDoc(rel, await readFile(await resolveReadable(root, rel)), kind)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (err instanceof ScopeError) return unreadableDoc(rel, kind, 'path-outside', err.message)
    return unreadableDoc(rel, kind, 'read-failed', `無法讀取檔案：${(err as Error).message}`)
  }
}

/** Placeholder for a file that cannot be read (or must not be): listed with a diagnostic only. */
function unreadableDoc(rel: string, kind: CardKind, code: string, message: string): ParsedDoc {
  const docKey = docKeyOf(rel)
  return {
    docKey,
    path: rel,
    kind,
    revision: code,
    sectionStates: {},
    sections: {},
    diagnostics: [{ level: 'error', code, message, docKey, path: rel }],
    legacy: false,
    inferred: [],
    writable: false,
  }
}

export async function scanDocs(root: string, config: NoditConfig): Promise<ParsedDoc[]> {
  const docs: ParsedDoc[] = []
  for (const kind of CARD_KINDS) {
    for (const rel of await listMarkdown(root, config.paths[kind])) {
      const doc = await readDoc(root, rel, kind)
      if (doc) docs.push(doc)
    }
  }
  return docs
}

export async function scanReviews(root: string, config: NoditConfig): Promise<ClientReview[]> {
  const out: ClientReview[] = []
  for (const rel of await listMarkdown(root, config.paths.review)) {
    try {
      out.push(parseReview(rel, await readFile(await resolveReadable(root, rel))))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      const message = err instanceof ScopeError ? err.message : `無法讀取檔案：${(err as Error).message}`
      out.push({
        docKey: docKeyOf(rel),
        path: rel,
        revision: 'unreadable',
        targets: [],
        body: '',
        diagnostics: [{ level: 'error', code: 'read-failed', message, path: rel }],
        writable: false,
      })
    }
  }
  return out
}

/**
 * Project-wide checks that depend on more than one document. Returns the docs with
 * cross-document diagnostics folded in (duplicate ids also disable metadata writes).
 */
export function crossValidate(docs: ParsedDoc[]): { docs: ParsedDoc[]; diagnostics: Diagnostic[] } {
  const byId = new Map<string, ParsedDoc[]>()
  for (const d of docs) {
    if (!d.card) continue
    const list = byId.get(d.card.id) ?? []
    list.push(d)
    byId.set(d.card.id, list)
  }
  const diagnostics: Diagnostic[] = []
  const supersededBy = new Map<string, string[]>()
  for (const d of docs) {
    if (d.card?.type !== 'adr') continue
    for (const old of d.card.links.supersedes) supersededBy.set(old, [...(supersededBy.get(old) ?? []), d.card.id])
  }
  const out = docs.map((d) => {
    const extra: Diagnostic[] = []
    const by = d.card && supersededBy.get(d.card.id)
    if (d.card?.type === 'adr' && by && d.card.status !== 'superseded') {
      extra.push({
        level: 'warning',
        code: 'supersede-status',
        message: `已被 ${by.join('、')} 取代，但 status 仍是 ${d.card.status}`,
        docKey: d.docKey,
        path: d.path,
      })
    }
    if (d.card) {
      const dupes = byId.get(d.card.id)!
      if (dupes.length > 1) {
        extra.push({
          level: 'error',
          code: 'id-duplicate',
          message: `ID ${d.card.id} 重複：${dupes.map((x) => x.path).join('、')}`,
          docKey: d.docKey,
          path: d.path,
        })
      }
      const l = d.card.links
      const refs: [string, string][] = [
        ...l.implements.map((t) => [LINK_FIELD.implements, t] as [string, string]),
        ...l.depends.map((t) => [LINK_FIELD.depends, t] as [string, string]),
        ...l.supersedes.map((t) => [LINK_FIELD.supersedes, t] as [string, string]),
        ...l.relates.map((t) => [LINK_FIELD.relates, t] as [string, string]),
        ...(l.milestone ? [[LINK_FIELD['part-of'], l.milestone] as [string, string]] : []),
      ]
      for (const [field, target] of refs) {
        if (!byId.has(target)) {
          extra.push({ level: 'warning', code: 'link-dangling', message: `${field} 指向不存在的 ${target}`, docKey: d.docKey, path: d.path })
        }
      }
    }
    if (!extra.length) return d
    diagnostics.push(...extra)
    return {
      ...d,
      diagnostics: [...d.diagnostics, ...extra],
      writable: d.writable && !extra.some((x) => x.level === 'error'),
    }
  })
  return { docs: out, diagnostics }
}

export type LayoutFile = { revision: string; data: Record<string, { x: number; y: number }> }

export async function readLayout(root: string, rel: string): Promise<{ layout: LayoutFile; diagnostics: Diagnostic[] }> {
  let buf: Buffer
  try {
    buf = await readFile(await resolveReadable(root, rel))
  } catch (err) {
    const diagnostics: Diagnostic[] =
      err instanceof ScopeError ? [{ level: 'error', code: 'path-outside', message: err.message, path: rel }] : []
    return { layout: { revision: 'absent', data: {} }, diagnostics }
  }
  try {
    const data = JSON.parse(buf.toString('utf8'))
    return { layout: { revision: sha1(buf), data: data && typeof data === 'object' ? data : {} }, diagnostics: [] }
  } catch {
    return {
      layout: { revision: sha1(buf), data: {} },
      diagnostics: [{ level: 'warning', code: 'layout-invalid', message: `${rel} 不是有效的 JSON，座標改用自動排列`, path: rel }],
    }
  }
}
