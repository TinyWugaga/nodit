import { describe, expect, it } from 'vitest'
import { docKeyOf, parseDoc } from '../core/parse'
import { crossValidate } from '../core/scan'

const doc = (s: string) => Buffer.from(s)

describe('parseDoc', () => {
  it('parses a valid ADR with links and sections', () => {
    const d = parseDoc(
      'docs/decisions/ADR-004-x.md',
      doc('---\nid: ADR-004\ntype: adr\ntitle: X\nstatus: proposed\nsupersedes: [ADR-002]\n---\n\n## Context\n\nc\n'),
      'adr',
    )
    expect(d.writable).toBe(true)
    expect(d.card).toMatchObject({ id: 'ADR-004', status: 'proposed', links: { supersedes: ['ADR-002'] } })
    expect(d.sections.Context).toEqual({ state: 'ok', text: 'c' })
    expect(d.docKey).toBe(docKeyOf('docs/decisions/ADR-004-x.md'))
  })

  it('treats files without frontmatter as read-only legacy with inferred fields', () => {
    const d = parseDoc('docs/decisions/0001-stage1-stack.md', doc('# 0001 — 第一階段技術選型\n\n內容\n'), 'adr')
    expect(d.legacy).toBe(true)
    expect(d.writable).toBe(false)
    expect(d.card).toMatchObject({ id: 'ADR-001', title: '第一階段技術選型' })
    expect(d.inferred).toEqual(['id', 'title', 'status'])
  })

  it('reports broken YAML without a card but still has a docKey', () => {
    const d = parseDoc('docs/tasks/broken.md', doc('---\nid: [unclosed\n---\n'), 'task')
    expect(d.card).toBeUndefined()
    expect(d.writable).toBe(false)
    expect(d.diagnostics[0].code).toBe('yaml-invalid')
    expect(d.docKey).toMatch(/^[a-f0-9]{12}$/)
  })

  it('rejects wrong type, bad status and unsupported links with diagnostics', () => {
    const d = parseDoc('docs/tasks/T-001-a.md', doc('---\nid: T-001\ntype: adr\ntitle: A\nstatus: nope\nsupersedes: [ADR-1]\n---\n'), 'task')
    const codes = d.diagnostics.map((x) => x.code)
    expect(codes).toEqual(expect.arrayContaining(['type-mismatch', 'status-invalid', 'link-unsupported']))
    expect(d.writable).toBe(false)
  })
})

describe('crossValidate', () => {
  it('flags duplicate ids on every copy and disables their writes', () => {
    const a = parseDoc('docs/tasks/T-001-a.md', doc('---\nid: T-001\ntype: task\ntitle: A\nstatus: todo\n---\n'), 'task')
    const b = parseDoc('docs/tasks/T-001-b.md', doc('---\nid: T-001\ntype: task\ntitle: B\nstatus: todo\ndepends: [T-404]\n---\n'), 'task')
    const { docs } = crossValidate([a, b])
    expect(docs.every((d) => d.diagnostics.some((x) => x.code === 'id-duplicate'))).toBe(true)
    expect(docs.every((d) => !d.writable)).toBe(true)
    expect(docs[0].docKey).not.toBe(docs[1].docKey)
    expect(docs[1].diagnostics.some((x) => x.code === 'link-dangling')).toBe(true)
  })
})
