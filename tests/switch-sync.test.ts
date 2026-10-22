import { describe, expect, it } from 'vitest'
import type { SubscribeHandlers } from '../src/data/client'
import { ProjectSync } from '../src/data/sync'

const tick = () => new Promise((r) => setTimeout(r, 0))

function snap(root: string, sessionId: string, rev = 1) {
  return { projectId: root, sessionId, rev, root, name: root.slice(1) } as never
}

function setup(first: unknown) {
  let handlers!: SubscribeHandlers
  let served = first
  const client = {
    connGen: 0,
    sessionId: null as string | null,
    getProject: async () => served,
    subscribe: (h: SubscribeHandlers) => {
      handlers = h
      return () => {}
    },
  }
  const applied: { root: string; sessionId: string }[] = []
  const lost: { name: string }[] = []
  const sync = new ProjectSync(client as never, {
    apply: (s) => applied.push({ root: s.root, sessionId: s.sessionId }),
    connection: () => {},
    compromised: () => {},
    switched: (to) => lost.push(to),
    error: () => {},
  })
  sync.start()
  return { sync, client, applied, lost, h: () => handlers, serve: (s: unknown) => (served = s) }
}

describe('ProjectSync across a project switch', () => {
  it('binds the client to the session of the snapshot it shows', async () => {
    const t = setup(snap('/a', 's1'))
    await tick()
    expect(t.client.sessionId).toBe('s1')
    expect(t.applied).toEqual([{ root: '/a', sessionId: 's1' }])
  })

  it('another tab switched: stop and report, never apply the new project', async () => {
    const t = setup(snap('/a', 's1'))
    await tick()
    t.serve(snap('/b', 's2'))
    t.h().switched({ projectId: '/a', sessionId: 's1', rev: 3, to: { projectId: '/b', sessionId: 's2', name: 'b' } })
    t.h().hello({ projectId: '/b', sessionId: 's2', rev: 1 })
    await tick()
    expect(t.lost).toEqual([{ projectId: '/b', sessionId: 's2', name: 'b' }])
    expect(t.applied).toHaveLength(1)
    expect(t.client.sessionId).toBe('s1')
  })

  it('a missed notice is caught by the root of the next snapshot', async () => {
    const t = setup(snap('/a', 's1'))
    await tick()
    t.serve(snap('/b', 's2'))
    t.h().hello({ projectId: '/b', sessionId: 's2', rev: 1 })
    await tick()
    expect(t.lost).toEqual([{ name: 'b' }])
    expect(t.applied).toHaveLength(1)
    expect(t.client.sessionId).toBe('s1')
  })

  it('a server restart on the same root is still followed', async () => {
    const t = setup(snap('/a', 's1'))
    await tick()
    t.serve(snap('/a', 's9'))
    t.h().hello({ projectId: '/a', sessionId: 's9', rev: 1 })
    await tick()
    expect(t.lost).toEqual([])
    expect(t.applied.at(-1)).toEqual({ root: '/a', sessionId: 's9' })
  })

  it('our own switch is not mistaken for someone else’s, whichever arrives first', async () => {
    const t = setup(snap('/a', 's1'))
    await tick()
    t.sync.beginSwitch()
    t.serve(snap('/b', 's2'))
    t.h().switched({ projectId: '/a', sessionId: 's1', rev: 3, to: { projectId: '/b', sessionId: 's2', name: 'b' } })
    t.h().hello({ projectId: '/b', sessionId: 's2', rev: 1 })
    await tick()
    expect(t.applied).toHaveLength(1)
    t.client.sessionId = 's2'
    t.sync.adopt(snap('/b', 's2'))
    await tick()
    // a late copy of the notice after adopt is ignored as well
    t.h().switched({ projectId: '/a', sessionId: 's1', rev: 3, to: { projectId: '/b', sessionId: 's2', name: 'b' } })
    expect(t.lost).toEqual([])
    expect(t.applied.at(-1)).toEqual({ root: '/b', sessionId: 's2' })
    expect(t.client.sessionId).toBe('s2')
  })

  it('a failed switch of our own still reports a switch made by another tab meanwhile', async () => {
    const t = setup(snap('/a', 's1'))
    await tick()
    t.sync.beginSwitch()
    t.h().switched({ projectId: '/a', sessionId: 's1', rev: 3, to: { projectId: '/c', sessionId: 's3', name: 'c' } })
    t.sync.endSwitch()
    expect(t.lost).toEqual([{ projectId: '/c', sessionId: 's3', name: 'c' }])
  })
})

describe('DraftManager.clear', () => {
  it('a response from before the switch never settles into a draft of the new project', async () => {
    const { DraftManager } = await import('../src/data/drafts')
    let resolve!: (r: never) => void
    const drafts = new DraftManager(() => new Promise((r) => (resolve = r)), () => {}, 10_000)
    drafts.edit('k', 'old-rev', 'title', 'old project')
    const flushing = drafts.flush('k')
    drafts.clear()
    drafts.edit('k', 'new-rev', 'title', 'new project')
    resolve({ ok: true, envelope: { doc: { revision: 'from-old-project' } } } as never)
    await flushing
    expect(drafts.baseOf('k')).toBe('new-rev')
    expect(drafts.view('k')).toMatchObject({ status: 'pending', values: { title: 'new project' } })
  })
})
