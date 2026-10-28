import { isMap, isScalar, parseDocument } from 'yaml'
import { kindOfId, REVIEW_STATUSES, REVIEW_VERDICTS, type ReviewRecord } from './domain'
import { splitDoc } from './frontmatter'
import { docKeyOf, revisionOf, type ParsedDoc } from './parse'
import type { ClientReview, Diagnostic } from './protocol'
import { cardResolver } from './targets'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const BLOB = /^[0-9a-f]{40}$/

export const LINK_CODES = ['review-target-dangling']

/**
 * Parse a review file. Diagnostics carry the path but no docKey: review files are not cards, so
 * the card-oriented UI (raw editor, focus) must not try to open them.
 */
export function parseReview(relPath: string, buf: Buffer): ClientReview {
  const raw = buf.toString('utf8')
  const diagnostics: Diagnostic[] = []
  const diag = (level: Diagnostic['level'], code: string, message: string) => diagnostics.push({ level, code, message, path: relPath })
  const split = splitDoc(raw)
  const base: ClientReview = {
    docKey: docKeyOf(relPath),
    path: relPath,
    revision: revisionOf(buf),
    targets: [],
    body: raw.slice(split.bodyStart),
    diagnostics,
    writable: false,
  }

  if (split.unterminated) {
    diag('error', 'frontmatter-unterminated', 'frontmatter 缺少結尾的 ---')
    return base
  }
  if (!split.fm) {
    diag('error', 'review-frontmatter-missing', 'review 缺少 frontmatter')
    return base
  }
  const doc = parseDocument(raw.slice(split.fm.start, split.fm.end))
  if (doc.errors.length) {
    diag('error', 'yaml-invalid', `YAML 解析失敗：${doc.errors[0].message.split('\n')[0]}`)
    return base
  }
  const data = doc.toJS() as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    diag('error', 'frontmatter-shape', 'frontmatter 必須是 key/value 結構')
    return base
  }

  if (data.type === undefined) diag('error', 'type-missing', '缺少 type')
  else if (data.type !== 'review') diag('error', 'type-mismatch', `type 為 ${String(data.type)}，review 資料夾只接受 review`)

  let targets: string[] | null = null
  const t = data.target
  const list = typeof t === 'string' ? [t] : Array.isArray(t) && t.every((x) => typeof x === 'string') ? (t as string[]) : null
  if (!list || !list.length) diag('error', 'review-target-invalid', 'target 必須是非空的卡片 ID 陣列')
  else {
    const bad = list.filter((x) => !kindOfId(x))
    if (bad.length) diag('error', 'review-target-invalid', `target 不是卡片 ID：${bad.join('、')}`)
    else {
      targets = [...new Set(list)]
      if (targets.length < list.length) diag('warning', 'review-target-duplicate', 'target 有重複的 ID，已去重')
    }
  }

  if (typeof data.reviewer !== 'string' || !data.reviewer.trim()) diag('error', 'review-reviewer-missing', '缺少 reviewer')
  if (typeof data.date !== 'string' || !DATE.test(data.date)) diag('error', 'date-format', 'date 應為 YYYY-MM-DD')
  if (!(REVIEW_VERDICTS as readonly unknown[]).includes(data.verdict)) diag('error', 'review-verdict-invalid', `verdict 必須是 ${REVIEW_VERDICTS.join(' / ')}`)
  if (!(REVIEW_STATUSES as readonly unknown[]).includes(data.status)) diag('error', 'status-invalid', `status 必須是 ${REVIEW_STATUSES.join(' / ')}`)

  const targetRev: Record<string, string> = {}
  if (data.target_rev !== undefined) {
    const node = doc.get('target_rev', true)
    if (!isMap(node)) diag('error', 'review-rev-invalid', 'target_rev 必須是「卡片 ID: 指紋」的對照表')
    else {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : ''
        // plain scalars keep their source text: an all-digit or 12e45-like hash would otherwise become a number
        const value = isScalar(pair.value) ? (pair.value.type === 'PLAIN' ? pair.value.source : pair.value.value) : undefined
        if (typeof value !== 'string' || !BLOB.test(value)) {
          diag('error', 'review-rev-invalid', `target_rev.${key} 必須是 40 字元小寫 hex`)
        } else if (targets && !targets.includes(key)) {
          diag('warning', 'review-rev-unknown', `target_rev.${key} 不在 target 內，已忽略`)
        } else targetRev[key] = value
      }
    }
  }

  if (!targets) return base
  const review: ReviewRecord = {
    targets,
    reviewer: typeof data.reviewer === 'string' ? data.reviewer.trim() : undefined,
    date: typeof data.date === 'string' ? data.date : undefined,
    verdict: typeof data.verdict === 'string' ? data.verdict : undefined,
    status: typeof data.status === 'string' ? data.status : undefined,
    targetRev,
  }
  return {
    ...base,
    review,
    targets: targets.map((id) => ({ id, state: 'missing' })),
    writable: !diagnostics.some((d) => d.level === 'error'),
  }
}

const byDiag = (a: Diagnostic, b: Diagnostic) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message)

/**
 * Resolve every review's targets against the current cards. Pure and order-stable, so callers can
 * compare the JSON of two results to detect derived-only changes (a target edited or deleted).
 */
export function linkReviews(reviews: ClientReview[], docs: ParsedDoc[]): { reviews: ClientReview[]; diagnostics: Diagnostic[] } {
  const resolve = cardResolver(docs)
  const out = [...reviews]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((r) => {
      const diagnostics = r.diagnostics.filter((x) => !LINK_CODES.includes(x.code))
      const targets = (r.review?.targets ?? []).map((id) => {
        const res = resolve(id)
        if (res.state === 'invalid') return { id, state: 'invalid' as const }
        if (res.state === 'missing') {
          diagnostics.push({ level: 'warning', code: 'review-target-dangling', message: `target 指向不存在的 ${id}`, path: r.path })
          return { id, state: 'missing' as const }
        }
        const d = res.doc
        const rev = r.review!.targetRev[id]
        const state = !rev ? ('unrecorded' as const) : rev === d.blob ? ('current' as const) : ('stale' as const)
        return { id, state, docKey: d.docKey }
      })
      return { ...r, targets, diagnostics: diagnostics.sort(byDiag) }
    })
  return { reviews: out, diagnostics: out.flatMap((r) => r.diagnostics) }
}
