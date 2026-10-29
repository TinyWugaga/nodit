import { createHash } from 'node:crypto'
import path from 'node:path'
import { isMap, isScalar, parseDocument } from 'yaml'
import {
  formatId,
  ID_PREFIX_SOURCE,
  ID_RULES,
  isStatus,
  kindOfId,
  LINK_FIELD,
  LINK_SCHEMA,
  MANAGED_SECTIONS,
  PRIORITIES,
  STATUSES,
  type CardKind,
  type CardLinks,
  type CardRecord,
  type LinkKind,
} from './domain'
import { splitDoc } from './frontmatter'
import type { ClientDoc, Diagnostic, SectionView } from './protocol'
import { findHeadings, readSections, type SectionState } from './sections'

/**
 * `blob` is the SHA-1 git blob hash of the file, compared against a review's `target_rev`;
 * `bodyBlob` hashes only the body, compared against a spec's `adr_rev`. Both stay on the server.
 */
export type ParsedDoc = ClientDoc & { sectionStates: Record<string, SectionState>; blob?: string; bodyBlob?: string }

export function sha1(data: string | Buffer) {
  return createHash('sha1').update(data).digest('hex')
}

/** SHA-1 git blob hash (`git hash-object` in a SHA-1 repository), independent of any repository setting. */
export function gitBlobHash(buf: Buffer) {
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

/**
 * Git blob hash of the raw bytes after the frontmatter's closing fence, or of the whole file when it
 * has no (terminated) frontmatter. Frontmatter edits such as status, date or relates do not change it.
 */
export function bodyBlobHash(buf: Buffer) {
  const split = splitDoc(buf.toString('utf8'))
  if (!split.fm) return gitBlobHash(buf)
  return gitBlobHash(buf.subarray(Buffer.byteLength(split.raw.slice(0, split.bodyStart), 'utf8')))
}

export function docKeyOf(relPath: string) {
  return sha1('doc:' + relPath).slice(0, 12)
}

export function revisionOf(buf: Buffer) {
  return sha1(buf)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const BLOB = /^[0-9a-f]{40}$/
const FILE_ID = new RegExp(`^(${ID_PREFIX_SOURCE})-(\\d+)`, 'i')
const TITLE_ID = new RegExp(`^(${ID_PREFIX_SOURCE})?-?\\d+\\s*[—:-]\\s*`, 'i')

function toView(s: SectionState): SectionView {
  return s.state === 'ok' ? { state: 'ok', text: s.text } : s
}

function strList(v: unknown): string[] | null {
  if (v === undefined || v === null) return []
  if (typeof v === 'string') return [v]
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v
  return null
}

function inferIdFromFilename(file: string, kind: CardKind): string | undefined {
  const base = path.posix.basename(file)
  const explicit = FILE_ID.exec(base)
  if (explicit) {
    const k = kindOfId(`${explicit[1].toUpperCase()}-${explicit[2].padStart(ID_RULES[kind].pad, '0')}`)
    if (k === kind) return formatId(kind, Number(explicit[2]))
  }
  const numeric = /^(\d+)[-_ ]/.exec(base)
  return numeric ? formatId(kind, Number(numeric[1])) : undefined
}

export function parseDoc(relPath: string, buf: Buffer, kind: CardKind): ParsedDoc {
  const raw = buf.toString('utf8')
  const docKey = docKeyOf(relPath)
  const diagnostics: Diagnostic[] = []
  const diag = (level: Diagnostic['level'], code: string, message: string) =>
    diagnostics.push({ level, code, message, docKey, path: relPath })
  const split = splitDoc(raw)
  const sectionStates = readSections(raw, split.bodyStart, MANAGED_SECTIONS[kind])
  const base = {
    docKey,
    path: relPath,
    kind,
    revision: revisionOf(buf),
    blob: gitBlobHash(buf),
    bodyBlob: bodyBlobHash(buf),
    sectionStates,
    sections: Object.fromEntries(Object.entries(sectionStates).map(([k, v]) => [k, toView(v)])),
    diagnostics,
    inferred: [] as string[],
  }

  if (split.unterminated) {
    diag('error', 'frontmatter-unterminated', 'frontmatter 缺少結尾的 ---')
    return { ...base, legacy: false, writable: false }
  }

  if (!split.fm) {
    const id = inferIdFromFilename(relPath, kind)
    const h1 = findHeadings(raw.slice(split.bodyStart), split.bodyStart).find((h) => h.level === 1)
    const title = h1?.name.replace(TITLE_ID, '') || path.posix.basename(relPath, '.md')
    diag('warning', 'legacy', '沒有 frontmatter：以唯讀顯示，欄位為推測值')
    const card: CardRecord | undefined = id
      ? { id, type: kind, title, status: STATUSES[kind][0], links: { implements: [], depends: [], supersedes: [], relates: [] } }
      : undefined
    if (!id) diag('error', 'id-missing', '無法從檔名推測 ID')
    return { ...base, card, legacy: true, inferred: ['id', 'title', 'status'], writable: false }
  }

  const doc = parseDocument(raw.slice(split.fm.start, split.fm.end))
  if (doc.errors.length) {
    diag('error', 'yaml-invalid', `YAML 解析失敗：${doc.errors[0].message.split('\n')[0]}`)
    return { ...base, legacy: false, writable: false }
  }
  const data = doc.toJS() as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    diag('error', 'frontmatter-shape', 'frontmatter 必須是 key/value 結構')
    return { ...base, legacy: false, writable: false }
  }

  if (data.type === undefined) diag('error', 'type-missing', '缺少 type')
  else if (data.type !== kind) diag('error', 'type-mismatch', `type 為 ${String(data.type)}，但檔案位於 ${kind} 資料夾`)

  const id = data.id
  if (typeof id !== 'string' || !id) diag('error', 'id-missing', '缺少 id')
  else if (!ID_RULES[kind].pattern.test(id)) diag('error', 'id-invalid', `id「${id}」不符合 ${ID_RULES[kind].prefix}${'#'.repeat(ID_RULES[kind].pad)} 格式`)
  else if (!path.posix.basename(relPath).startsWith(id)) diag('warning', 'filename-mismatch', `檔名應以 ${id} 開頭`)

  if (typeof data.title !== 'string' || !data.title.trim()) diag('error', 'title-missing', '缺少 title')
  if (!isStatus(kind, data.status)) diag('error', 'status-invalid', `status 必須是 ${STATUSES[kind].join(' / ')}`)

  for (const key of ['date', 'due'] as const) {
    if (data[key] !== undefined && (typeof data[key] !== 'string' || !DATE.test(data[key] as string))) {
      diag('error', 'date-format', `${key} 應為 YYYY-MM-DD`)
    }
  }
  if (data.priority !== undefined && !(PRIORITIES as readonly unknown[]).includes(data.priority)) {
    diag('error', 'priority-invalid', `priority 必須是 ${PRIORITIES.join(' / ')}`)
  }

  const links: CardLinks = { implements: [], depends: [], supersedes: [], relates: [] }
  const allowed = LINK_SCHEMA[kind]
  for (const [rel, field] of Object.entries(LINK_FIELD) as [LinkKind, string][]) {
    if (data[field] === undefined) continue
    const rule = allowed[rel]
    if (!rule) {
      diag('warning', 'link-unsupported', `${kind} 不支援 ${field}，已忽略`)
      continue
    }
    const list = rule.single ? (typeof data[field] === 'string' ? [data[field] as string] : null) : strList(data[field])
    if (!list) {
      diag('error', 'link-invalid', rule.single ? `${field} 必須是單一 ID` : `${field} 必須是 ID 陣列`)
      continue
    }
    const wrong = list.filter((t) => !rule.target.includes(kindOfId(t) as CardKind))
    if (wrong.length) {
      diag('error', 'link-target', `${field} 只能指向 ${rule.target.join(' / ')}：${wrong.join('、')}`)
      continue
    }
    if (rule.single) links.milestone = list[0]
    else links[field as 'implements' | 'depends' | 'supersedes' | 'relates'] = list
  }

  let adrRev: Record<string, string> | undefined
  if (kind === 'spec' && data.adr_rev !== undefined) {
    adrRev = {}
    const node = doc.get('adr_rev', true)
    if (!isMap(node)) diag('error', 'spec-rev-invalid', 'adr_rev 必須是「ADR ID: 指紋」的對照表')
    else {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : ''
        // plain scalars keep their source text: an all-digit or 12e45-like hash would otherwise become a number
        const value = isScalar(pair.value) ? (pair.value.type === 'PLAIN' ? pair.value.source : pair.value.value) : undefined
        if (typeof value !== 'string' || !BLOB.test(value)) diag('error', 'spec-rev-invalid', `adr_rev.${key} 必須是 40 字元小寫 hex`)
        else if (!links.implements.includes(key)) diag('warning', 'spec-rev-unknown', `adr_rev.${key} 不在 implements 內，已忽略`)
        else adrRev[key] = value
      }
    }
  }

  const hasError = diagnostics.some((d) => d.level === 'error')
  const coreOk = typeof id === 'string' && ID_RULES[kind].pattern.test(id) && typeof data.title === 'string' && isStatus(kind, data.status)
  const card: CardRecord | undefined = coreOk
    ? {
        id: id as string,
        type: kind,
        title: (data.title as string).trim(),
        status: data.status as CardRecord['status'],
        date: typeof data.date === 'string' ? data.date : undefined,
        due: typeof data.due === 'string' ? data.due : undefined,
        priority: (PRIORITIES as readonly unknown[]).includes(data.priority) ? (data.priority as CardRecord['priority']) : undefined,
        assignee: typeof data.assignee === 'string' ? data.assignee : undefined,
        ...(kind === 'spec' ? { adrRev: adrRev ?? {} } : {}),
        links,
      }
    : undefined

  return { ...base, card, legacy: false, writable: !hasError }
}

export function toClientDoc(d: ParsedDoc): ClientDoc {
  const { sectionStates: _omit, blob: _blob, bodyBlob: _body, ...rest } = d
  void _omit
  void _blob
  void _body
  return rest
}
