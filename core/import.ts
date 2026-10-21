import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  CARD_KINDS,
  formatId,
  ID_RULES,
  idNumber,
  isStatus,
  LINK_FIELD,
  LINK_SCHEMA,
  PRIORITIES,
  shouldReverse,
  STATUSES,
  type CardKind,
  type LinkKind,
} from './domain'
import type { NoditConfig } from './config'
import { renderDoc } from './edit'
import { lockPaths } from './owner'
import { parseDoc, sha1 } from './parse'
import { scanDocs } from './scan'
import { slugify, type InitOps, type Writer } from './writer'

export const IMPORT_JOB_VERSION = 1

export type ImportItem = { legacyId: string; id: string; kind: CardKind; path: string; sha1: string; text: string }

export type ImportJob = {
  version: number
  jobId: string
  projectId: string
  fingerprint: string
  createdAt: string
  projectName?: string
  /** legacy node id (UUID) → new card id */
  mapping: Record<string, string>
  items: ImportItem[]
  layout: Record<string, { x: number; y: number }>
  warnings: string[]
  /** ids whose file is confirmed on disk with exactly the planned content */
  written: string[]
  completedAt?: string
}

export type ImportConflict = { id: string; path: string; reason: string }

export type ImportReport = {
  jobPath: string
  status: 'completed' | 'already-complete'
  resumed: boolean
  created: string[]
  adopted: string[]
  total: number
  warnings: string[]
}

export type ImportErrorCode = 'invalid-input' | 'not-initialized' | 'not-empty' | 'job-mismatch' | 'other-job' | 'conflict'

export class ImportError extends Error {
  constructor(
    public code: ImportErrorCode,
    message: string,
    public conflicts: ImportConflict[] = [],
  ) {
    super(message)
  }
}

/** Test seam: called after a card file is written but before the job record notes it. */
export type ImportHooks = { afterWrite?: (item: ImportItem) => void | Promise<void> }

type LegacyNode = { id: string; position?: { x?: unknown; y?: unknown }; data: Record<string, unknown> }
type LegacyEdge = { source?: unknown; target?: unknown; data?: { kind?: unknown } }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SECTION_SOURCE: Record<CardKind, [string, string][]> = {
  adr: [
    ['Context', 'context'],
    ['Decision', 'decision'],
    ['Consequences', 'consequences'],
  ],
  milestone: [['Goal', 'goal']],
  task: [['Description', 'description']],
}

export function importFingerprint(text: string) {
  return sha1(Buffer.from(text.replace(/^﻿/, ''), 'utf8'))
}

export function importJobPath(fingerprint: string) {
  return `.nodit/import-${fingerprint}.json`
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Accepts the raw `nodit:project` localStorage value (zustand persist envelope) or a bare snapshot. */
function readSnapshot(text: string) {
  let data: any
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch (err) {
    throw new ImportError('invalid-input', `不是有效的 JSON：${(err as Error).message}`)
  }
  const snap = data && typeof data === 'object' && data.state && typeof data.state === 'object' ? data.state : data
  if (!snap || !Array.isArray(snap.nodes)) throw new ImportError('invalid-input', '找不到 nodes；請用舊版 Nodit 匯出的 nodit:project JSON')
  return { projectName: str(snap.projectName) || undefined, nodes: snap.nodes as unknown[], edges: (Array.isArray(snap.edges) ? snap.edges : []) as LegacyEdge[] }
}

/** Pure conversion: legacy snapshot → planned files, id mapping and layout. Deterministic for a given input. */
export function planImport(text: string, config: NoditConfig) {
  const snap = readSnapshot(text)
  const warnings: string[] = []
  const nodes: (LegacyNode & { kind: CardKind })[] = []
  const seen = new Set<string>()
  for (const raw of snap.nodes) {
    const n = raw as LegacyNode
    const kind = n?.data?.kind as CardKind
    if (!n || typeof n.id !== 'string' || !n.id || !CARD_KINDS.includes(kind)) {
      warnings.push(`略過無法辨識的節點：${JSON.stringify(n?.id ?? null)}`)
      continue
    }
    if (seen.has(n.id)) throw new ImportError('invalid-input', `節點 id 重複：${n.id}`)
    seen.add(n.id)
    nodes.push({ ...n, kind })
  }
  if (!nodes.length) throw new ImportError('invalid-input', '沒有可匯入的卡片')

  // keep the legacy code when it is a valid, unique id for its kind; number the rest after the max
  const mapping: Record<string, string> = {}
  for (const kind of CARD_KINDS) {
    const ofKind = nodes.filter((n) => n.kind === kind)
    const taken = new Set<string>()
    for (const n of ofKind) {
      const code = str(n.data.code)
      if (ID_RULES[kind].pattern.test(code) && !taken.has(code)) {
        taken.add(code)
        mapping[n.id] = code
      }
    }
    let max = Math.max(0, ...[...taken].map((id) => idNumber(id) ?? 0))
    for (const n of ofKind) {
      if (mapping[n.id]) continue
      mapping[n.id] = formatId(kind, ++max)
      if (n.data.code) warnings.push(`${str(n.data.code) || n.id} 改編為 ${mapping[n.id]}`)
    }
  }

  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]))
  const links = new Map<string, Record<string, string[]>>(nodes.map((n) => [n.id, {}]))
  for (const e of snap.edges) {
    let from = str(e?.source)
    let to = str(e?.target)
    const requested = str(e?.data?.kind) as LinkKind
    if (!kindOf.has(from) || !kindOf.has(to) || from === to) {
      warnings.push(`略過連線 ${from || '?'} → ${to || '?'}：端點不存在`)
      continue
    }
    if (shouldReverse(kindOf.get(from)!, kindOf.get(to)!)) [from, to] = [to, from]
    const allows = (src: string, dst: string, rel: LinkKind) => LINK_SCHEMA[kindOf.get(src)!][rel]?.target.includes(kindOf.get(dst)!)
    let rel: LinkKind = requested
    if (!allows(from, to, rel)) {
      if (allows(to, from, rel)) [from, to] = [to, from]
      else {
        warnings.push(`${mapping[from]} → ${mapping[to]} 的「${requested || '?'}」關聯不符合規則，改存為 relates`)
        rel = 'relates'
      }
    }
    const field = LINK_FIELD[rel]
    const bucket = links.get(from)!
    const list = (bucket[field] ??= [])
    if (LINK_SCHEMA[kindOf.get(from)!][rel]?.single && list.length && list[0] !== mapping[to]) {
      warnings.push(`${mapping[from]} 只能屬於一個 milestone，保留 ${list[0]}，略過 ${mapping[to]}`)
      continue
    }
    if (!list.includes(mapping[to])) list.push(mapping[to])
  }

  const items: ImportItem[] = []
  const layout: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) {
    const id = mapping[n.id]
    const d = n.data
    const title = str(d.title).trim() || id
    const status = isStatus(n.kind, d.status) ? d.status : STATUSES[n.kind][0]
    if (d.status !== undefined && status !== d.status) warnings.push(`${id} 的 status「${String(d.status)}」不合法，改為 ${status}`)
    const fields: Record<string, string | string[] | undefined> = { id, type: n.kind, title, status }
    if (n.kind === 'adr' && DATE.test(str(d.date))) fields.date = str(d.date)
    if (n.kind === 'milestone' && DATE.test(str(d.dueDate))) fields.due = str(d.dueDate)
    if (n.kind === 'task') {
      if ((PRIORITIES as readonly string[]).includes(str(d.priority))) fields.priority = str(d.priority)
      if (str(d.assignee).trim()) fields.assignee = str(d.assignee).trim()
    }
    const own = links.get(n.id)!
    for (const rel of Object.keys(LINK_SCHEMA[n.kind]) as LinkKind[]) {
      const values = own[LINK_FIELD[rel]]
      if (values?.length) fields[LINK_FIELD[rel]] = LINK_SCHEMA[n.kind][rel]!.single ? values[0] : values
    }
    const sections = Object.fromEntries(SECTION_SOURCE[n.kind].map(([name, key]) => [name, str(d[key])]))
    const rel = path.posix.join(config.paths[n.kind], `${id}-${slugify(title)}.md`)
    const textOut = renderDoc({ kind: n.kind, fields, sections })
    const errors = parseDoc(rel, Buffer.from(textOut, 'utf8'), n.kind).diagnostics.filter((x) => x.level === 'error')
    if (errors.length) throw new ImportError('invalid-input', `${id} 轉換後無法通過驗證：${errors[0].message}`)
    items.push({ legacyId: n.id, id, kind: n.kind, path: rel, sha1: sha1(Buffer.from(textOut, 'utf8')), text: textOut })
    const x = Number(n.position?.x)
    const y = Number(n.position?.y)
    if (Number.isFinite(x) && Number.isFinite(y)) layout[id] = { x: Math.round(x), y: Math.round(y) }
  }

  return { projectName: snap.projectName, mapping, items, layout, warnings }
}

function serialize(job: ImportJob) {
  return JSON.stringify(job, null, 2) + '\n'
}

function readJob(buf: Buffer, rel: string): ImportJob {
  try {
    const job = JSON.parse(buf.toString('utf8')) as ImportJob
    if (job && typeof job === 'object' && Array.isArray(job.items) && Array.isArray(job.written)) return job
  } catch {}
  throw new ImportError('job-mismatch', `${rel} 無法解析；不會續跑`)
}

async function unfinishedJobs(root: string, projectId: string, except: string) {
  const dir = lockPaths(root).dir
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /^import-[0-9a-f]{40}\.json$/.test(n))
  const out: string[] = []
  for (const name of names) {
    const rel = `.nodit/${name}`
    if (rel === except) continue
    try {
      const job = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as ImportJob
      if (job.projectId === projectId && !job.completedAt) out.push(rel)
    } catch {
      out.push(rel)
    }
  }
  return out
}

async function mergeLayout(ops: InitOps, rel: string, planned: ImportJob['layout']) {
  const buf = await ops.read(rel)
  let current: Record<string, { x: number; y: number }> = {}
  if (buf) {
    try {
      const data = JSON.parse(buf.toString('utf8'))
      if (data && typeof data === 'object' && !Array.isArray(data)) current = data
      else throw new Error()
    } catch {
      throw new ImportError('conflict', `${rel} 不是有效的 JSON；卡片已匯入，座標沒有寫入`, [{ id: '', path: rel, reason: '版面檔無法解析' }])
    }
  }
  const missing = Object.keys(planned).filter((id) => !(id in current))
  if (!missing.length) return
  const next = { ...current, ...Object.fromEntries(missing.map((id) => [id, planned[id]])) }
  await ops.replace(rel, JSON.stringify(next, null, 2) + '\n')
}

/**
 * Import a legacy localStorage export. Runs as one job in the writer queue. The full plan (id
 * mapping and file contents) is persisted before any card is written; a rerun with the same input
 * resumes that plan, adopts files that already match it and refuses to touch files that do not.
 */
export async function runImport(root: string, writer: Writer, config: NoditConfig, configExists: boolean, text: string, hooks: ImportHooks = {}): Promise<ImportReport> {
  if (!configExists) throw new ImportError('not-initialized', '專案尚未初始化，請先執行 nodit init')
  const fingerprint = importFingerprint(text)
  const jobRel = importJobPath(fingerprint)
  const allowed = [...CARD_KINDS.map((k) => config.paths[k]), config.paths.layout, jobRel]

  return writer.exclusive(allowed, async (ops) => {
    let job: ImportJob
    const existing = await ops.read(jobRel)
    const resumed = !!existing
    if (existing) {
      job = readJob(existing, jobRel)
      if (job.version !== IMPORT_JOB_VERSION) throw new ImportError('job-mismatch', `${jobRel} 的版本 ${job.version} 不受支援`)
      if (job.projectId !== config.projectId) throw new ImportError('job-mismatch', `${jobRel} 屬於另一個專案（${job.projectId}）；不會續跑`)
      if (job.fingerprint !== fingerprint) throw new ImportError('job-mismatch', `${jobRel} 記錄的輸入與這份檔案不同；不會續跑`)
      if (job.completedAt) {
        return { jobPath: jobRel, status: 'already-complete', resumed, created: [], adopted: [], total: job.items.length, warnings: job.warnings }
      }
    } else {
      const docs = await scanDocs(root, config)
      if (docs.length) throw new ImportError('not-empty', `專案已有 ${docs.length} 份卡片文件；首次匯入只能在沒有卡片的專案進行`)
      const others = await unfinishedJobs(root, config.projectId, jobRel)
      if (others.length) throw new ImportError('other-job', `還有未完成的匯入：${others.join('、')}；請用原本的檔案續跑`)
      const plan = planImport(text, config)
      job = {
        version: IMPORT_JOB_VERSION,
        jobId: randomUUID(),
        projectId: config.projectId,
        fingerprint,
        createdAt: new Date().toISOString(),
        projectName: plan.projectName,
        mapping: plan.mapping,
        items: plan.items,
        layout: plan.layout,
        warnings: plan.warnings,
        written: [],
      }
      await ops.create(jobRel, serialize(job))
    }

    // verify everything before writing anything
    const onDisk = new Map<string, string>()
    for (const d of await scanDocs(root, config)) if (d.card) onDisk.set(d.path, d.card.id)
    const conflicts: ImportConflict[] = []
    const adopted: string[] = []
    const pending: ImportItem[] = []
    const written = new Set(job.written)
    for (const item of job.items) {
      const buf = await ops.read(item.path)
      if (written.has(item.id)) {
        if (!buf) conflicts.push({ id: item.id, path: item.path, reason: '已匯入，但檔案已被刪除或移走' })
        else if (sha1(buf) !== item.sha1) conflicts.push({ id: item.id, path: item.path, reason: '已匯入，之後被修改過' })
        continue
      }
      if (buf) {
        if (sha1(buf) === item.sha1) adopted.push(item.id)
        else conflicts.push({ id: item.id, path: item.path, reason: '預定路徑已有不同內容' })
        continue
      }
      const holder = [...onDisk].find(([p, id]) => id === item.id && p !== item.path)
      if (holder) conflicts.push({ id: item.id, path: item.path, reason: `ID 已被 ${holder[0]} 使用` })
      else pending.push(item)
    }
    if (conflicts.length) {
      throw new ImportError('conflict', `有 ${conflicts.length} 份文件與匯入計畫不符，已停止，沒有覆寫任何檔案`, conflicts)
    }
    if (adopted.length) {
      job.written.push(...adopted)
      await ops.replace(jobRel, serialize(job))
    }

    const created: string[] = []
    for (const item of pending) {
      try {
        await ops.create(item.path, item.text)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new ImportError('conflict', `${item.path} 在匯入途中被建立，已停止`, [{ id: item.id, path: item.path, reason: '預定路徑已有不同內容' }])
        }
        throw err
      }
      await hooks.afterWrite?.(item)
      job.written.push(item.id)
      created.push(item.id)
      await ops.replace(jobRel, serialize(job))
    }

    await mergeLayout(ops, config.paths.layout, job.layout)
    job.completedAt = new Date().toISOString()
    await ops.replace(jobRel, serialize(job))
    return { jobPath: jobRel, status: 'completed', resumed, created, adopted, total: job.items.length, warnings: job.warnings }
  })
}
