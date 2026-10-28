import http from 'node:http'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LockBusyError } from '../core/owner'
import type { ClientDoc, Envelope, ProjectPayload } from '../core/protocol'
import { start, type RunningServer } from '../server/server'

const DEMO = path.resolve(__dirname, '../examples/demo')
const T3 = 'docs/tasks/T-003-inspector.md'

let root: string
let srv: RunningServer
let base: string
const origin = () => `http://127.0.0.1:${srv.port}`

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nodit-srv-'))
  await cp(DEMO, root, { recursive: true, filter: (src) => !/[\\/]\.nodit[\\/](writer\.lock|owner\.json|token)/.test(src) })
  srv = await start({ root, port: 0 })
  base = origin()
})

afterEach(async () => {
  await srv.close()
  await rm(root, { recursive: true, force: true })
})

async function project(): Promise<Envelope<ProjectPayload>> {
  return (await fetch(`${base}/api/project`)).json()
}

function doc(p: Envelope<ProjectPayload>, rel: string): ClientDoc {
  return p.docs.find((d) => d.path === rel)!
}

function patch(docKey: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/docs/${docKey}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: origin(), 'X-Nodit-Token': srv.owner.token,'X-Nodit-Session':srv.project.sessionId, ...headers },
    body: JSON.stringify(body),
  })
}

/** Read SSE frames until `count` events arrived. */
async function readEvents(count: number, during?: () => Promise<void>) {
  const ctrl = new AbortController()
  const res = await fetch(`${base}/api/events`, { signal: ctrl.signal })
  const reader = res.body!.getReader()
  const events: { event: string; data: any }[] = []
  let buf = ''
  let ran = false
  while (events.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buf += new TextDecoder().decode(value)
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const event = /^event: (.*)$/m.exec(frame)?.[1]
      const data = /^data: (.*)$/m.exec(frame)?.[1]
      if (event && data) events.push({ event, data: JSON.parse(data) })
    }
    if (!ran && during && events.length) {
      ran = true
      await during()
    }
  }
  ctrl.abort()
  return events
}

describe('server', () => {
  it('serves the demo snapshot inside an envelope', async () => {
    const p = await project()
    expect(p.sessionId).toBe(srv.project.sessionId)
    expect(p.rev).toBeGreaterThan(0)
    expect(p.docs).toHaveLength(11)
    expect(p.docs.every((d) => d.writable)).toBe(true)
  })

  it('writes a minimal diff and rejects a stale revision', async () => {
    const before = await readFile(path.join(root, T3), 'utf8')
    const d = doc(await project(), T3)
    const ok = await patch(d.docKey, { baseRevision: d.revision, fields: { status: 'doing' } })
    expect(ok.status).toBe(200)
    expect(await readFile(path.join(root, T3), 'utf8')).toBe(before.replace('status: todo', 'status: doing'))

    const stale = await patch(d.docKey, { baseRevision: d.revision, fields: { status: 'done' } })
    expect(stale.status).toBe(409)
    expect((await stale.json()).current.card.status).toBe('doing')
    expect(await readFile(path.join(root, T3), 'utf8')).toContain('status: doing')
  })

  it('blocks writes without token, from foreign origins or with a foreign Host', async () => {
    const d = doc(await project(), T3)
    const body = { baseRevision: d.revision, fields: { status: 'done' } }
    expect((await patch(d.docKey, body, { 'X-Nodit-Token': 'nope' })).status).toBe(401)
    expect((await patch(d.docKey, body, { Origin: 'https://evil.example' })).status).toBe(403)
    const status = await new Promise<number>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.port, path: '/api/project', headers: { Host: 'evil.example' } }, (res) => {
        res.resume()
        resolve(res.statusCode!)
      }).on('error', reject)
    })
    expect(status).toBe(421)
    expect(await readFile(path.join(root, T3), 'utf8')).toContain('status: todo')
  })

  it('serves the app shell with a CSP that keeps rendered markdown on this origin', async () => {
    const dist = await mkdtemp(path.join(tmpdir(), 'nodit-dist-'))
    await writeFile(path.join(dist, 'index.html'), '<html><head></head><body></body></html>')
    await srv.close()
    srv = await start({ root, port: 0, distDir: dist })
    base = origin()
    try {
      const csp = (await fetch(`${base}/`)).headers.get('content-security-policy')
      const directive = (name: string) => csp?.split('; ').find((d) => d.startsWith(`${name} `))
      expect(directive('img-src')).toBe("img-src 'self' data:")
      expect(directive('media-src')).toBe("media-src 'self'")
      expect(directive('script-src')).toBe("script-src 'self'")
      expect(directive('connect-src')).toBe("connect-src 'self'")
      expect((await fetch(`${base}/some/route`)).headers.get('content-security-policy')).toBe(csp)
    } finally {
      await rm(dist, { recursive: true, force: true })
    }
  })

  it('refuses a second server on the same project', async () => {
    await expect(start({ root, port: 0 })).rejects.toBeInstanceOf(LockBusyError)
  })

  it('closes the GET→subscribe gap: hello announces a newer rev', async () => {
    const loaded = await project()
    await writeFile(path.join(root, T3), (await readFile(path.join(root, T3), 'utf8')).replace('側欄編輯器', 'External'))
    await srv.project.rescan()
    const [hello] = await readEvents(1)
    expect(hello.event).toBe('hello')
    expect(hello.data.sessionId).toBe(loaded.sessionId)
    expect(hello.data.rev).toBeGreaterThan(loaded.rev)
  })

  it('publishes external edits picked up by the watcher', async () => {
    const loaded = await project()
    const events = await readEvents(2, async () => {
      await writeFile(path.join(root, T3), (await readFile(path.join(root, T3), 'utf8')).replace('側欄編輯器', 'Watched'))
    })
    expect(events[1].event).toBe('snapshot-changed')
    expect(events[1].data.rev).toBeGreaterThan(loaded.rev)
    const d = doc(await project(), T3)
    expect(d.card?.title).toBe('Watched')
  })

  it('step 2 routes: create, links, raw 422, delete 409, token required', async () => {
    const send = (method: string, url: string, body: unknown, token = srv.owner.token) =>
      fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', Origin: origin(), 'X-Nodit-Token': token, 'X-Nodit-Session': srv.project.sessionId }, body: JSON.stringify(body) })

    expect((await send('POST', '/api/cards', { type: 'task', title: 'x' }, 'bad')).status).toBe(401)
    const created = await send('POST', '/api/cards', { type: 'task', title: 'Route test', links: [{ rel: 'part-of', to: 'MS-01' }] })
    expect(created.status).toBe(201)
    const doc = (await created.json()).doc as ClientDoc
    expect(doc.card?.id).toBe('T-006')

    const linked = await send('PATCH', `/api/docs/${doc.docKey}/links`, { baseRevision: doc.revision, add: [{ rel: 'implements', to: 'ADR-001' }] })
    expect(linked.status).toBe(200)
    const after = (await linked.json()).doc as ClientDoc
    expect(after.card?.links).toMatchObject({ milestone: 'MS-01', implements: ['ADR-001'] })

    const bad = await send('PUT', `/api/docs/${doc.docKey}/raw`, { baseRevision: after.revision, text: '---\nid: [\n---\n' })
    expect(bad.status).toBe(422)

    expect((await send('DELETE', `/api/docs/${doc.docKey}`, { baseRevision: doc.revision })).status).toBe(409)
    expect((await send('DELETE', `/api/docs/${doc.docKey}`, { baseRevision: after.revision })).status).toBe(200)
    expect(srv.project.getDoc(doc.docKey)).toBeUndefined()
  })

  it('serves the architecture doc and bumps its revision on change', async () => {
    const first = await (await fetch(`${base}/api/architecture`)).json()
    expect(first.markdown).toContain('# Architecture')
    expect((await project()).architecture.revision).toBe(first.revision)
    await writeFile(path.join(root, 'docs/ARCHITECTURE.md'), first.markdown + '\nmore\n')
    const changed = await srv.project.rescan()
    expect(changed).toEqual([])
    const snap = await project()
    expect(snap.architecture.revision).not.toBe(first.revision)
    expect(snap.rev).toBeGreaterThan(first.rev)
  })
})

