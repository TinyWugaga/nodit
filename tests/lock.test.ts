import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import lockfile from 'proper-lockfile'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { acquireOwner, LOCK_OPTIONS, LockBusyError, lockPaths, noReclaimFs } from '../core/owner'
import { start } from '../server/server'

const run = promisify(execFile)
const REPO = path.resolve(__dirname, '..')
let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nodit-lock-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function lockAged(ms: number) {
  const p = lockPaths(root)
  await mkdir(p.lockfilePath, { recursive: true })
  const at = new Date(Date.now() - ms)
  await utimes(p.lockfilePath, at, at)
  return p
}

it('a stale lock is reported busy with recovery steps and never removed', async () => {
  const p = await lockAged(60_000)
  const before = await stat(p.lockfilePath)
  for (let i = 0; i < 3; i++) {
    const err = await acquireOwner(root, 'cli').catch((e) => e)
    expect(err).toBeInstanceOf(LockBusyError)
    expect(err.message).toContain('不會自動回收')
    expect(err.message).toContain('手動刪除')
  }
  const after = await stat(p.lockfilePath)
  expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs])

  // manual recovery: once a person removes the lock, the next attempt acquires it
  await rm(p.lockfilePath, { recursive: true })
  const owner = await acquireOwner(root, 'cli')
  await owner.release()
})

it('a lock that turns stale during acquisition is left alone', async () => {
  const p = await lockAged(LOCK_OPTIONS.stale - 500)
  const before = (await stat(p.lockfilePath)).mtimeMs
  // the first clock read sees a fresh lock; every later read is 1s on, past the stale threshold
  const real = Date.now.bind(Date)
  let reads = 0
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => real() + (reads++ === 0 ? 0 : 1000))
  try {
    await expect(acquireOwner(root, 'cli')).rejects.toBeInstanceOf(LockBusyError)
  } finally {
    clock.mockRestore()
  }
  expect((await stat(p.lockfilePath)).mtimeMs).toBe(before)
})

it('proper-lockfile cannot reclaim a stale lock through the guarded fs', async () => {
  const p = await lockAged(60_000)
  const before = (await stat(p.lockfilePath)).mtimeMs
  const err = await lockfile.lock(p.dir, { ...LOCK_OPTIONS, lockfilePath: p.lockfilePath, fs: noReclaimFs(p.lockfilePath) }).catch((e) => e)
  expect(err.code).toBe('ELOCKED')
  expect((await stat(p.lockfilePath)).mtimeMs).toBe(before)
})

it('the guarded fs still lets the holder release its own lock', async () => {
  const p = lockPaths(root)
  await mkdir(p.dir, { recursive: true })
  const release = await lockfile.lock(p.dir, { ...LOCK_OPTIONS, lockfilePath: p.lockfilePath, fs: noReclaimFs(p.lockfilePath) })
  await release()
  await expect(stat(p.lockfilePath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('a paused holder whose lock went stale keeps it until it releases', async () => {
  const held = await acquireOwner(root, 'cli')
  const p = lockPaths(root)
  const old = new Date(Date.now() - 60_000)
  await utimes(p.lockfilePath, old, old)
  await expect(acquireOwner(root, 'cli')).rejects.toBeInstanceOf(LockBusyError)
  expect((await stat(p.lockfilePath)).mtimeMs).toBe(old.getTime())
  await held.release()
  const next = await acquireOwner(root, 'cli')
  await next.release()
})

it('connected CLI init prints the diagnostics behind a 422', async () => {
  await writeFile(path.join(root, 'nodit.config.json'), JSON.stringify({ paths: { task: '../outside' } }))
  const srv = await start({ root, port: 0 })
  try {
    const r = await run(path.join(REPO, 'node_modules/.bin/tsx'), [path.join(REPO, 'server/cli.ts'), 'init', root, '--yes'], { cwd: REPO }).then(
      () => ({ code: 0, err: '' }),
      (e) => ({ code: e.code as number, err: String(e.stderr) }),
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain('paths.task')
  } finally {
    await srv.close()
  }
}, 30_000)

