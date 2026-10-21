import type { ClientDoc, FieldPatch, MutationResult } from '../../core/protocol'

export type DraftStatus = 'pending' | 'saving' | 'conflict' | 'invalid' | 'error' | 'auth'

type Entry = { value: string | null; gen: number }

type Draft = {
  /** revision the draft was started from; never silently rebased */
  base: string
  pending: Record<string, Entry>
  inFlight?: Record<string, Entry>
  status: DraftStatus
  message?: string
  current?: ClientDoc | null
  diskChanged: boolean
  discarded?: boolean
}

export type DraftView = {
  status: DraftStatus
  values: Record<string, string | null>
  message?: string
  current?: ClientDoc | null
  diskChanged: boolean
}

export type Send = (docKey: string, baseRevision: string, patch: FieldPatch) => Promise<MutationResult>

const BLOCKED: DraftStatus[] = ['conflict', 'auth', 'invalid', 'error']

/**
 * Per-document draft state machine: at most one request in flight per document; a failed request
 * folds its patch back under any newer edits; `saved` only once nothing is pending or in flight.
 */
export class DraftManager {
  private drafts = new Map<string, Draft>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private gen = 0
  private listeners = new Set<() => void>()

  constructor(
    private send: Send,
    private onSaved: (docKey: string, result: Extract<MutationResult, { ok: true }>) => void,
    private delay = 400,
  ) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  edit(docKey: string, baseRevision: string, field: string, value: string | null) {
    let d = this.drafts.get(docKey)
    if (!d) {
      d = { base: baseRevision, pending: {}, status: 'pending', diskChanged: false }
      this.drafts.set(docKey, d)
    }
    d.pending[field] = { value, gen: ++this.gen }
    if (!BLOCKED.includes(d.status) || d.status === 'invalid' || d.status === 'error') d.status = d.inFlight ? 'saving' : 'pending'
    this.schedule(docKey)
    this.emit()
  }

  private schedule(docKey: string) {
    clearTimeout(this.timers.get(docKey))
    const d = this.drafts.get(docKey)
    if (!d || BLOCKED.includes(d.status)) return
    this.timers.set(
      docKey,
      setTimeout(() => void this.flush(docKey), this.delay),
    )
  }

  async flush(docKey: string) {
    const d = this.drafts.get(docKey)
    if (!d || d.inFlight || BLOCKED.includes(d.status) || !Object.keys(d.pending).length) return
    clearTimeout(this.timers.get(docKey))
    const sent = d.pending
    d.pending = {}
    d.inFlight = sent
    d.status = 'saving'
    this.emit()
    const fields = Object.fromEntries(Object.entries(sent).map(([k, e]) => [k, e.value]))
    let result: MutationResult
    try {
      result = await this.send(docKey, d.base, fields)
    } catch (err) {
      result = { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }
    }
    this.settle(docKey, sent, result)
  }

  private settle(docKey: string, sent: Record<string, Entry>, result: MutationResult) {
    const d = this.drafts.get(docKey)
    if (!d) return
    d.inFlight = undefined
    if (result.ok) {
      d.base = result.envelope.doc.revision
      d.diskChanged = false
      this.onSaved(docKey, result)
      if (d.discarded || !Object.keys(d.pending).length) this.drafts.delete(docKey)
      else {
        d.status = 'pending'
        this.schedule(docKey)
      }
      this.emit()
      return
    }
    if (d.discarded) {
      this.drafts.delete(docKey)
      this.emit()
      return
    }
    for (const [k, e] of Object.entries(sent)) {
      if (!d.pending[k] || d.pending[k].gen < e.gen) d.pending[k] = e
    }
    d.current = undefined
    d.message = undefined
    if (result.reason === 'conflict') {
      d.status = 'conflict'
      d.current = result.envelope.current
    } else if (result.reason === 'invalid') {
      d.status = 'invalid'
      d.message = result.diagnostics.map((x) => x.message).join('；')
    } else if (result.reason === 'auth') {
      d.status = 'auth'
      d.message = result.message
    } else {
      d.status = 'error'
      d.message = result.message
    }
    this.emit()
  }

  retry(docKey: string) {
    const d = this.drafts.get(docKey)
    if (!d || d.inFlight) return
    d.status = 'pending'
    void this.flush(docKey)
  }

  /** Drop the draft and fall back to the disk version. */
  discard(docKey: string) {
    const d = this.drafts.get(docKey)
    if (!d) return
    clearTimeout(this.timers.get(docKey))
    if (d.inFlight) d.discarded = true
    else this.drafts.delete(docKey)
    this.emit()
  }

  /** User-confirmed re-apply of the draft on top of a newer disk revision. */
  reapply(docKey: string, newBase: string) {
    const d = this.drafts.get(docKey)
    if (!d || d.inFlight) return
    d.base = newBase
    d.status = 'pending'
    d.current = undefined
    d.diskChanged = false
    void this.flush(docKey)
  }

  /** Our own non-draft write (e.g. a link patch) moved the doc from `from` to `to`; follow it. */
  rebaseOwn(docKey: string, from: string, to: string) {
    const d = this.drafts.get(docKey)
    if (!d || d.inFlight || d.base !== from) return
    d.base = to
    d.diskChanged = false
    this.emit()
  }

  markDiskChanged(docKey: string, revision: string) {
    const d = this.drafts.get(docKey)
    // while a request is in flight the new revision is most likely our own write; a real
    // external change surfaces as a 409 on that request instead
    if (!d || d.inFlight || d.base === revision) return
    d.diskChanged = true
    this.emit()
  }

  has(docKey: string) {
    return this.drafts.has(docKey)
  }

  view(docKey: string): DraftView | undefined {
    const d = this.drafts.get(docKey)
    if (!d) return undefined
    const values: Record<string, string | null> = {}
    for (const [k, e] of Object.entries(d.inFlight ?? {})) values[k] = e.value
    for (const [k, e] of Object.entries(d.pending)) values[k] = e.value
    return { status: d.status, values, message: d.message, current: d.current, diskChanged: d.diskChanged }
  }

  baseOf(docKey: string) {
    return this.drafts.get(docKey)?.base
  }
}
