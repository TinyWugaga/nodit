import { afterEach, expect, it, vi } from 'vitest'
import { chmod, cp, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { start, type RunningServer } from '../server/server'
import { diffLines } from '../core/diff'

const roots: string[] = []
const servers: RunningServer[] = []
const T3 = 'docs/tasks/T-003-inspector.md'
async function temp() { const p = await mkdtemp(path.join(tmpdir(), 'nodit-recheck-')); roots.push(p); return p }
async function fixture() { const p = await temp(); await cp(path.resolve('examples/demo'), p, { recursive: true, filter: (s) => !s.includes('/.nodit/') || !/(writer\.lock|owner\.json|token)/.test(s) }); return p }
async function serve(root: string) { const s = await start({ root, port: 0 }); servers.push(s); return s }
async function send(s: RunningServer, method: string, p: string, body?: unknown) {
  const base = `http://127.0.0.1:${s.port}`
  return fetch(base + p, { method, headers: { Origin: base, 'X-Nodit-Token': s.owner.token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())); await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))) })

it('R1 invalid paths keep the prior config and new cards follow it', async () => {
  const root = await fixture(), file = path.join(root, 'nodit.config.json'), config = JSON.parse(await readFile(file, 'utf8'))
  await rename(path.join(root, 'docs/tasks'), path.join(root, 'work'))
  config.paths.task = 'work'
  await writeFile(file, JSON.stringify(config))
  const s = await serve(root)
  await writeFile(file, JSON.stringify({ ...config, paths: { ...config.paths, task: '../escape' } }))
  await s.project.rescan()
  expect(s.project.config.paths.task).toBe('work')
  expect(s.project.snapshot().status.components.config).toBe('invalid')
  const r = await send(s, 'POST', '/api/cards', { type: 'task', title: 'after bad config' })
  expect(r.status).toBe(201)
  const { doc } = await r.json()
  expect(doc.path.startsWith('work/')).toBe(true)
  expect(doc.card.id).toBe('T-006')
})

it('R1b an unusable first config refuses to create cards', async () => {
  const root = await fixture()
  await writeFile(path.join(root, 'nodit.config.json'), JSON.stringify({ paths: { task: '/abs' } }))
  const s = await serve(root)
  expect((await send(s, 'POST', '/api/cards', { type: 'task', title: 'x' })).status).toBe(422)
})

it('R2 layout response carries the rev that holds that layout', async () => {
  const s = await serve(await fixture())
  const before = s.project.snapshot().layout
  const r = await send(s, 'PUT', '/api/layout', { baseRevision: before.revision, data: { ...before.data, 'T-003': { x: 100, y: 0 } } })
  const body = await r.json()
  expect(body.rev).toBe(s.project.rev)
  expect(s.project.snapshot().layout.revision).toBe(body.revision)
})

it('R3 a stale card keeps its last valid body sections', async () => {
  const root = await fixture(), s = await serve(root)
  const original = s.project.snapshot().docs.find((d) => d.path === T3)!
  await writeFile(path.join(root, T3), '---\nid: [\n---\n')
  await s.project.rescan()
  const d = s.project.snapshot().docs.find((x) => x.path === T3)!
  expect(d.stale).toBe(true)
  expect(d.sections).toEqual(original.sections)
})

it('R4 AI component status follows the file on disk', async () => {
  const root = await temp(), s = await serve(root)
  const plan = await (await send(s, 'GET', '/api/init/plan?ai=true')).json()
  await send(s, 'POST', '/api/init/apply', { planId: plan.planId, itemIds: plan.items.filter((i: { action: string }) => i.action !== 'skip').map((i: { itemId: string }) => i.itemId) })
  await s.project.rescan()
  expect(s.project.snapshot().status.components['AGENTS.md#nodit']).toBe('ok')
  await unlink(path.join(root, 'AGENTS.md'))
  await vi.waitFor(() => expect(s.project.snapshot().status.components['AGENTS.md#nodit']).toBe('missing'), { timeout: 5000 })
})

it('R5 scan read errors surface as diagnostics and keep the last snapshot', async () => {
  const root = await fixture(), s = await serve(root), dir = path.join(root, 'docs/tasks')
  const count = s.project.snapshot().docs.length
  await chmod(dir, 0o000)
  try {
    await expect(s.project.rescan()).rejects.toThrow()
    const snap = s.project.snapshot()
    expect(snap.diagnostics.some((d) => d.code === 'scan-failed')).toBe(true)
    expect(snap.docs).toHaveLength(count)
  } finally {
    await chmod(dir, 0o755)
  }
  await s.project.rescan()
  expect(s.project.snapshot().diagnostics.some((d) => d.code === 'scan-failed')).toBe(false)

  await chmod(path.join(root, T3), 0o000)
  try {
    await s.project.rescan()
    const d = s.project.snapshot().docs.find((x) => x.path === T3)!
    expect(d.diagnostics.some((x) => x.code === 'read-failed')).toBe(true)
    expect(d.card?.id).toBe('T-003')
  } finally {
    await chmod(path.join(root, T3), 0o644)
  }
})

it('R6 legacy diff is never truncated and flags an incomplete preview', () => {
  const body = Array.from({ length: 1200 }, (_, i) => `line ${i}`).join('\n')
  const full = diffLines(body, '---\nid: T-001\n---\n' + body)
  expect(full.complete).toBe(true)
  expect(full.lines).toHaveLength(1203)
  const a = Array.from({ length: 800 }, (_, i) => `a${i}`).join('\n')
  const b = Array.from({ length: 800 }, (_, i) => `b${i}`).join('\n')
  expect(diffLines(a, b).complete).toBe(false)
})
