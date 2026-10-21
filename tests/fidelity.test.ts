import { describe, expect, it } from 'vitest'
import { setFields } from '../core/edit'
import { readSections, replaceSection } from '../core/sections'
import { splitDoc } from '../core/frontmatter'

const RICH = [
  '---',
  'id: ADR-007   # keep this comment',
  'type: adr',
  "title: 'Quoted: title'",
  'status: proposed',
  'date: 2026-10-01',
  'owner:',
  '  team: platform   # unknown nested key',
  'notes: |',
  '  line one',
  '  line two',
  'supersedes:',
  '  - ADR-002',
  '  - ADR-003',
  'x-custom: [a, b]',
  '---',
  '',
  '## Context',
  '',
  'Some context.',
  '',
  '```md',
  '## Decision',
  'not a heading inside a fence',
  '```',
  '',
  '## Decision',
  '',
  'We decided.',
  '',
  '## Appendix',
  '',
  'Custom section kept as-is.',
  '',
].join('\n')

function changedLines(a: string, b: string) {
  const x = a.split('\n')
  const y = b.split('\n')
  expect(y.length).toBe(x.length)
  return x.map((l, i) => (l === y[i] ? -1 : i)).filter((i) => i >= 0)
}

describe('setFields fidelity', () => {
  it('no-op patch with identical values keeps bytes identical', () => {
    expect(setFields(RICH, { status: 'proposed', title: 'Quoted: title', date: '2026-10-01' })).toBe(RICH)
  })

  it('single field change touches only that line, keeping its trailing comment', () => {
    const next = setFields(RICH, { id: 'ADR-008' })
    expect(changedLines(RICH, next)).toEqual([1])
    expect(next.split('\n')[1]).toBe('id: ADR-008   # keep this comment')
  })

  it('keeps original quoting style of the edited scalar', () => {
    const next = setFields(RICH, { title: 'New: title' })
    expect(next.split('\n')[3]).toBe("title: 'New: title'")
    expect(changedLines(RICH, next)).toEqual([3])
  })

  it('rewrites a block sequence in place, leaving everything else', () => {
    const next = setFields(RICH, { supersedes: ['ADR-002', 'ADR-005'] })
    expect(changedLines(RICH, next)).toEqual([13])
    expect(next).toContain('supersedes:\n  - ADR-002\n  - ADR-005\n')
  })

  it('appends a missing key before the closing fence and removes keys cleanly', () => {
    const added = setFields(RICH, { priority: 'high' })
    expect(added).toContain('x-custom: [a, b]\npriority: high\n---')
    const removed = setFields(RICH, { date: null })
    expect(removed).not.toContain('date:')
    expect(removed.split('\n').length).toBe(RICH.split('\n').length - 1)
  })

  it('preserves BOM and CRLF line endings', () => {
    const crlf = '﻿' + ['---', 'id: T-001', 'type: task', 'title: A', 'status: todo', '---', '', '## Description', '', 'x', ''].join('\r\n')
    const next = setFields(crlf, { status: 'done', assignee: 'Tiny' })
    expect(next.charCodeAt(0)).toBe(0xfeff)
    expect(next).toBe(crlf.replace('status: todo', 'status: done').replace('title: A\r\n', 'title: A\r\n').replace('---\r\n\r\n', 'assignee: Tiny\r\n---\r\n\r\n'))
    expect(next.replace(/\r\n/g, '')).not.toContain('\n')
  })
})

describe('sections', () => {
  it('ignores headings inside code fences and flags duplicates', () => {
    const split = splitDoc(RICH)
    const s = readSections(RICH, split.bodyStart, ['Context', 'Decision', 'Consequences'])
    expect(s.Context).toMatchObject({ state: 'ok', text: 'Some context.\n\n```md\n## Decision\nnot a heading inside a fence\n```' })
    expect(s.Decision).toMatchObject({ state: 'ok', text: 'We decided.' })
    expect(s.Consequences).toEqual({ state: 'missing' })

    const dup = RICH + '\n## Decision\n\nagain\n'
    expect(readSections(dup, split.bodyStart, ['Decision']).Decision).toEqual({ state: 'duplicate', count: 2 })
  })

  it('replaces only the target section content', () => {
    const split = splitDoc(RICH)
    const s = readSections(RICH, split.bodyStart, ['Decision']).Decision
    if (s.state !== 'ok') throw new Error('expected ok')
    const next = replaceSection(RICH, s, 'We decided again.', '\n')
    expect(next).toBe(RICH.replace('\nWe decided.\n', '\nWe decided again.\n'))
    expect(replaceSection(RICH, s, 'We decided.', '\n')).toBe(RICH)
  })
})
