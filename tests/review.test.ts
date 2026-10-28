import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../core/config'
import { acquireOwner, type Owner } from '../core/owner'
import { gitBlobHash, parseDoc } from '../core/parse'
import type { ClientReview, Envelope, ProjectPayload } from '../core/protocol'
import { linkReviews, parseReview } from '../core/review'
import { ConflictError, ValidationError, Writer } from '../core/writer'
import { start, type RunningServer } from '../server/server'
import { countFindings, summarizeForCard } from '../src/reviews'

const REL = 'docs/reviews/2026-10-25-ADR-001-codex-a1b2c3.md'
const ADR1 = 'docs/decisions/ADR-001-react-flow-canvas.md'
const ADR2 = 'docs/decisions/ADR-002-local-first-storage.md'

function reviewText(fm: string, body = '\n## Summary\n\nok\n') {
  return `---\n${fm}\n---\n${body}`
}

const VALID = [
  'type: review',
  'target: [ADR-001, ADR-002]',
  'reviewer: codex   # who wrote it',
  'date: 2026-10-25',
  'verdict: changes',
  'status: open',
].join('\n')

const parse = (text: string, rel = REL) => parseReview(rel, Buffer.from(text, 'utf8'))
const codes = (r: ClientReview) => r.diagnostics.map((d) => `${d.level}:${d.code}`)

describe('parseReview', () => {
  it('accepts a valid review and keeps the whole body', () => {
    const body = '\n## Summary\n\nok\n\n## 自訂段落\n\n保留\n'
    const r = parse(reviewText(VALID, body))
    expect(r.diagnostics).toEqual([])
    expect(r.writable).toBe(true)
    expect(r.review).toMatchObject({ targets: ['ADR-001', 'ADR-002'], reviewer: 'codex', verdict: 'changes', status: 'open' })
    expect(r.body).toBe(body)
  })

  it('normalizes a single target string and dedupes repeated ids with a warning', () => {
    expect(parse(reviewText(VALID.replace('target: [ADR-001, ADR-002]', 'target: T-001'))).review?.targets).toEqual(['T-001'])
    const dup = parse(reviewText(VALID.replace('[ADR-001, ADR-002]', '[ADR-001, ADR-001]')))
    expect(dup.review?.targets).toEqual(['ADR-001'])
    expect(codes(dup)).toEqual(['warning:review-target-duplicate'])
    expect(dup.writable).toBe(true)
  })

  it('rejects empty or non-id targets and does not attach the review', () => {
    for (const t of ['target: []', 'target: [ADR-1, hello]', 'target: 3', '']) {
      const r = parse(reviewText(VALID.replace('target: [ADR-001, ADR-002]', t)))
      expect(codes(r)).toContain('error:review-target-invalid')
      expect(r.review).toBeUndefined()
      expect(r.writable).toBe(false)
    }
  })

  it('keeps a review with bad fields readable but read-only', () => {
    const r = parse(reviewText(VALID.replace('reviewer: codex   # who wrote it', '').replace('2026-10-25', '25/10').replace('changes', 'meh').replace('open', 'nope')))
    expect(codes(r)).toEqual(
      expect.arrayContaining(['error:review-reviewer-missing', 'error:date-format', 'error:review-verdict-invalid', 'error:status-invalid']),
    )
    expect(r.review?.targets).toEqual(['ADR-001', 'ADR-002'])
    expect(r.writable).toBe(false)
  })

  it('validates target_rev shape, hex values and unknown keys', () => {
    const hex = 'a'.repeat(40)
    const notMap = parse(reviewText(`${VALID}\ntarget_rev: abc`))
    expect(codes(notMap)).toContain('error:review-rev-invalid')
    const badHex = parse(reviewText(`${VALID}\ntarget_rev:\n  ADR-001: ${'A'.repeat(40)}`))
    expect(codes(badHex)).toContain('error:review-rev-invalid')
    const extra = parse(reviewText(`${VALID}\ntarget_rev:\n  ADR-001: ${hex}\n  T-009: ${hex}`))
    expect(codes(extra)).toEqual(['warning:review-rev-unknown'])
    expect(extra.review?.targetRev).toEqual({ 'ADR-001': hex })
  })

  it('reports broken frontmatter only through diagnostics', () => {
    expect(codes(parse('# no frontmatter\n'))).toEqual(['error:review-frontmatter-missing'])
    expect(codes(parse('---\ntype: review\n'))).toEqual(['error:frontmatter-unterminated'])
    expect(codes(parse('---\ntarget: [\n---\n'))).toEqual(['error:yaml-invalid'])
    expect(codes(parse(reviewText(VALID.replace('type: review', 'type: adr'))))).toContain('error:type-mismatch')
  })

  it('never attaches a docKey to diagnostics', () => {
    const r = parse(reviewText(VALID.replace('2026-10-25', 'x')))
    expect(r.diagnostics.every((d) => d.docKey === undefined && d.path === REL)).toBe(true)
  })
})

describe('gitBlobHash', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nodit-blob-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('matches the portable shell command and git in an explicit SHA-1 repository', async () => {
    const file = path.join(dir, 'a.md')
    const content = Buffer.from('---\ntitle: 中文\r\n---\nbody\n', 'utf8')
    await writeFile(file, content)
    const shell = execFileSync('sh', ['-c', `(printf 'blob %s\\0' "$(wc -c < "$1" | tr -d ' ')"; cat "$1") | shasum -a 1 | cut -d' ' -f1`, 'sh', file])
      .toString()
      .trim()
    execFileSync('git', ['init', '-q', '--object-format=sha1', dir])
    const git = execFileSync('git', ['-C', dir, 'hash-object', '--no-filters', 'a.md']).toString().trim()
    expect(gitBlobHash(content)).toBe(shell)
    expect(gitBlobHash(content)).toBe(git)
  })
})

describe('linkReviews', () => {
  const card = (rel: string, text: string) => parseDoc(rel, Buffer.from(text, 'utf8'), 'adr')
  const adr = (id: string, extra = '') => `---\nid: ${id}\ntype: adr\ntitle: t\nstatus: proposed\n---\n${extra}`

  it('derives missing, unrecorded, stale and current per target', () => {
    const a1 = card('docs/decisions/ADR-001-a.md', adr('ADR-001'))
    const a2 = card('docs/decisions/ADR-002-b.md', adr('ADR-002'))
    const fm = VALID.replace('[ADR-001, ADR-002]', '[ADR-001, ADR-002, ADR-003, T-001]')
    const r = parse(reviewText(`${fm}\ntarget_rev:\n  ADR-001: ${a1.blob}\n  ADR-002: ${'0'.repeat(40)}`))
    const { reviews, diagnostics } = linkReviews([r], [a1, a2])
    expect(reviews[0].targets.map((t) => [t.id, t.state])).toEqual([
      ['ADR-001', 'current'],
      ['ADR-002', 'stale'],
      ['ADR-003', 'missing'],
      ['T-001', 'missing'],
    ])
    expect(diagnostics.map((d) => d.code)).toEqual(['review-target-dangling', 'review-target-dangling'])
    expect(diagnostics.every((d) => d.docKey === undefined && d.path === REL)).toBe(true)
  })

  it('marks a duplicated ID invalid instead of picking the first file, and recovers once repaired', () => {
    const a = card('docs/decisions/ADR-001-a.md', adr('ADR-001'))
    const b = card('docs/decisions/ADR-001-b.md', adr('ADR-001', 'other\n'))
    const r = parse(reviewText(`${VALID}\ntarget_rev:\n  ADR-001: ${a.blob}`))
    const dup = linkReviews([r], [a, b])
    expect(dup.reviews[0].targets[0]).toEqual({ id: 'ADR-001', state: 'invalid' })
    expect(dup.diagnostics.filter((d) => d.message.includes('ADR-001'))).toEqual([])
    expect(linkReviews([r], [a]).reviews[0].targets[0].state).toBe('current')
    expect(linkReviews([r], [b]).reviews[0].targets[0].state).toBe('stale')
  })

  it('marks a target shown from its retained card invalid, not current', () => {
    const a = card('docs/decisions/ADR-001-a.md', adr('ADR-001'))
    const r = parse(reviewText(`${VALID}\ntarget_rev:\n  ADR-001: ${a.blob}`))
    const retained = { ...a, stale: true }
    expect(linkReviews([r], [retained]).reviews[0].targets[0]).toEqual({ id: 'ADR-001', state: 'invalid' })
    expect(linkReviews([r], [a]).reviews[0].targets[0].state).toBe('current')
  })

  it('is idempotent and order-stable when re-linked', () => {
    const a1 = card('docs/decisions/ADR-001-a.md', adr('ADR-001'))
    const rs = [parse(reviewText(VALID), 'docs/reviews/b.md'), parse(reviewText(VALID), 'docs/reviews/a.md')]
    const once = linkReviews(rs, [a1])
    const twice = linkReviews([...once.reviews].reverse(), [a1])
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    expect(once.reviews.map((r) => r.path)).toEqual(['docs/reviews/a.md', 'docs/reviews/b.md'])
  })
})

describe('Writer.updateReviewStatus', () => {
  let root: string
  let owner: Owner
  let writer: Writer
  const TEXT = reviewText(`${VALID}\n# trailing comment`, '\n## Findings\n\n- [ ] a\n')

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'nodit-rv-'))
    await mkdir(path.join(root, 'docs/reviews'), { recursive: true })
    await writeFile(path.join(root, REL), TEXT)
    owner = await acquireOwner(root, 'cli')
    writer = new Writer(root, (await loadConfig(root)).config, owner)
  })
  afterEach(async () => {
    await owner.release()
    await rm(root, { recursive: true, force: true })
  })
  const current = async () => parse(await readFile(path.join(root, REL), 'utf8'))

  it('changes only the status value', async () => {
    const r = await current()
    const out = await writer.updateReviewStatus(r, r.revision, 'addressed')
    expect(out.changed).toBe(true)
    expect(await readFile(path.join(root, REL), 'utf8')).toBe(TEXT.replace('status: open', 'status: addressed'))
  })

  it('lets exactly one of two concurrent writes with the same base succeed', async () => {
    const r = await current()
    const results = await Promise.allSettled([writer.updateReviewStatus(r, r.revision, 'addressed'), writer.updateReviewStatus(r, r.revision, 'dismissed')])
    expect(results.map((x) => x.status)).toEqual(['fulfilled', 'rejected'])
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError)
    expect(await readFile(path.join(root, REL), 'utf8')).toContain('status: addressed')
  })

  it('reports an external edit made before the write as a conflict and writes nothing', async () => {
    const r = await current()
    await writeFile(path.join(root, REL), TEXT.replace('## Findings', '## Findings (edited)'))
    await expect(writer.updateReviewStatus(r, r.revision, 'addressed')).rejects.toBeInstanceOf(ConflictError)
    expect(await readFile(path.join(root, REL), 'utf8')).toContain('status: open')
  })

  it('reports a deleted file as a conflict with no current review', async () => {
    const r = await current()
    await unlink(path.join(root, REL))
    const err = await writer.updateReviewStatus(r, r.revision, 'addressed').catch((e) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.current).toBeNull()
  })

  it('refuses read-only reviews and unknown statuses', async () => {
    let r = await current()
    await expect(writer.updateReviewStatus(r, r.revision, 'done')).rejects.toBeInstanceOf(ValidationError)
    await writeFile(path.join(root, REL), TEXT.replace('verdict: changes', 'verdict: meh'))
    r = await current()
    await expect(writer.updateReviewStatus(r, r.revision, 'addressed')).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('reviews through the server', () => {
  let root: string
  let srv: RunningServer
  const origin = () => `http://127.0.0.1:${srv.port}`
  const headers = () => ({ 'Content-Type': 'application/json', Origin: origin(), 'X-Nodit-Token': srv.owner.token, 'X-Nodit-Session': srv.project.sessionId })
  const project = async (): Promise<Envelope<ProjectPayload>> => (await fetch(`${origin()}/api/project`)).json()
  const review = async () => (await project()).reviews.find((r) => r.path === REL)!
  const patchReview = (key: string, body: unknown) => fetch(`${origin()}/api/reviews/${key}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(body) })

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'nodit-rv-srv-'))
    await cp(path.resolve(__dirname, '../examples/demo'), root, {
      recursive: true,
      filter: (src) => !/[\\/]\.nodit[\\/](writer\.lock|owner\.json|token)/.test(src) && !/[\\/]docs[\\/]reviews/.test(src),
    })
    const blob = gitBlobHash(await readFile(path.join(root, ADR1)))
    await mkdir(path.join(root, 'docs/reviews'), { recursive: true })
    await writeFile(path.join(root, REL), reviewText(`${VALID}\ntarget_rev:\n  ADR-001: ${blob}`))
    srv = await start({ root, port: 0 })
  })
  afterEach(async () => {
    await srv.close()
    await rm(root, { recursive: true, force: true })
  })

  it('includes linked reviews in the snapshot', async () => {
    const r = await review()
    expect(r.targets.map((t) => [t.id, t.state])).toEqual([
      ['ADR-001', 'current'],
      ['ADR-002', 'unrecorded'],
    ])
  })

  it('updates derived target states when a card changes, is deleted or recreated, even though the review did not', async () => {
    const rev0 = (await project()).rev
    const adr = (await project()).docs.find((d) => d.path === ADR1)!
    const ui = await fetch(`${origin()}/api/docs/${adr.docKey}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ baseRevision: adr.revision, fields: { title: 'changed' } }) })
    expect(ui.status).toBe(200)
    let p = await project()
    expect(p.reviews[0].targets[0].state).toBe('stale')
    expect(p.rev).toBeGreaterThan(rev0)

    const original = await readFile(path.join(root, ADR1), 'utf8')
    await writeFile(path.join(root, ADR1), original.replace('title: changed', 'title: again'))
    await srv.project.rescan()
    expect((await review()).targets[0].state).toBe('stale')

    const text = await readFile(path.join(root, ADR2), 'utf8')
    await unlink(path.join(root, ADR2))
    const rev1 = (await project()).rev
    await srv.project.rescan()
    p = await project()
    expect(p.reviews[0].targets[1].state).toBe('missing')
    expect(p.rev).toBeGreaterThan(rev1)
    expect(p.diagnostics.some((d) => d.code === 'review-target-dangling' && d.path === REL && !d.docKey)).toBe(true)

    await writeFile(path.join(root, ADR2), text)
    await srv.project.rescan()
    expect((await review()).targets[1].state).toBe('unrecorded')
  })

  it('does not bump rev on a rescan with no changes', async () => {
    await srv.project.rescan()
    const before = (await project()).rev
    await srv.project.rescan()
    await srv.project.rescan()
    expect((await project()).rev).toBe(before)
  })

  it('PATCH answers 200 and 409 with a linked review, 404 for unknown and 422 for read-only', async () => {
    const r = await review()
    const ok = await patchReview(r.docKey, { baseRevision: r.revision, status: 'addressed' })
    expect(ok.status).toBe(200)
    const okBody = await ok.json()
    expect(okBody.review.review.status).toBe('addressed')
    expect(okBody.review.targets[0].state).toBe('current')

    const stale = await patchReview(r.docKey, { baseRevision: r.revision, status: 'dismissed' })
    expect(stale.status).toBe(409)
    const staleBody = await stale.json()
    expect(staleBody.current.review.status).toBe('addressed')
    expect(staleBody.current.targets).toHaveLength(2)

    expect((await patchReview('0123456789ab', { baseRevision: 'x', status: 'open' })).status).toBe(404)

    const fresh = await review()
    await unlink(path.join(root, REL))
    const gone = await patchReview(fresh.docKey, { baseRevision: fresh.revision, status: 'open' })
    expect(gone.status).toBe(409)
    expect((await gone.json()).current).toBeNull()

    await writeFile(path.join(root, REL), reviewText(VALID.replace('verdict: changes', 'verdict: meh')))
    await srv.project.rescan()
    const ro = await review()
    expect(ro.writable).toBe(false)
    expect((await patchReview(ro.docKey, { baseRevision: ro.revision, status: 'addressed' })).status).toBe(422)
  })
})

describe('countFindings', () => {
  it('counts nested checklists and [X], ignores code fences and other sections', () => {
    const body = [
      '## Summary',
      '- [ ] not a finding',
      '## Findings',
      '- [ ] a',
      '  - [X] nested done',
      '  - [ ] nested open',
      '- plain item',
      '```md',
      '- [ ] fake inside fence',
      '```',
      '### Detail',
      '- [x] still under findings',
      '## Next',
      '- [ ] after',
    ].join('\n')
    expect(countFindings(body)).toEqual({ open: 2, total: 4 })
  })

  it('returns null without a Findings section', () => {
    expect(countFindings('## Summary\n\n- [ ] x\n')).toBeNull()
  })
})

describe('summarizeForCard', () => {
  const mk = (path: string, fm: string, states: Record<string, string>): ClientReview => {
    const r = parse(reviewText(fm), path)
    return { ...r, targets: r.targets.map((t) => ({ ...t, state: (states[t.id] ?? 'unrecorded') as never })) }
  }

  it('counts only valid open reviews and looks at this card target only for staleness', () => {
    const reviews = [
      mk('a.md', VALID.replace('changes', 'reject'), { 'ADR-001': 'stale', 'ADR-002': 'current' }),
      mk('b.md', VALID.replace('open', 'addressed').replace('changes', 'reject'), { 'ADR-002': 'stale' }),
      mk('c.md', VALID.replace('changes', 'meh'), {}),
      mk('d.md', VALID.replace('changes', 'approve'), {}),
    ]
    expect(summarizeForCard(reviews, 'ADR-001')).toEqual({ open: 2, worst: 'reject', stale: true })
    expect(summarizeForCard(reviews, 'ADR-002')).toEqual({ open: 2, worst: 'reject', stale: false })
    expect(summarizeForCard(reviews, 'T-001')).toEqual({ open: 0, worst: undefined, stale: false })
  })
})
