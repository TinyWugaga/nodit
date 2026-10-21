import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../core/config'
import { ImportError, importFingerprint, importJobPath, runImport, type ImportHooks, type ImportJob } from '../core/import'
import { acquireOwner, type Owner } from '../core/owner'
import { parseDoc } from '../core/parse'
import { scanDocs } from '../core/scan'
import { Writer } from '../core/writer'
import { start } from '../server/server'

const REPO = path.resolve(__dirname, '..')
const run = promisify(execFile)

const U = {
  adr1: '0b5d6f0e-1111-4c1a-9a00-000000000001',
  adr2: '0b5d6f0e-1111-4c1a-9a00-000000000002',
  adr3: '0b5d6f0e-1111-4c1a-9a00-000000000003',
  ms1: '0b5d6f0e-1111-4c1a-9a00-000000000004',
  t1: '0b5d6f0e-1111-4c1a-9a00-000000000005',
  t2: '0b5d6f0e-1111-4c1a-9a00-000000000006',
}

function card(id: string, x: number, y: number, data: Record<string, unknown>) {
  return { id, type: 'card', position: { x, y }, data: { ...data, updatedAt: 1 } }
}

function edge(id: string, source: string, target: string, kind: string) {
  return { id, type: 'link', source, target, data: { kind } }
}

/** shape of the zustand persist value stored under `nodit:project` */
const LEGACY = JSON.stringify({
  state: {
    projectName: 'Old board',
    counters: { adr: 3, milestone: 1, task: 2 },
    nodes: [
      card(U.adr1, 0, 0, { kind: 'adr', code: 'ADR-001', title: 'Canvas engine', status: 'accepted', date: '2026-10-01', context: 'ctx', decision: 'dec', consequences: 'con' }),
      card(U.adr2, 0, 280, { kind: 'adr', code: 'ADR-002', title: 'Storage', status: 'superseded', date: '2026-10-03', context: '', decision: '', consequences: '' }),
      card(U.adr3, -460, 300, { kind: 'adr', code: 'ADR-002', title: 'Use IndexedDB', status: 'proposed', date: '', context: '', decision: '', consequences: '' }),
      card(U.ms1, 460, 100.4, { kind: 'milestone', code: 'MS-01', title: 'MVP', status: 'active', dueDate: '2026-11-01', goal: 'ship' }),
      card(U.t1, 920, -80, { kind: 'task', code: 'T-001', title: 'Card node', status: 'done', priority: 'high', assignee: 'Tiny', description: 'shared frame' }),
      card(U.t2, 920, 130, { kind: 'task', code: 'T-002', title: 'Edges', status: 'doing', priority: 'nope', assignee: '', description: '' }),
    ],
    edges: [
      edge('e1', U.ms1, U.adr1, 'implements'),
      edge('e2', U.adr3, U.adr2, 'supersedes'),
      edge('e3', U.ms1, U.t1, 'part-of'),
      edge('e4', U.t2, U.ms1, 'part-of'),
      edge('e5', U.t2, U.t1, 'depends'),
      edge('e6', U.adr1, U.t2, 'relates'),
    ],
  },
  version: 0,
})

let root: string
let owner: Owner | undefined

async function importOnce(hooks?: ImportHooks, text = LEGACY) {
  owner = await acquireOwner(root, 'cli')
  try {
    const { config, exists } = await loadConfig(root)
    return await runImport(root, new Writer(root, config, owner), config, exists, text, hooks)
  } finally {
    await owner.release()
    owner = undefined
  }
}

async function cardFiles() {
  const { config } = await loadConfig(root)
  return (await scanDocs(root, config)).map((d) => d.path)
}

async function readJob(): Promise<ImportJob> {
  return JSON.parse(await readFile(path.join(root, importJobPath(importFingerprint(LEGACY))), 'utf8'))
}

async function interruptAfter(n: number) {
  let count = 0
  await expect(
    importOnce({
      afterWrite: () => {
        if (++count === n) throw new Error('simulated crash')
      },
    }),
  ).rejects.toThrow('simulated crash')
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nodit-import-'))
  await writeFile(path.join(root, 'nodit.config.json'), JSON.stringify({ schemaVersion: 1, projectId: 'p-import', managed: {} }))
})

afterEach(async () => {
  await owner?.release()
  await rm(root, { recursive: true, force: true })
})

describe('legacy import', () => {
  it('converts cards, relation direction and layout; persists the full plan before the first card', async () => {
    let jobAtFirstWrite: ImportJob | undefined
    const report = await importOnce({
      afterWrite: async () => {
        jobAtFirstWrite ??= await readJob()
      },
    })
    expect(report).toMatchObject({ status: 'completed', resumed: false, total: 6 })
    expect(jobAtFirstWrite!.items).toHaveLength(6)
    expect(jobAtFirstWrite!.written).toEqual([])
    expect(Object.keys(jobAtFirstWrite!.mapping).sort()).toEqual(Object.values(U).sort())

    const job = await readJob()
    expect(job.mapping[U.adr3]).toBe('ADR-003')
    expect(job.completedAt).toBeTruthy()

    const { config } = await loadConfig(root)
    const docs = await scanDocs(root, config)
    const byId = Object.fromEntries(docs.map((d) => [d.card!.id, d]))
    expect(Object.keys(byId).sort()).toEqual(['ADR-001', 'ADR-002', 'ADR-003', 'MS-01', 'T-001', 'T-002'])
    expect(docs.every((d) => d.writable)).toBe(true)
    expect(byId['MS-01'].card!.links.implements).toEqual(['ADR-001'])
    expect(byId['ADR-003'].card!.links.supersedes).toEqual(['ADR-002'])
    expect(byId['T-001'].card!.links.milestone).toBe('MS-01')
    expect(byId['T-002'].card!.links.milestone).toBe('MS-01')
    expect(byId['T-002'].card!.links.depends).toEqual(['T-001'])
    expect(byId['T-002'].card!.links.relates).toEqual(['ADR-001'])
    expect(byId['T-002'].card!.priority).toBeUndefined()
    expect(byId['ADR-001'].sectionStates.Decision).toMatchObject({ state: 'ok', text: 'dec' })

    const layout = JSON.parse(await readFile(path.join(root, '.nodit/layout.json'), 'utf8'))
    expect(layout['MS-01']).toEqual({ x: 460, y: 100 })
    expect(Object.keys(layout)).toHaveLength(6)

    expect(await importOnce()).toMatchObject({ status: 'already-complete' })
  })

  it('a card written before the progress record was updated is adopted on rerun, not duplicated', async () => {
    await interruptAfter(2)
    const job = await readJob()
    expect(job.written).toHaveLength(1)
    expect(await cardFiles()).toHaveLength(2)

    const report = await importOnce()
    expect(report).toMatchObject({ status: 'completed', resumed: true, total: 6 })
    expect(report.adopted).toHaveLength(1)
    expect(report.created).toHaveLength(4)

    const files = await cardFiles()
    expect(files).toHaveLength(6)
    const after = await readJob()
    expect(after.mapping).toEqual(job.mapping)
    expect(after.jobId).toBe(job.jobId)
    const { config } = await loadConfig(root)
    const ids = (await scanDocs(root, config)).map((d) => d.card!.id)
    expect(new Set(ids).size).toBe(6)
  })

  it('stops with a conflict and does not overwrite a card edited after the interruption', async () => {
    await interruptAfter(3)
    const job = await readJob()
    const edited = job.items.find((i) => i.id === job.written[0])!
    const abs = path.join(root, edited.path)
    const mine = (await readFile(abs, 'utf8')).replace(/title: .*/, 'title: Edited by hand')
    await writeFile(abs, mine)
    const before = await cardFiles()

    const err = await importOnce().catch((e) => e)
    expect(err).toBeInstanceOf(ImportError)
    expect(err.code).toBe('conflict')
    expect(err.conflicts).toEqual([expect.objectContaining({ id: edited.id, path: edited.path })])
    expect(await readFile(abs, 'utf8')).toBe(mine)
    expect(await cardFiles()).toEqual(before)
    expect((await readJob()).completedAt).toBeUndefined()
  })

  it('stops when a pending id was taken by a card created after the interruption', async () => {
    await interruptAfter(1)
    const job = await readJob()
    const pending = job.items.find((i) => i.id === 'T-001')!
    await mkdir(path.join(root, 'docs/tasks'), { recursive: true })
    await writeFile(
      path.join(root, 'docs/tasks', `${pending.id}-other.md`),
      `---\nid: ${pending.id}\ntype: task\ntitle: Other\nstatus: todo\n---\n`,
    )
    const err = await importOnce().catch((e) => e)
    expect(err.code).toBe('conflict')
    expect(err.conflicts.map((c: { id: string }) => c.id)).toContain(pending.id)
  })

  it('refuses a first import into a project that already has cards', async () => {
    await mkdir(path.join(root, 'docs/tasks'), { recursive: true })
    await writeFile(path.join(root, 'docs/tasks/T-001-x.md'), '---\nid: T-001\ntype: task\ntitle: X\nstatus: todo\n---\n')
    const err = await importOnce().catch((e) => e)
    expect(err).toBeInstanceOf(ImportError)
    expect(err.code).toBe('not-empty')
    expect(await readdir(path.join(root, '.nodit')).catch(() => [])).not.toContain(path.basename(importJobPath(importFingerprint(LEGACY))))
    expect(await cardFiles()).toEqual(['docs/tasks/T-001-x.md'])
  })

  it('refuses to resume a job recorded for another project', async () => {
    await interruptAfter(1)
    await writeFile(path.join(root, 'nodit.config.json'), JSON.stringify({ schemaVersion: 1, projectId: 'p-other', managed: {} }))
    const err = await importOnce().catch((e) => e)
    expect(err.code).toBe('job-mismatch')
  })

  it('imports through the running server, and the CLI routes there too', async () => {
    const srv = await start({ root, port: 0 })
    try {
      const file = path.join(root, 'legacy.json')
      await writeFile(file, LEGACY)
      const r = await run(path.join(REPO, 'node_modules/.bin/tsx'), [path.join(REPO, 'server/cli.ts'), 'import', file, root], { cwd: REPO })
      expect(r.stdout).toContain('匯入完成')
      const snap = srv.project.snapshot()
      expect(snap.docs.map((d) => d.card?.id).sort()).toEqual(['ADR-001', 'ADR-002', 'ADR-003', 'MS-01', 'T-001', 'T-002'])
      const base = `http://127.0.0.1:${srv.port}`
      const again = await fetch(`${base}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: base, 'X-Nodit-Token': srv.owner.token },
        body: JSON.stringify({ text: LEGACY }),
      }).then((res) => res.json())
      expect(again.report.status).toBe('already-complete')
    } finally {
      await srv.close()
    }
  }, 30_000)
})

it('rendered import output parses as a clean card', async () => {
  const { planImport } = await import('../core/import')
  const { config } = await loadConfig(root)
  const plan = planImport(LEGACY, config)
  for (const item of plan.items) {
    const doc = parseDoc(item.path, Buffer.from(item.text), item.kind)
    expect(doc.diagnostics.filter((d) => d.level === 'error')).toEqual([])
  }
  expect(plan.warnings.some((w) => w.includes('ADR-003'))).toBe(true)
})
