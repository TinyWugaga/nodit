import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../core/config'
import { acquireOwner, LOCK_OPTIONS, LockBusyError, readToken, type Owner } from '../core/owner'
import { parseDoc } from '../core/parse'
import { resolveInScope, ScopeError } from '../core/scope'
import { ConflictError, ValidationError, Writer } from '../core/writer'
import { CompromisedError } from '../core/owner'

const REL = 'docs/tasks/T-001-a.md'
const TEXT = '---\nid: T-001\ntype: task\ntitle: A   # c\nstatus: todo\n---\n\n## Description\n\nd\n'

let root: string
let owner: Owner
let writer: Writer

async function current() {
  return parseDoc(REL, await readFile(path.join(root, REL)), 'task')
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nodit-'))
  await mkdir(path.join(root, 'docs/tasks'), { recursive: true })
  await writeFile(path.join(root, REL), TEXT)
  owner = await acquireOwner(root, 'cli')
  writer = new Writer(root, (await loadConfig(root)).config, owner)
})

afterEach(async () => {
  await owner.release()
  await rm(root, { recursive: true, force: true })
})

describe('Writer', () => {
  it('writes a single-field change with minimal diff', async () => {
    const doc = await current()
    const { changed } = await writer.updateDoc(doc, doc.revision, { fields: { status: 'doing' } })
    expect(changed).toBe(true)
    expect(await readFile(path.join(root, REL), 'utf8')).toBe(TEXT.replace('status: todo', 'status: doing'))
  })

  it('does not touch the file for a no-op patch', async () => {
    const doc = await current()
    const before = (await stat(path.join(root, REL))).mtimeMs
    const { changed } = await writer.updateDoc(doc, doc.revision, { fields: { status: 'todo', title: 'A' } })
    expect(changed).toBe(false)
    expect((await stat(path.join(root, REL))).mtimeMs).toBe(before)
  })

  it('rejects a stale base revision with the current document and writes nothing', async () => {
    const doc = await current()
    await writeFile(path.join(root, REL), TEXT.replace('title: A', 'title: External'))
    await expect(writer.updateDoc(doc, doc.revision, { fields: { status: 'done' } })).rejects.toBeInstanceOf(ConflictError)
    expect(await readFile(path.join(root, REL), 'utf8')).toContain('title: External')
    expect(await readFile(path.join(root, REL), 'utf8')).toContain('status: todo')
  })

  it('validates values and refuses unknown keys', async () => {
    const doc = await current()
    await expect(writer.updateDoc(doc, doc.revision, { fields: { status: 'nope' } })).rejects.toBeInstanceOf(ValidationError)
    await expect(writer.updateDoc(doc, doc.revision, { fields: { id: 'T-999' } })).rejects.toBeInstanceOf(ValidationError)
  })

  it('serializes concurrent writes so the second sees the first as a conflict', async () => {
    const doc = await current()
    const results = await Promise.allSettled([
      writer.updateDoc(doc, doc.revision, { fields: { status: 'doing' } }),
      writer.updateDoc(doc, doc.revision, { fields: { status: 'done' } }),
    ])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status === 'rejected' && results[1].reason).toBeInstanceOf(ConflictError)
  })

  it('stops all writes once the lock is compromised', async () => {
    const doc = await current()
    owner.markCompromised(new Error('lock lost'))
    await expect(writer.updateDoc(doc, doc.revision, { fields: { status: 'done' } })).rejects.toBeInstanceOf(CompromisedError)
    expect(await readFile(path.join(root, REL), 'utf8')).toBe(TEXT)
  })
})

describe('owner lock', () => {
  it('refuses a second owner on the same project', async () => {
    await expect(acquireOwner(root, 'server')).rejects.toBeInstanceOf(LockBusyError)
  })

  it('exports one frozen option set shared by every entry point', () => {
    expect(Object.isFrozen(LOCK_OPTIONS)).toBe(true)
    expect(LOCK_OPTIONS).toMatchObject({ stale: 10_000, update: 2_000 })
  })

  it('only hands out the token to the matching owner and session', async () => {
    expect(await readToken(root, owner.info)).toBe(owner.token)
    expect(await readToken(root, { ownerId: 'other', sessionId: owner.info.sessionId })).toBeNull()
  })
})

describe('resolveInScope', () => {
  it('blocks traversal, out-of-scope paths and symlink escapes', async () => {
    await expect(resolveInScope(root, '../x.md', ['docs/tasks'])).rejects.toBeInstanceOf(ScopeError)
    await expect(resolveInScope(root, 'src/x.md', ['docs/tasks'])).rejects.toBeInstanceOf(ScopeError)
    const outside = await mkdtemp(path.join(tmpdir(), 'nodit-out-'))
    await symlink(outside, path.join(root, 'docs/tasks/link'))
    await expect(resolveInScope(root, 'docs/tasks/link/new.md', ['docs/tasks'])).rejects.toBeInstanceOf(ScopeError)
    await symlink(path.join(outside, 'f.md'), path.join(root, 'docs/tasks/f.md'))
    await expect(resolveInScope(root, 'docs/tasks/f.md', ['docs/tasks'])).rejects.toBeInstanceOf(ScopeError)
    await expect(resolveInScope(root, 'docs/tasks/sub/new.md', ['docs/tasks'])).resolves.toContain('new.md')
    await rm(outside, { recursive: true, force: true })
  })
})
