import path from 'node:path'
import { kindOfId } from './domain'
import type { ParsedDoc } from './parse'
import type { Diagnostic, SpecAdr } from './protocol'
import { cardResolver } from './targets'

export const SPEC_LINK_CODES = ['spec-adr-not-accepted']

/**
 * Derive, for every spec, the state of each ADR it implements and the `spec-adr-not-accepted`
 * warning. Recomputed from the current files every time; never writes or keeps earlier results.
 * An invalid ADR is not judged: its retained card may not describe the file on disk.
 */
export type RevResult = { ok: true; rev: string; path: string } | { ok: false; message: string }

/**
 * Body fingerprint for `nodit rev`, resolved the same way the linking pass resolves an ADR. A scan
 * without a previous snapshot has no retained card, so a file that fails to parse is recognized by
 * its file name instead.
 */
export function revOf(docs: ParsedDoc[], id: string): RevResult {
  if (!kindOfId(id)) return { ok: false, message: `不是卡片 ID：${id}` }
  const res = cardResolver(docs)(id)
  if (res.state === 'invalid') return { ok: false, message: `${id} 無法唯一判定：有多個檔案使用這個 ID` }
  const broken = docs.filter((d) => !d.card && path.posix.basename(d.path).startsWith(id))
  if (broken.length) return { ok: false, message: `${id} 的檔案目前解析失敗：${broken.map((d) => d.path).join('、')}` }
  if (res.state === 'missing') return { ok: false, message: `找不到 ${id}` }
  return { ok: true, rev: res.doc.bodyBlob!, path: res.doc.path }
}

export function linkSpecs(docs: ParsedDoc[]): { docs: ParsedDoc[]; diagnostics: Diagnostic[] } {
  const resolve = cardResolver(docs)
  const diagnostics: Diagnostic[] = []
  const out = docs.map((d) => {
    if (d.kind !== 'spec' || !d.card) return d.specAdrs ? { ...d, specAdrs: undefined } : d
    const card = d.card
    const committed = card.status === 'approved' || card.status === 'implemented'
    const extra: Diagnostic[] = []
    const specAdrs: SpecAdr[] = card.links.implements.map((id) => {
      const res = resolve(id)
      if (res.state !== 'ok') return { id, state: res.state }
      const adr = res.doc
      const status = adr.card!.status
      if (committed && status !== 'accepted') {
        const message =
          status === 'proposed' ? `${id} 尚未確認` : `${id} 已廢止或被取代，考慮把 Spec 標為 outdated`
        extra.push({ level: 'warning', code: 'spec-adr-not-accepted', message, docKey: d.docKey, path: d.path })
      }
      const rev = card.adrRev?.[id]
      const state = !rev ? 'unrecorded' : rev === adr.bodyBlob ? 'current' : 'stale'
      return { id, state, docKey: adr.docKey }
    })
    diagnostics.push(...extra)
    return { ...d, specAdrs, diagnostics: extra.length ? [...d.diagnostics, ...extra] : d.diagnostics }
  })
  return { docs: out, diagnostics }
}
