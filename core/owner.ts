import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import lockfile from 'proper-lockfile'

/** Every entry point (server, CLI) must lock with exactly these options. */
export const LOCK_OPTIONS = Object.freeze({ stale: 10_000, update: 2_000, retries: 0, realpath: true })

export type OwnerMode = 'server' | 'cli'

export type OwnerInfo = {
  ownerId: string
  mode: OwnerMode
  pid: number
  port?: number
  sessionId: string
  startedAt: string
}

export class LockBusyError extends Error {
  constructor(public owner: OwnerInfo | null) {
    super(owner ? `專案正由另一個 Nodit ${owner.mode}（pid ${owner.pid}）寫入中` : '專案正由另一個 Nodit 程序寫入中')
  }
}

export class CompromisedError extends Error {}

export function lockPaths(root: string) {
  const dir = path.join(root, '.nodit')
  return {
    dir,
    lockfilePath: path.join(dir, 'writer.lock'),
    owner: path.join(dir, 'owner.json'),
    token: path.join(dir, 'token'),
  }
}

async function writeAtomic(file: string, text: string, mode = 0o644) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, text, { mode, flag: 'wx' })
  await rename(tmp, file)
}

export async function readOwner(root: string): Promise<OwnerInfo | null> {
  try {
    return JSON.parse(await readFile(lockPaths(root).owner, 'utf8'))
  } catch {
    return null
  }
}

/** Token is only returned when it belongs to the expected owner and session. */
export async function readToken(root: string, expect: Pick<OwnerInfo, 'ownerId' | 'sessionId'>): Promise<string | null> {
  try {
    const t = JSON.parse(await readFile(lockPaths(root).token, 'utf8'))
    return t.ownerId === expect.ownerId && t.sessionId === expect.sessionId ? t.token : null
  } catch {
    return null
  }
}

export class Owner {
  compromised: Error | null = null
  private listeners = new Set<(err: Error) => void>()

  constructor(
    public root: string,
    public info: OwnerInfo,
    public token: string,
    private releaseLock: () => Promise<void>,
    private createdDir = false,
  ) {}

  onCompromised(fn: (err: Error) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  markCompromised(err: Error) {
    if (this.compromised) return
    this.compromised = err
    for (const fn of this.listeners) fn(err)
  }

  assertWritable() {
    if (this.compromised) throw new CompromisedError(`寫入鎖已失效，停止寫入：${this.compromised.message}`)
  }

  async setPort(port: number) {
    this.info = { ...this.info, port }
    await writeAtomic(lockPaths(this.root).owner, JSON.stringify(this.info, null, 2))
  }

  async release() {
    const p = lockPaths(this.root)
    const current = await readOwner(this.root)
    if (current?.ownerId === this.info.ownerId) {
      await rm(p.owner, { force: true })
      await rm(p.token, { force: true })
    }
    if (!this.compromised) await this.releaseLock().catch(() => {})
    if (this.createdDir && !(await readdir(p.dir).catch(() => ['?'])).length) await rmdir(p.dir).catch(() => {})
  }
}

export async function acquireOwner(root: string, mode: OwnerMode, sessionId = randomUUID()): Promise<Owner> {
  const p = lockPaths(root)
  const createdDir = !(await stat(p.dir).then(() => true, () => false))
  await mkdir(p.dir, { recursive: true })
  let owner: Owner | undefined
  let release: () => Promise<void>
  try {
    release = await lockfile.lock(p.dir, {
      ...LOCK_OPTIONS,
      lockfilePath: p.lockfilePath,
      onCompromised: (err) => owner?.markCompromised(err),
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ELOCKED') throw new LockBusyError(await readOwner(root))
    throw err
  }
  const info: OwnerInfo = { ownerId: randomUUID(), mode, pid: process.pid, sessionId, startedAt: new Date().toISOString() }
  const token = randomBytes(32).toString('hex')
  await writeAtomic(p.token, JSON.stringify({ ownerId: info.ownerId, sessionId, token }), 0o600)
  await writeAtomic(p.owner, JSON.stringify(info, null, 2))
  owner = new Owner(root, info, token, release, createdDir)
  return owner
}
