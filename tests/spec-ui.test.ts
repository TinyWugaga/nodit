import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import type { CardRecord } from '../core/domain'
import type { ClientDoc } from '../core/protocol'
import { renderMarkdown } from '../src/architecture/render'
import { criteriaCount, specCompletionHint, taskSpecHints, worstAdrState } from '../src/specs'

const purify = createDOMPurify(new JSDOM('').window as never)

function doc(card: Partial<CardRecord> & Pick<CardRecord, 'id' | 'type' | 'status'>, links: Partial<CardRecord['links']> = {}): ClientDoc {
  return {
    docKey: card.id,
    path: `${card.id}.md`,
    kind: card.type,
    revision: 'r',
    card: { title: card.id, ...card, links: { implements: [], depends: [], supersedes: [], relates: [], ...links } },
    sections: {},
    diagnostics: [],
    legacy: false,
    inferred: [],
    writable: true,
  }
}

describe('criteriaCount', () => {
  it('counts nested items and ignores code fences, like review findings', () => {
    const md = '- [x] a\n- [ ] b\n  - [X] c\n\n```\n- [ ] fenced\n```\n'
    expect(criteriaCount(md)).toEqual({ done: 2, total: 3 })
  })
  it('is null without a checklist', () => {
    expect(criteriaCount('')).toBeNull()
    expect(criteriaCount('- plain\n')).toBeNull()
  })
})

describe('worstAdrState', () => {
  it('shows invalid > missing > stale > unrecorded and nothing when all are current', () => {
    const s = (...states: string[]) => worstAdrState(states.map((state, i) => ({ id: `ADR-00${i}`, state }) as never))
    expect(s('unrecorded', 'stale', 'missing', 'invalid')).toBe('invalid')
    expect(s('unrecorded', 'stale', 'missing')).toBe('missing')
    expect(s('current', 'unrecorded', 'stale')).toBe('stale')
    expect(s('current', 'unrecorded')).toBe('unrecorded')
    expect(s('current')).toBeUndefined()
    expect(s()).toBeUndefined()
  })
})

describe('specCompletionHint', () => {
  const spec = 'SPEC-001'
  const task = (id: string, status: string, links: Partial<CardRecord['links']> = { implements: [spec] }) => doc({ id, type: 'task', status: status as never }, links)

  it('depends on the acceptance record once every directly implementing task is done', () => {
    const docs = [task('T-001', 'done'), task('T-002', 'done')]
    expect(specCompletionHint(docs, spec, 'approved', '- [x] a\n- [x] b\n')).toBe('相關 Task 已完成；驗收條件 2/2。可考慮標記 implemented')
    expect(specCompletionHint(docs, spec, 'approved', '- [x] a\n- [ ] b\n')).toBe('相關 Task 已完成；驗收條件 1/2')
    expect(specCompletionHint(docs, spec, 'approved', '')).toBe('相關 Task 已完成；尚無驗收紀錄')
  })

  it('stays silent unless approved with at least one task, all done, counting only implements', () => {
    expect(specCompletionHint([task('T-001', 'done')], spec, 'draft', '')).toBeNull()
    expect(specCompletionHint([], spec, 'approved', '')).toBeNull()
    expect(specCompletionHint([task('T-001', 'done'), task('T-002', 'doing')], spec, 'approved', '')).toBeNull()
    expect(specCompletionHint([task('T-001', 'done', { relates: [spec] })], spec, 'approved', '')).toBeNull()
  })
})

describe('taskSpecHints', () => {
  const docs = [
    doc({ id: 'SPEC-001', type: 'spec', status: 'approved' }, { implements: ['ADR-001'] }),
    doc({ id: 'SPEC-002', type: 'spec', status: 'draft' }, { implements: ['ADR-001'] }),
    doc({ id: 'SPEC-003', type: 'spec', status: 'approved' }, { implements: ['ADR-002'] }),
  ]
  it('lists approved specs under the implemented ADR when the task implements none of them', () => {
    expect(taskSpecHints(docs, ['ADR-001'])).toEqual([{ adr: 'ADR-001', specs: ['SPEC-001'] }])
    expect(taskSpecHints(docs, ['ADR-001', 'SPEC-001'])).toEqual([])
    expect(taskSpecHints(docs, ['ADR-003'])).toEqual([])
  })
})

describe('architecture links', () => {
  it('links SPEC IDs like the other kinds', () => {
    const { html } = renderMarkdown('見 SPEC-001 與 SPEC-1', new Set(['SPEC-001']), purify)
    expect(html).toContain('data-card="SPEC-001"')
    expect(html).not.toContain('data-card="SPEC-1"')
  })
})
