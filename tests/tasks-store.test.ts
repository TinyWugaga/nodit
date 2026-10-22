// @vitest-environment jsdom
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { start, type RunningServer } from '../server/server'
import { buildLanes, taskItems } from '../src/tasks/board'

const nativeFetch = globalThis.fetch
let root: string
let srv: RunningServer

beforeEach(async () => {
  vi.resetModules()
  root = await mkdtemp(path.join(tmpdir(), 'nodit-tasks-'))
  await cp(path.resolve('examples/demo'), root, { recursive: true, filter: (p) => !/[\\/]\.nodit[\\/](writer\.lock|owner\.json|token)/.test(p) })
  srv = await start({ root, port: 0 })
  document.head.innerHTML = `<meta name="nodit-token" content="${srv.owner.token}">`
  vi.stubGlobal(
    'EventSource',
    class {
      static CLOSED = 2
      readyState = 1
      addEventListener() {}
      close() {}
    },
  )
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const base = `http://127.0.0.1:${srv.port}`
    return nativeFetch(new URL(url, base), { ...init, headers: { ...(init.headers as Record<string, string>), Origin: base } })
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await srv.close()
  await rm(root, { recursive: true, force: true })
})

it('dropping a card into another column saves its status together with the pending title', async () => {
  const { useProject } = await import('../src/store')
  await vi.waitFor(() => expect(useProject.getState().docs).toHaveLength(11))
  const s = useProject.getState()
  const doc = s.docs.find((d) => d.card?.id === 'T-003')!
  const file = path.join(root, doc.path)

  s.editField(doc.docKey, 'title', 'Renamed while dragging')
  // what the board does on drop
  s.editField(doc.docKey, 'status', 'doing', true)

  // the card moves at once, showing the draft state until the write settles
  const moved = buildLanes(taskItems(useProject.getState().nodes, useProject.getState().docs), 'none', () => true)[0]
  const card = moved.columns.doing.find((i) => i.code === 'T-003')!
  expect(card.draft?.status).toBe('saving')

  await vi.waitFor(() => expect(useProject.getState().draftOf(doc.docKey)).toBeUndefined())
  const text = await readFile(file, 'utf8')
  expect(text).toContain('status: doing')
  expect(text).toContain('title: Renamed while dragging')
})
