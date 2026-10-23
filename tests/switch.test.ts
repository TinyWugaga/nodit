import http from 'node:http'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireOwner, lockPaths } from '../core/owner'
import type { ClientDoc, Envelope, ProjectPayload } from '../core/protocol'
import { start, type RunningServer } from '../server/server'

const DEMO = path.resolve(__dirname, '../examples/demo')
const T3 = 'docs/tasks/T-003-inspector.md'

let base: string
let outside: string
let a: string
let b: string
let recentFile: string
let srv: RunningServer
const origin = () => `http://127.0.0.1:${srv.port}`

async function copyDemo(dest: string) {
  await cp(DEMO, dest, { recursive: true, filter: (src) => !/[\\/]\.nodit[\\/](writer\.lock|owner\.json|token)/.test(src) })
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'nodit-switch-')))
  outside = await realpath(await mkdtemp(path.join(tmpdir(), 'nodit-outside-')))
  a = path.join(base, 'alpha')
  b = path.join(base, 'beta')
  await copyDemo(a)
  await copyDemo(b)
  recentFile = path.join(base, 'home', '.nodit', 'recent.json')
  srv = await start({ root: a, port: 0, browseRoot: base, recentFile })
})

afterEach(async () => {
  await srv.close()
  await rm(base, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

type Auth = { token: string; session: string }
const authOf = (): Auth => ({ token: srv.owner.token, session: srv.project.sessionId })

function send(method: string, url: string, body: unknown, auth: Auth = authOf()) {
  return fetch(`${origin()}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin(), 'X-Nodit-Token': auth.token, 'X-Nodit-Session': auth.session },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const switchTo = (target: string, auth?: Auth) => send('POST', '/api/project/switch', { path: target }, auth)

async function snapshot(): Promise<Envelope<ProjectPayload>> {
  return (await fetch(`${origin()}/api/project`)).json()
}

const docAt = (p: Envelope<ProjectPayload>, rel: string): ClientDoc => p.docs.find((d) => d.path === rel)!
const exists = (p: string) => stat(p).then(() => true, () => false)

describe('project switching', () => {
  it('swaps the whole service set and releases the old lock', async () => {
    const before = authOf()
    const res = await switchTo(b)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.root).toBe(b)
    expect(body.token).not.toBe(before.token)
    expect(body.sessionId).not.toBe(before.session)
    expect(srv.owner.token).toBe(body.token)

    expect((await snapshot()).root).toBe(b)
    expect(await exists(lockPaths(a).lockfilePath)).toBe(false)
    expect(await exists(lockPaths(a).owner)).toBe(false)
    expect(await exists(lockPaths(b).lockfilePath)).toBe(true)
    expect(JSON.parse(await readFile(lockPaths(b).owner, 'utf8')).port).toBe(srv.port)

    // the old project is free again: another process can lock it
    const other = await acquireOwner(a, 'cli')
    await other.release()

    const health = await (await fetch(`${origin()}/api/health`)).json()
    expect(health.root).toBe(b)
    const recent = JSON.parse(await readFile(recentFile, 'utf8'))
    expect(recent.map((r: { path: string }) => r.path)).toEqual([b, a])
  })

  it('a stale tab can never write into the new project', async () => {
    const stale = authOf()
    const fresh = await (await switchTo(b)).json()
    const d = docAt(await snapshot(), T3)
    const write = { baseRevision: d.revision, fields: { status: 'done' } }
    const original = await readFile(path.join(b, T3), 'utf8')

    // old token (tab B never saw the switch)
    expect((await send('PATCH', `/api/docs/${d.docKey}`, write, stale)).status).toBe(401)
    // new token but the old session (e.g. dev mode re-injected the token, the form is still old)
    const mismatch = await send('PATCH', `/api/docs/${d.docKey}`, write, { token: fresh.token, session: stale.session })
    expect(mismatch.status).toBe(412)
    expect((await mismatch.json()).code).toBe('session-mismatch')
    // no session at all
    expect((await send('PATCH', `/api/docs/${d.docKey}`, write, { token: fresh.token, session: '' })).status).toBe(412)
    expect(await readFile(path.join(b, T3), 'utf8')).toBe(original)
    expect(await readFile(path.join(a, T3), 'utf8')).toBe(original)

    const ok = await send('PATCH', `/api/docs/${d.docKey}`, write, { token: fresh.token, session: fresh.sessionId })
    expect(ok.status).toBe(200)
    expect(await readFile(path.join(b, T3), 'utf8')).toContain('status: done')
  })

  it('tells subscribed tabs which session the server switched to', async () => {
    const ctrl = new AbortController()
    const res = await fetch(`${origin()}/api/events`, { signal: ctrl.signal })
    const reader = res.body!.getReader()
    let buf = ''
    const next = async (event: string) => {
      for (;;) {
        const m = new RegExp(`event: ${event}\\ndata: (.*)\\n\\n`).exec(buf)
        if (m) return JSON.parse(m[1])
        const { value, done } = await reader.read()
        if (done) throw new Error(`stream ended before ${event}`)
        buf += new TextDecoder().decode(value)
      }
    }
    const hello = await next('hello')
    const switched = await (await switchTo(b)).json()
    const notice = await next('project-switched')
    ctrl.abort()
    expect(notice.sessionId).toBe(hello.sessionId)
    expect(notice.to).toMatchObject({ sessionId: switched.sessionId, projectId: switched.projectId, name: 'beta' })
  })

  it('keeps the old project fully usable when the new one cannot be opened', async () => {
    const before = authOf()
    const holder = await acquireOwner(b, 'cli')
    try {
      const busy = await switchTo(b)
      expect(busy.status).toBe(409)
      expect((await busy.json()).code).toBe('busy')
    } finally {
      await holder.release()
    }
    expect((await switchTo(path.join(base, 'missing'))).status).toBe(404)
    await rm(path.join(b, '.nodit'), { recursive: true, force: true })
    await symlink(outside, path.join(b, '.nodit'))
    expect((await switchTo(b)).status).toBe(403)

    expect(authOf()).toEqual(before)
    expect((await snapshot()).root).toBe(a)
    expect(await exists(lockPaths(a).lockfilePath)).toBe(true)
    const d = docAt(await snapshot(), T3)
    expect((await send('PATCH', `/api/docs/${d.docKey}`, { baseRevision: d.revision, fields: { status: 'doing' } }, before)).status).toBe(200)
    expect(await readFile(path.join(a, T3), 'utf8')).toContain('status: doing')
  })

  it('waits for a write already in flight and refuses new ones meanwhile', async () => {
    const auth = authOf()
    const d = docAt(await snapshot(), T3)
    const payload = JSON.stringify({ baseRevision: d.revision, fields: { status: 'doing' } })

    // a write whose body is still arriving has entered the old project
    let resolveWrite!: (status: number) => void
    const writeDone = new Promise<number>((r) => (resolveWrite = r))
    const req = http.request(
      {
        host: '127.0.0.1',
        port: srv.port,
        method: 'PATCH',
        path: `/api/docs/${d.docKey}`,
        headers: { 'Content-Type': 'application/json', Origin: origin(), 'X-Nodit-Token': auth.token, 'X-Nodit-Session': auth.session },
      },
      (res) => {
        res.resume()
        resolveWrite(res.statusCode!)
      },
    )
    req.write(payload.slice(0, 10))
    await new Promise((r) => setTimeout(r, 100))

    let switched = false
    const switching = switchTo(b).then((r) => {
      switched = true
      return r
    })
    await new Promise((r) => setTimeout(r, 300))
    expect(switched).toBe(false)
    expect(await exists(lockPaths(a).lockfilePath)).toBe(true)

    const paused = await send('PATCH', `/api/docs/${d.docKey}`, JSON.parse(payload), auth)
    expect(paused.status).toBe(503)
    expect((await paused.json()).code).toBe('switching')
    expect((await switchTo(b, auth)).status).toBe(409)

    req.end(payload.slice(10))
    expect(await writeDone).toBe(200)
    expect((await switching).status).toBe(200)
    expect(await readFile(path.join(a, T3), 'utf8')).toContain('status: doing')
    expect(await readFile(path.join(b, T3), 'utf8')).toContain('status: todo')
  })
})

describe('directory browsing', () => {
  const list = (dir: string | null, auth: Partial<Auth> = authOf()) =>
    fetch(`${origin()}/api/fs/list${dir ? `?path=${encodeURIComponent(dir)}` : ''}`, { headers: { 'X-Nodit-Token': auth.token ?? '' } })

  it('requires the token even for GET', async () => {
    expect((await list(null, {})).status).toBe(401)
    expect((await fetch(`${origin()}/api/projects/recent`)).status).toBe(401)
    expect((await list(null)).status).toBe(200)
  })

  it('lists directories inside the root and marks project folders', async () => {
    await mkdir(path.join(base, 'plain'))
    const body = await (await list(null)).json()
    expect(body.path).toBe(base)
    expect(body.parent).toBeNull()
    expect(body.entries.map((e: { name: string }) => e.name)).toEqual(['alpha', 'beta', 'home', 'plain'])
    expect(body.entries.find((e: { name: string }) => e.name === 'alpha').project).toBe(true)
    expect(body.entries.find((e: { name: string }) => e.name === 'plain').project).toBe(false)
    const child = await (await list(a)).json()
    expect(child.parent).toBe(base)
  })

  it('refuses paths outside the root, also through symlinks', async () => {
    await copyDemo(path.join(outside, 'repo'))
    await symlink(path.join(outside, 'repo'), path.join(base, 'escape'))

    expect((await list(outside)).status).toBe(403)
    expect((await list(path.join(base, '..'))).status).toBe(403)
    expect((await list('relative/path')).status).toBe(400)
    expect((await list(path.join(base, 'escape'))).status).toBe(403)
    const names = (await (await list(null)).json()).entries.map((e: { name: string }) => e.name)
    expect(names).not.toContain('escape')

    expect((await switchTo(path.join(outside, 'repo'))).status).toBe(403)
    expect((await switchTo(path.join(base, 'escape'))).status).toBe(403)
    expect((await switchTo(`${base}/alpha/../../${path.basename(outside)}/repo`)).status).toBe(403)
    expect(await exists(lockPaths(path.join(outside, 'repo')).lockfilePath)).toBe(false)
    expect((await snapshot()).root).toBe(a)
  })
})
