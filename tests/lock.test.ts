import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
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

it('a lock that turns stale right after the first look is reported busy and left alone', async () => {
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

it('a genuinely stale lock is still reclaimed', async () => {
  await lockAged(60_000)
  const owner = await acquireOwner(root, 'cli')
  await owner.release()
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

async function holdReclaim(holder: { pid: number; host?: string }) {
  const p = lockPaths(root)
  await writeFile(p.reclaim, JSON.stringify({ pid: holder.pid, host: holder.host ?? hostname(), token: 'held-elsewhere' }))
  const old = new Date(Date.now() - 60_000)
  await utimes(p.reclaim, old, old)
  return p
}

it('a paused reclaimer keeps the reclaim mutex however old it is', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  try {
    const stale = await lockAged(60_000)
    const before = (await stat(stale.lockfilePath)).ino
    const p = await holdReclaim({ pid: child.pid! })
    for (let i = 0; i < 3; i++) await expect(acquireOwner(root, 'cli')).rejects.toBeInstanceOf(LockBusyError)
    expect((await stat(stale.lockfilePath)).ino).toBe(before)
    expect(JSON.parse(await readFile(p.reclaim, 'utf8')).token).toBe('held-elsewhere')

    // a dead holder is not cleared automatically either: that check-then-delete is itself racy
    const exited = new Promise((r) => child.on('exit', r))
    child.kill()
    await exited
    for (let i = 0; i < 3; i++) {
      const err = await acquireOwner(root, 'cli').catch((e) => e)
      expect(err).toBeInstanceOf(LockBusyError)
      expect(err.message).toContain('手動刪除')
    }
    expect(JSON.parse(await readFile(p.reclaim, 'utf8')).token).toBe('held-elsewhere')
    expect((await stat(stale.lockfilePath)).ino).toBe(before)

    // manual recovery: once a person removes the mutex, the stale lock is reclaimed
    await rm(p.reclaim)
    const owner = await acquireOwner(root, 'cli')
    await owner.release()
  } finally {
    child.kill()
  }
})

it('a reclaim mutex from another host is never taken over', async () => {
  await lockAged(60_000)
  const p = await holdReclaim({ pid: 1, host: 'some-other-host' })
  await expect(acquireOwner(root, 'cli')).rejects.toBeInstanceOf(LockBusyError)
  const err = await acquireOwner(root, 'cli').catch((e) => e)
  expect(err.message).toContain('some-other-host')
  expect(JSON.parse(await readFile(p.reclaim, 'utf8')).host).toBe('some-other-host')
})

it('a reclaim mutex directory from an older version is left for manual recovery', async () => {
  await lockAged(60_000)
  const p = lockPaths(root)
  await mkdir(p.reclaim)
  const old = new Date(Date.now() - 60_000)
  await utimes(p.reclaim, old, old)
  const err = await acquireOwner(root, 'cli').catch((e) => e)
  expect(err).toBeInstanceOf(LockBusyError)
  expect(err.message).toContain('舊版')
  expect((await stat(p.reclaim)).isDirectory()).toBe(true)
})
