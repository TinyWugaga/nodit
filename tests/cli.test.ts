import { execFile, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rm, utimes } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireOwner, lockPaths } from '../core/owner'
import { start } from '../server/server'

const run = promisify(execFile)
const REPO = path.resolve(__dirname, '..')
const TSX = path.join(REPO, 'node_modules/.bin/tsx')
const CLI = path.join(REPO, 'server/cli.ts')
const DEMO = path.join(REPO, 'examples/demo')

let root: string

function nodit(...args: string[]) {
  return run(TSX, [CLI, ...args], { cwd: REPO }).then(
    (r) => ({ code: 0, out: r.stdout.trim(), err: r.stderr.trim() }),
    (e) => ({ code: e.code as number, out: String(e.stdout).trim(), err: String(e.stderr).trim() }),
  )
}

async function taskFiles() {
  return (await readdir(path.join(root, 'docs/tasks'))).sort()
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nodit-cli-'))
  await cp(DEMO, root, { recursive: true, filter: (src) => !/[\\/]\.nodit[\\/](writer\.lock|owner\.json|token)/.test(src) })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('nodit new', () => {
  it('three offline CLIs at once get distinct ids', async () => {
    const results = await Promise.all([1, 2, 3].map((n) => nodit('new', 'task', `Parallel ${n}`, '--dir', root, '--json')))
    expect(results.every((r) => r.code === 0)).toBe(true)
    const ids = results.map((r) => JSON.parse(r.out).id).sort()
    expect(ids).toEqual(['T-006', 'T-007', 'T-008'])
  }, 30_000)

  it('routes through a running server, interleaved with UI creates, without duplicate ids', async () => {
    const srv = await start({ root, port: 0 })
    try {
      const base = `http://127.0.0.1:${srv.port}`
      const ui = () =>
        fetch(`${base}/api/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: base, 'X-Nodit-Token': srv.owner.token },
          body: JSON.stringify({ type: 'task', title: 'From UI' }),
        }).then((r) => r.json())
      const [a, b, c] = await Promise.all([nodit('new', 'task', 'CLI A', '--dir', root, '--json'), nodit('new', 'task', 'CLI B', '--dir', root, '--json'), ui()])
      const ids = [JSON.parse(a.out).id, JSON.parse(b.out).id, c.doc.card.id].sort()
      expect(new Set(ids).size).toBe(3)
      expect(ids).toEqual(['T-006', 'T-007', 'T-008'])
      expect(srv.project.snapshot().docs.filter((d) => d.kind === 'task')).toHaveLength(8)
    } finally {
      await srv.close()
    }
  }, 30_000)

  it('does not take over when the lock-holding server does not answer health', async () => {
    const silent: Server = createServer(() => {})
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()))
    const owner = await acquireOwner(root, 'server')
    await owner.setPort((silent.address() as { port: number }).port)
    try {
      const before = await taskFiles()
      const r = await nodit('new', 'task', 'Should not write', '--dir', root)
      expect(r.code).toBe(3)
      expect(r.err).toContain('沒有回應')
      expect(await taskFiles()).toEqual(before)
    } finally {
      await owner.release()
      silent.close()
    }
  }, 30_000)

  it('rejects an unsupported relation with diagnostics', async () => {
    const r = await nodit('new', 'adr', 'Bad', '--dir', root, '--milestone', 'MS-01')
    expect(r.code).toBe(1)
    expect(r.err).toContain('adr 不能有 part-of')
  }, 30_000)
})

describe('lock recovery', () => {
  it('only one of two processes reclaims a genuinely stale lock', async () => {
    const script = path.join(REPO, 'tests/fixtures/acquire.ts')
    const child = () => {
      const c = spawn(TSX, [script, root], { cwd: REPO })
      // a child that reported busy exits on its own; writing "release" to it must not fail the run
      c.stdin.on('error', () => {})
      const lines: string[] = []
      const waiters: (() => void)[] = []
      c.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        lines.push(...chunk.split('\n').filter(Boolean))
        waiters.splice(0).forEach((w) => w())
      })
      const line = async (n: number) => {
        while (lines.length < n) await new Promise<void>((r) => waiters.push(r))
        return lines[n - 1]
      }
      return { c, line, done: new Promise((r) => c.on('exit', r)) }
    }
    // both processes are running before "go", and both report before either releases
    for (let i = 0; i < 5; i++) {
      const p = lockPaths(root)
      await mkdir(p.lockfilePath, { recursive: true })
      const old = new Date(Date.now() - 60_000)
      await utimes(p.lockfilePath, old, old)
      const xs = [child(), child()]
      await Promise.all(xs.map((x) => x.line(1)))
      xs.forEach((x) => x.c.stdin.write('go\n'))
      const outs = await Promise.all(xs.map((x) => x.line(2)))
      xs.forEach((x) => x.c.stdin.write('release\n'))
      await Promise.all(xs.map((x) => x.done))
      expect(outs.sort(), outs.join(' / ')).toEqual(['busy', 'ok'])
    }
  }, 60_000)
})

describe('nodit init', () => {
  let fresh: string
  beforeEach(async () => {
    fresh = await mkdtemp(path.join(tmpdir(), 'nodit-init-cli-'))
  })
  afterEach(async () => {
    await rm(fresh, { recursive: true, force: true })
  })

  it('dry-run writes nothing; non-interactive without --yes refuses', async () => {
    const dry = await nodit('init', fresh, '--dry-run')
    expect(dry.code).toBe(0)
    expect(dry.out).toContain('新建')
    expect(await readdir(fresh)).toEqual([])
    const refused = await nodit('init', fresh)
    expect(refused.code).toBe(1)
    expect(await readdir(fresh)).toEqual([])
  }, 30_000)

  it('applies offline with --yes and is idempotent', async () => {
    const first = await nodit('init', fresh, '--yes')
    expect(first.code).toBe(0)
    expect((await readdir(fresh)).sort()).toEqual(['.claude', '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'docs', 'nodit.config.json'])
    const second = await nodit('init', fresh, '--dry-run')
    expect(second.out).not.toMatch(/新建|附加|衝突/)
  }, 30_000)

  it('applies through a running server', async () => {
    const srv = await start({ root: fresh, port: 0 })
    try {
      expect(srv.project.configExists).toBe(false)
      const r = await nodit('init', fresh, '--yes', '--no-ai')
      expect(r.code).toBe(0)
      expect(srv.project.configExists).toBe(true)
      expect((await readdir(fresh)).includes('AGENTS.md')).toBe(false)
    } finally {
      await srv.close()
    }
  }, 30_000)
})

