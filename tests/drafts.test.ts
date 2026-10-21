import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientDoc, FieldPatch, MutationResult } from '../core/protocol'
import { DraftManager } from '../src/data/drafts'
import { shouldApply } from '../src/data/sync'

type Call = { docKey: string; base: string; patch: FieldPatch; resolve: (r: MutationResult) => void }

function okResult(revision: string): MutationResult {
  return { ok: true, envelope: { projectId: 'p', sessionId: 's', rev: 1, doc: { revision } as ClientDoc } }
}

let calls: Call[]
let saved: string[]
let drafts: DraftManager

beforeEach(() => {
  vi.useFakeTimers()
  calls = []
  saved = []
  drafts = new DraftManager(
    (docKey, base, patch) => new Promise((resolve) => calls.push({ docKey, base, patch, resolve })),
    (_k, r) => saved.push(r.envelope.doc.revision),
    400,
  )
})

afterEach(() => vi.useRealTimers())

async function tick(ms = 400) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('DraftManager', () => {
  it('keeps typing during a slow save and ends with the newest text on disk, never saved early', async () => {
    drafts.edit('d', 'r0', 'title', 'A')
    await tick()
    expect(calls).toHaveLength(1)
    drafts.edit('d', 'r0', 'title', 'AB')
    await tick()
    expect(calls).toHaveLength(1)
    expect(drafts.view('d')?.status).toBe('saving')

    calls[0].resolve(okResult('r1'))
    await tick(0)
    expect(drafts.view('d')?.status).toBe('pending')
    expect(drafts.view('d')?.values.title).toBe('AB')

    await tick()
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ base: 'r1', patch: { title: 'AB' } })
    calls[1].resolve(okResult('r2'))
    await tick(0)
    expect(drafts.view('d')).toBeUndefined()
    expect(saved).toEqual(['r1', 'r2'])
  })

  it('restores the in-flight patch on 409 when nothing newer is pending', async () => {
    drafts.edit('d', 'r0', 'status', 'done')
    await tick()
    calls[0].resolve({ ok: false, reason: 'conflict', envelope: { projectId: 'p', sessionId: 's', rev: 2, current: { revision: 'r9' } as ClientDoc } })
    await tick(0)
    const v = drafts.view('d')!
    expect(v.status).toBe('conflict')
    expect(v.values.status).toBe('done')
    expect(v.current?.revision).toBe('r9')
    await tick(2000)
    expect(calls).toHaveLength(1)
  })

  it('on 500 keeps the newer value for the same field and retries with it', async () => {
    drafts.edit('d', 'r0', 'title', 'old')
    await tick()
    drafts.edit('d', 'r0', 'title', 'newer')
    calls[0].resolve({ ok: false, reason: 'error', message: 'boom' })
    await tick(0)
    expect(drafts.view('d')).toMatchObject({ status: 'error', values: { title: 'newer' } })
    drafts.retry('d')
    await tick(0)
    expect(calls[1]).toMatchObject({ base: 'r0', patch: { title: 'newer' } })
  })

  it('never rebases a dirty draft onto an external revision', async () => {
    drafts.edit('d', 'r0', 'title', 'mine')
    drafts.markDiskChanged('d', 'r5')
    expect(drafts.view('d')?.diskChanged).toBe(true)
    await tick()
    expect(calls[0].base).toBe('r0')
  })

  it('re-applies on a user-confirmed newer base', async () => {
    drafts.edit('d', 'r0', 'title', 'mine')
    await tick()
    calls[0].resolve({ ok: false, reason: 'conflict', envelope: { projectId: 'p', sessionId: 's', rev: 2, current: { revision: 'r9' } as ClientDoc } })
    await tick(0)
    drafts.reapply('d', 'r9')
    await tick(0)
    expect(calls[1]).toMatchObject({ base: 'r9', patch: { title: 'mine' } })
  })
})

describe('snapshot ordering', () => {
  const m = (sessionId: string, rev: number) => ({ projectId: 'p', sessionId, rev })
  it('drops older snapshots within a session and foreign-session snapshots', () => {
    expect(shouldApply(m('s1', 5), 's1', m('s1', 4))).toBe(false)
    expect(shouldApply(m('s1', 5), 's1', m('s1', 6))).toBe(true)
    expect(shouldApply(m('s1', 5), 's2', m('s1', 9))).toBe(false)
    expect(shouldApply(m('s1', 5), 's2', m('s2', 1))).toBe(true)
    expect(shouldApply(null, null, m('s1', 1))).toBe(true)
  })
})
