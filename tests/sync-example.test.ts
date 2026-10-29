import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../core/config'
import { crossValidate, scanDocs, scanReviews } from '../core/scan'
import { convertAdr, convertReview, convertSpec, EXAMPLE, SyncError, syncExample } from '../scripts/sync-example'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('convertAdr', () => {
  const src = [
    '# 0004 — 切換專案',
    '',
    '- 狀態：Accepted（同日修訂）',
    '- 日期：2026-10-22（Proposed 同日）',
    '- 延伸：0003 的 server、0001 的選型',
    '',
    '## 背景',
    '',
    '原因。',
    '',
    '## 決策',
    '',
    '做法。',
    '',
    '## 實作細節',
    '',
    '### 子項',
    '',
    '```sh',
    '## not a heading',
    '```',
    '',
  ].join('\n')

  it('maps the title, header bullets and section names to Nodit card format', () => {
    const adr = convertAdr('0004-project-switching.md', src)
    expect(adr.rel).toBe('docs/decisions/ADR-004-project-switching.md')
    expect(adr.content).toMatch(/^---\nid: ADR-004\ntype: adr\ntitle: 切換專案\nstatus: accepted\ndate: 2026-10-22\nrelates: \[ADR-003, ADR-001\]\n---\n\n## Context\n\n- 狀態/)
    expect(adr.content).not.toContain('## 背景')
    expect(adr.content).toContain('## Decision\n\n做法。')
  })

  it('demotes custom sections outside code fences and adds a missing Consequences', () => {
    const { content } = convertAdr('0004-project-switching.md', src)
    expect(content).toContain('### 實作細節\n\n#### 子項')
    expect(content).toContain('```sh\n## not a heading\n```')
    expect(content).toMatch(/\n## Consequences\n$/)
  })
})

describe('convertSpec', () => {
  const hash = 'a'.repeat(40)
  const src = [
    '# 0003 — Job 規格',
    '',
    '- 狀態：Approved',
    '- 日期：2026-10-29',
    '- 實作：[0010 從卡片觸發](../decisions/0010-review-from-card.md)',
    `- adr_rev：0010 \`${hash}\``,
    '',
    '前言。',
    '',
    '## Scope',
    '',
    '範圍。',
    '',
    '## Design',
    '',
    '設計。',
    '',
  ].join('\n')

  it('maps the header bullets to spec frontmatter and folds the intro into Scope', () => {
    const spec = convertSpec('0003-review-job.md', src)
    expect(spec.rel).toBe('docs/specs/SPEC-003-review-job.md')
    expect(spec.content).toBe(
      `---\nid: SPEC-003\ntype: spec\ntitle: Job 規格\nstatus: approved\ndate: 2026-10-29\nimplements: [ADR-010]\nadr_rev:\n  ADR-010: ${hash}\n---\n\n## Scope\n\n前言。\n\n範圍。\n\n## Design\n\n設計。\n`,
    )
  })

  it('omits adr_rev when the header has none and rejects an unknown status', () => {
    expect(convertSpec('0003-x.md', src.replace(/^- adr_rev.*\n/m, '')).content).not.toContain('adr_rev')
    expect(() => convertSpec('0003-x.md', src.replace('Approved', 'Accepted'))).toThrow(SyncError)
  })
})

describe('convertReview', () => {
  const src = '# 標題\n\n評估日期：2026-10-29。\n\n## Summary\n\n結論。\n\n## Findings\n\n- [x] **P1** 已處理。\n- [ ] **P2** 未處理。\n'

  it('targets the ADR, folds the intro into Summary and derives verdict and status from Findings', () => {
    const review = convertReview('2026-10-29-0010-review-from-card-review.md', src)
    expect(review.rel).toMatch(/^docs\/reviews\/2026-10-29-ADR-010-claude-[0-9a-f]{6}\.md$/)
    expect(review.content).toContain('target: [ADR-010]\nreviewer: claude\ndate: 2026-10-29\nverdict: changes\nstatus: open\n')
    expect(review.content).toContain('## Summary\n\n評估日期：2026-10-29。\n\n結論。')
    expect(convertReview('2026-10-29-0010-x.md', src.replace('**P1**', '**P2**').replace('[ ]', '[x]')).content).toContain('verdict: approve\nstatus: addressed')
  })
})

describe(`${EXAMPLE}`, () => {
  it('is in sync with docs/ (run npm run sync:example)', async () => {
    expect(await syncExample(ROOT, { check: true })).toEqual([])
  })

  it('parses without errors in Nodit', async () => {
    const root = join(ROOT, EXAMPLE)
    const { config } = await loadConfig(root)
    const { docs, diagnostics } = crossValidate(await scanDocs(root, config))
    const reviews = await scanReviews(root, config)
    const errors = [...diagnostics, ...docs.flatMap((d) => d.diagnostics), ...reviews.flatMap((r) => r.diagnostics)].filter((d) => d.level === 'error')
    expect(errors).toEqual([])
    expect(reviews.every((r) => r.review)).toBe(true)
  })
})
