import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../core/config'
import { CARD_KINDS, inferLinkKind, LINK_SCHEMA, shouldReverse } from '../core/domain'
import { bodyBlobHash, gitBlobHash, parseDoc, type ParsedDoc } from '../core/parse'
import type { ClientDoc, Envelope, ProjectPayload } from '../core/protocol'
import { crossValidate } from '../core/scan'
import { linkSpecs, revOf } from '../core/spec'
import { start, type RunningServer } from '../server/server'

const run = promisify(execFile)
const REPO = path.resolve(__dirname, '..')
const ADR1 = 'docs/decisions/ADR-001-react-flow-canvas.md'
const SPEC = 'docs/specs/SPEC-001-canvas.md'

const adrText = (status = 'accepted', body = '\n## Context\n\nc\n', extra = '') =>
  `---\nid: ADR-001\ntype: adr\ntitle: Canvas\nstatus: ${status}\ndate: 2026-10-01\n${extra}---\n${body}`

const specText = (fm: string, body = '\n## Scope\n\ns\n') =>
  `---\nid: SPEC-001\ntype: spec\ntitle: Canvas spec\n${fm}\n---\n${body}`

const adr = (text = adrText(), rel = ADR1) => parseDoc(rel, Buffer.from(text, 'utf8'), 'adr')
const spec = (fm: string, rel = SPEC) => parseDoc(rel, Buffer.from(specText(fm), 'utf8'), 'spec')
const codes = (d: ParsedDoc | ClientDoc) => d.diagnostics.map((x) => `${x.level}:${x.code}`)
const states = (d: ParsedDoc | ClientDoc | undefined) => d?.specAdrs?.map((s) => [s.id, s.state])
const specOf = (docs: ParsedDoc[]) => docs.find((d) => d.kind === 'spec')!

describe('spec link inference', () => {
  it('every drag between two kinds, both directions, lands on a relation LINK_SCHEMA allows', () => {
    let pairs = 0
    for (const a of CARD_KINDS) {
      for (const b of CARD_KINDS) {
        const [src, tgt] = shouldReverse(a, b) ? [b, a] : [a, b]
        const rel = inferLinkKind(src, tgt)
        expect(LINK_SCHEMA[src][rel]?.target, `${a} → ${b} inferred ${src} ${rel} ${tgt}`).toContain(tgt)
        pairs++
      }
    }
    expect(pairs).toBe(16)
  })

  it('stores implements on the task, milestone or spec side and relates between specs', () => {
    const drag = (a: (typeof CARD_KINDS)[number], b: (typeof CARD_KINDS)[number]) => {
      const [src, tgt] = shouldReverse(a, b) ? [b, a] : [a, b]
      return `${src} ${inferLinkKind(src, tgt)} ${tgt}`
    }
    expect(drag('spec', 'task')).toBe('task implements spec')
    expect(drag('task', 'spec')).toBe('task implements spec')
    expect(drag('spec', 'milestone')).toBe('milestone implements spec')
    expect(drag('adr', 'spec')).toBe('spec implements adr')
    expect(drag('spec', 'adr')).toBe('spec implements adr')
    expect(drag('spec', 'spec')).toBe('spec relates spec')
  })
})

describe('parse spec', () => {
  it('accepts a valid spec with adr_rev and keeps plain hex values as strings', () => {
    const hex = '1'.repeat(40)
    const d = spec(`status: draft\nimplements: [ADR-001]\nadr_rev:\n  ADR-001: ${hex}`)
    expect(codes(d)).toEqual([])
    expect(d.card?.adrRev).toEqual({ 'ADR-001': hex })
    expect(Object.keys(d.sections)).toEqual(['Scope', 'Design', 'Acceptance Criteria'])
  })

  it('validates adr_rev shape and values, and ignores keys outside implements with a warning', () => {
    expect(codes(spec('status: draft\nimplements: [ADR-001]\nadr_rev: [x]'))).toContain('error:spec-rev-invalid')
    expect(codes(spec('status: draft\nimplements: [ADR-001]\nadr_rev:\n  ADR-001: ABC'))).toContain('error:spec-rev-invalid')
    const unknown = spec(`status: draft\nimplements: [ADR-001]\nadr_rev:\n  ADR-002: ${'a'.repeat(40)}`)
    expect(codes(unknown)).toEqual(['warning:spec-rev-unknown'])
    expect(unknown.card?.adrRev).toEqual({})
  })

  it('only allows the spec link targets', () => {
    expect(codes(spec('status: draft\nimplements: [T-001]'))).toContain('error:link-target')
    expect(codes(spec('status: draft\nsupersedes: [ADR-001]'))).toContain('error:link-target')
    expect(codes(spec('status: draft\nsupersedes: [SPEC-002]\nrelates: [T-001, MS-01]'))).toEqual([])
    const task = parseDoc('docs/tasks/T-001-x.md', Buffer.from('---\nid: T-001\ntype: task\ntitle: x\nstatus: todo\nimplements: [SPEC-001, ADR-001]\n---\n'), 'task')
    expect(codes(task)).toEqual([])
  })

  it('infers a legacy spec ID from the file name and strips the prefix from the H1 title', () => {
    const d = parseDoc('docs/specs/SPEC-001-login.md', Buffer.from('# SPEC-001 — Login\n\n## Scope\n'), 'spec')
    expect(d.card).toMatchObject({ id: 'SPEC-001', title: 'Login', status: 'draft' })
  })
})

describe('body fingerprint', () => {
  it('ignores frontmatter edits and follows body edits', () => {
    const base = bodyBlobHash(Buffer.from(adrText()))
    expect(bodyBlobHash(Buffer.from(adrText('proposed')))).toBe(base)
    expect(bodyBlobHash(Buffer.from(adrText('accepted', undefined, 'relates: [ADR-002]\n')))).toBe(base)
    expect(bodyBlobHash(Buffer.from(adrText('accepted', '\n## Context\n\nchanged\n')))).not.toBe(base)
    expect(base).toBe(gitBlobHash(Buffer.from('\n## Context\n\nc\n')))
  })

  it('hashes the whole file when there is no frontmatter, and the raw bytes after a BOM and CRLF fence', () => {
    const plain = Buffer.from('# ADR-001 x\n')
    expect(bodyBlobHash(plain)).toBe(gitBlobHash(plain))
    const crlf = Buffer.from('﻿---\r\nid: ADR-001\r\n---\r\n本文\r\n')
    expect(bodyBlobHash(crlf)).toBe(gitBlobHash(Buffer.from('本文\r\n')))
  })
})

describe('linkSpecs', () => {
  const rev = bodyBlobHash(Buffer.from(adrText()))
  const committed = (status: string, adrStatus = 'accepted') =>
    specOf(crossValidate([adr(adrText(adrStatus)), spec(`status: ${status}\nimplements: [ADR-001]\nadr_rev:\n  ADR-001: ${rev}`)]).docs)

  it('derives current, stale, unrecorded and missing per implemented ADR', () => {
    const s = spec(`status: draft\nimplements: [ADR-001, ADR-002, ADR-003]\nadr_rev:\n  ADR-001: ${rev}\n  ADR-003: ${'b'.repeat(40)}`)
    const adr2 = adr(adrText().replace(/ADR-001/g, 'ADR-002'), 'docs/decisions/ADR-002-x.md')
    expect(states(specOf(linkSpecs([adr(), adr2, s]).docs))).toEqual([
      ['ADR-001', 'current'],
      ['ADR-002', 'unrecorded'],
      ['ADR-003', 'missing'],
    ])
    const edited = adr(adrText('accepted', '\n## Context\n\nedited\n'))
    expect(states(specOf(linkSpecs([edited, s]).docs))?.[0]).toEqual(['ADR-001', 'stale'])
  })

  it('stays current when only the ADR frontmatter changes', () => {
    const s = spec(`status: draft\nimplements: [ADR-001]\nadr_rev:\n  ADR-001: ${rev}`)
    const fmOnly = adr(adrText('proposed', undefined, 'relates: [T-001]\n').replace('2026-10-01', '2026-11-11'))
    expect(states(specOf(linkSpecs([fmOnly, s]).docs))).toEqual([['ADR-001', 'current']])
  })

  it('marks a duplicated or retained-only ADR invalid and recovers once repaired', () => {
    const s = spec(`status: approved\nimplements: [ADR-001]\nadr_rev:\n  ADR-001: ${rev}`)
    const dup = adr(adrText('proposed'), 'docs/decisions/ADR-001-copy.md')
    const linked = specOf(crossValidate([adr(), dup, s]).docs)
    expect(states(linked)).toEqual([['ADR-001', 'invalid']])
    expect(codes(linked)).not.toContain('warning:spec-adr-not-accepted')
    expect(states(specOf(linkSpecs([{ ...adr(), stale: true }, s]).docs))).toEqual([['ADR-001', 'invalid']])
    expect(states(specOf(linkSpecs([adr(), s]).docs))).toEqual([['ADR-001', 'current']])
  })

  it('shows no state for a spec that implements no ADR', () => {
    expect(specOf(linkSpecs([adr(), spec('status: draft')]).docs).specAdrs).toEqual([])
  })

  it('warns only for approved or implemented specs whose ADR is not accepted, by ADR status', () => {
    const msg = (d: ParsedDoc) => d.diagnostics.filter((x) => x.code === 'spec-adr-not-accepted').map((x) => x.message)
    expect(msg(committed('approved', 'proposed'))).toEqual(['ADR-001 尚未確認'])
    expect(msg(committed('implemented', 'superseded'))).toEqual(['ADR-001 已廢止或被取代，考慮把 Spec 標為 outdated'])
    expect(msg(committed('implemented', 'deprecated'))).toHaveLength(1)
    expect(msg(committed('draft', 'proposed'))).toEqual([])
    expect(msg(committed('approved', 'accepted'))).toEqual([])
  })
})

describe('supersede-status', () => {
  it('expects outdated on a superseded spec and superseded on a superseded ADR', () => {
    const old = spec('status: approved', 'docs/specs/SPEC-001-old.md')
    const next = parseDoc('docs/specs/SPEC-002-new.md', Buffer.from(specText('status: draft\nsupersedes: [SPEC-001]').replace('SPEC-001\ntype', 'SPEC-002\ntype')), 'spec')
    const out = crossValidate([old, next]).docs
    expect(codes(out[0])).toContain('warning:supersede-status')
    const fixed = crossValidate([spec('status: outdated', 'docs/specs/SPEC-001-old.md'), next]).docs
    expect(codes(fixed[0])).not.toContain('warning:supersede-status')
  })
})

describe('revOf', () => {
  it('returns the body fingerprint, or a reason when the ID does not resolve to one valid file', () => {
    expect(revOf([adr()], 'ADR-001')).toEqual({ ok: true, rev: bodyBlobHash(Buffer.from(adrText())), path: ADR1 })
    expect(revOf([adr()], 'ADR-002')).toMatchObject({ ok: false })
    expect(revOf([adr()], 'nope')).toMatchObject({ ok: false })
    expect(revOf([adr(), adr(adrText(), 'docs/decisions/ADR-001-b.md')], 'ADR-001')).toMatchObject({ ok: false })
    const broken = adr('---\nid: ADR-001\ntitle: [\n---\n', 'docs/decisions/ADR-001-broken.md')
    expect(revOf([broken], 'ADR-001')).toMatchObject({ ok: false, message: expect.stringContaining('解析失敗') })
  })
})

describe('specs through the project service', () => {
  let root: string
  let srv: RunningServer
  const origin = () => `http://127.0.0.1:${srv.port}`
  const project = async (): Promise<Envelope<ProjectPayload>> => (await fetch(`${origin()}/api/project`)).json()
  const specDoc = async () => (await project()).docs.find((d) => d.path === SPEC)
  const nodit = (...args: string[]) =>
    run(path.join(REPO, 'node_modules/.bin/tsx'), [path.join(REPO, 'server/cli.ts'), ...args], { cwd: REPO }).then(
      (r) => ({ code: 0, out: r.stdout.trim(), err: r.stderr.trim() }),
      (e) => ({ code: e.code as number, out: String(e.stdout).trim(), err: String(e.stderr).trim() }),
    )

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'nodit-spec-'))
    await cp(path.resolve(__dirname, '../examples/demo'), root, {
      recursive: true,
      filter: (src) => !/[\\/]\.nodit[\\/](writer\.lock|owner\.json|token)/.test(src),
    })
    const rev = bodyBlobHash(await readFile(path.join(root, ADR1)))
    await mkdir(path.join(root, 'docs/specs'), { recursive: true })
    await writeFile(path.join(root, SPEC), specText(`status: approved\ndate: 2026-10-29\nimplements: [ADR-001]\nadr_rev:\n  ADR-001: ${rev}`))
  })
  afterEach(async () => {
    await srv?.close()
    await rm(root, { recursive: true, force: true })
  })

  it('nodit rev prints the same fingerprint the linking pass compares against, and fails for unknown IDs', async () => {
    const r = await nodit('rev', 'ADR-001', '--dir', root)
    expect(r).toMatchObject({ code: 0, out: bodyBlobHash(await readFile(path.join(root, ADR1))) })
    const missing = await nodit('rev', 'ADR-999', '--dir', root)
    expect(missing.code).not.toBe(0)
    expect(missing.out).toBe('')
  }, 30_000)

  it('falls back to docs/specs for a config written before specs existed', async () => {
    const config = JSON.parse(await readFile(path.join(root, 'nodit.config.json'), 'utf8'))
    expect(config.paths?.spec).toBeUndefined()
    expect((await loadConfig(root)).config.paths.spec).toBe('docs/specs')
  })

  it('nodit new spec creates a spec under docs/specs implementing a spec-ready ADR', async () => {
    const r = await nodit('new', 'spec', 'Login flow', '--implements', 'ADR-001', '--dir', root, '--json')
    expect(r.code).toBe(0)
    const created = JSON.parse(r.out)
    expect(created).toEqual({ id: 'SPEC-002', path: 'docs/specs/SPEC-002-login-flow.md' })
    const text = await readFile(path.join(root, created.path), 'utf8')
    expect(text).toContain('status: draft')
    expect(text).toContain('## Acceptance Criteria')
  }, 30_000)

  it('updates spec states on ADR edits, deletion and recreation without rewriting the spec', async () => {
    srv = await start({ root, port: 0 })
    const specBytes = await readFile(path.join(root, SPEC))
    expect(states(await specDoc())).toEqual([['ADR-001', 'current']])

    const original = await readFile(path.join(root, ADR1), 'utf8')
    await writeFile(path.join(root, ADR1), original.replace('status: accepted', 'status: proposed').replace('2026-10-01', '2026-10-02'))
    await srv.project.rescan()
    let s = await specDoc()
    expect(states(s)).toEqual([['ADR-001', 'current']])
    expect(codes(s!)).toContain('warning:spec-adr-not-accepted')

    await writeFile(path.join(root, ADR1), original)
    await srv.project.rescan()
    s = await specDoc()
    expect(codes(s!)).not.toContain('warning:spec-adr-not-accepted')

    const rev0 = (await project()).rev
    await writeFile(path.join(root, ADR1), original + '\n補充\n')
    await srv.project.rescan()
    expect(states(await specDoc())).toEqual([['ADR-001', 'stale']])
    expect((await project()).rev).toBeGreaterThan(rev0)

    await unlink(path.join(root, ADR1))
    await srv.project.rescan()
    expect(states(await specDoc())).toEqual([['ADR-001', 'missing']])

    await writeFile(path.join(root, ADR1), original)
    await srv.project.rescan()
    expect(states(await specDoc())).toEqual([['ADR-001', 'current']])

    await writeFile(path.join(root, ADR1), '---\nid: ADR-001\ntitle: [\n---\n')
    await srv.project.rescan()
    expect(states(await specDoc())).toEqual([['ADR-001', 'invalid']])

    await writeFile(path.join(root, ADR1), original)
    await srv.project.rescan()
    expect(states(await specDoc())).toEqual([['ADR-001', 'current']])

    expect(await readFile(path.join(root, SPEC))).toEqual(specBytes)
  })

  it('updates spec states when the ADR is edited through the UI', async () => {
    srv = await start({ root, port: 0 })
    const a = (await project()).docs.find((d) => d.path === ADR1)!
    const headers = { 'Content-Type': 'application/json', Origin: origin(), 'X-Nodit-Token': srv.owner.token, 'X-Nodit-Session': srv.project.sessionId }
    const res = await fetch(`${origin()}/api/docs/${a.docKey}`, { method: 'PATCH', headers, body: JSON.stringify({ baseRevision: a.revision, fields: { status: 'proposed' } }) })
    expect(res.status).toBe(200)
    const s = await specDoc()
    expect(states(s)).toEqual([['ADR-001', 'current']])
    expect(codes(s!)).toContain('warning:spec-adr-not-accepted')
  })
})
