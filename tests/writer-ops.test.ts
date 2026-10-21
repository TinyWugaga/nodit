import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../core/config'
import { acquireOwner, type Owner } from '../core/owner'
import { parseDoc } from '../core/parse'
import { ConflictError, ValidationError, Writer } from '../core/writer'

const ADR = 'docs/decisions/ADR-001-a.md'
const ADR_TEXT = '---\nid: ADR-001\ntype: adr\ntitle: A\nstatus: accepted\n---\n\n## Context\n\nold context\n\n## Decision\n\nold decision\n\n## Notes\n\nkeep me\n'
const TASK = 'docs/tasks/T-001-a.md'
const TASK_TEXT = '---\nid: T-001\ntype: task\ntitle: T\nstatus: todo\nrelates: [ADR-001]\n---\n\n## Description\n\nd\n'

let root: string
let owner: Owner
let writer: Writer

const read = (rel: string) => readFile(path.join(root, rel), 'utf8')
const doc = async (rel: string, kind: 'adr' | 'task' | 'milestone') => parseDoc(rel, await readFile(path.join(root, rel)), kind)

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nodit-ops-'))
  await mkdir(path.join(root, 'docs/decisions'), { recursive: true })
  await mkdir(path.join(root, 'docs/tasks'), { recursive: true })
  await writeFile(path.join(root, ADR), ADR_TEXT)
  await writeFile(path.join(root, TASK), TASK_TEXT)
  owner = await acquireOwner(root, 'cli')
  writer = new Writer(root, (await loadConfig(root)).config, owner)
})

afterEach(async () => {
  await owner.release()
  await rm(root, { recursive: true, force: true })
})

describe('sections', () => {
  it('replaces one section, appends a missing one, keeps custom sections', async () => {
    const d = await doc(ADR, 'adr')
    await writer.updateDoc(d, d.revision, { sections: { Decision: 'new decision', Consequences: 'cost' } })
    const text = await read(ADR)
    expect(text).toContain('## Context\n\nold context\n\n## Decision\n\nnew decision\n\n## Notes\n\nkeep me\n')
    expect(text.endsWith('## Consequences\n\ncost\n')).toBe(true)
  })

  it('refuses to edit a duplicated section', async () => {
    await writeFile(path.join(root, ADR), ADR_TEXT + '\n## Decision\n\nagain\n')
    const d = await doc(ADR, 'adr')
    await expect(writer.updateDoc(d, d.revision, { sections: { Decision: 'x' } })).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('raw', () => {
  it('rejects invalid content with diagnostics and leaves the file untouched', async () => {
    const d = await doc(ADR, 'adr')
    const err = await writer.writeRaw(d, d.revision, '---\nid: [oops\n---\n').catch((e) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).diagnostics[0].code).toBe('yaml-invalid')
    expect(await read(ADR)).toBe(ADR_TEXT)
  })

  it('rejects an id already used by another document', async () => {
    const d = await doc(TASK, 'task')
    const renamed = await writer.writeRaw(d, d.revision, TASK_TEXT.replace('id: T-001', 'id: T-002'))
    expect(renamed.changed).toBe(true)
    await writeFile(path.join(root, 'docs/tasks/T-003-b.md'), TASK_TEXT.replace('T-001', 'T-003'))
    const again = await doc(TASK, 'task')
    const dup = await writer.writeRaw(again, again.revision, TASK_TEXT.replace('T-001', 'T-003')).catch((e) => e)
    expect(dup).toBeInstanceOf(ValidationError)
    expect((dup as ValidationError).diagnostics.some((x) => x.code === 'id-duplicate')).toBe(true)
  })

  it('repairs a broken document that has no usable id', async () => {
    await writeFile(path.join(root, 'docs/tasks/broken.md'), '---\ntitle: [\n---\n')
    const broken = await doc('docs/tasks/broken.md', 'task')
    expect(broken.card).toBeUndefined()
    await writer.writeRaw(broken, broken.revision, '---\nid: T-009\ntype: task\ntitle: fixed\nstatus: todo\n---\n')
    expect((await doc('docs/tasks/broken.md', 'task')).card?.id).toBe('T-009')
  })
})

describe('links', () => {
  it('adds and removes relations on the storing document only', async () => {
    const d = await doc(TASK, 'task')
    await writer.patchLinks(d, d.revision, { add: [{ rel: 'implements', to: 'ADR-001' }], remove: [{ rel: 'relates', to: 'ADR-001' }] })
    const text = await read(TASK)
    expect(text).toContain('implements: [ADR-001]')
    expect(text).not.toContain('relates')
    expect(await read(ADR)).toBe(ADR_TEXT)
  })

  it('rejects relations the card kind cannot hold', async () => {
    const d = await doc(ADR, 'adr')
    await expect(writer.patchLinks(d, d.revision, { add: [{ rel: 'part-of', to: 'MS-01' }] })).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('create / delete / layout', () => {
  it('allocates sequential ids and never overwrites', async () => {
    const a = await writer.createCard({ type: 'task', title: 'Write docs', links: [{ rel: 'implements', to: 'ADR-001' }] })
    const b = await writer.createCard({ type: 'task', title: '中文標題' })
    expect([a.card?.id, b.card?.id]).toEqual(['T-002', 'T-003'])
    expect(a.path).toBe('docs/tasks/T-002-write-docs.md')
    expect(b.path).toBe('docs/tasks/T-003-card.md')
    expect(a.card?.links.implements).toEqual(['ADR-001'])
  })

  it('deletes only with the current revision', async () => {
    const d = await doc(TASK, 'task')
    await writeFile(path.join(root, TASK), TASK_TEXT + '\nexternal\n')
    await expect(writer.deleteDoc(d, d.revision)).rejects.toBeInstanceOf(ConflictError)
    const fresh = await doc(TASK, 'task')
    await writer.deleteDoc(fresh, fresh.revision)
    expect(await readdir(path.join(root, 'docs/tasks'))).toEqual([])
  })

  it('creates the layout only when it is absent, then requires its revision', async () => {
    const first = await writer.writeLayout('absent', { 'ADR-001': { x: 1.4, y: 2.6 } })
    expect(JSON.parse(await read('.nodit/layout.json'))).toEqual({ 'ADR-001': { x: 1, y: 3 } })
    await expect(writer.writeLayout('absent', {})).rejects.toBeInstanceOf(ConflictError)
    await writer.writeLayout(first.revision, { 'T-001': { x: 0, y: 0 } })
  })
})
