import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { parseTree, renderMarkdown, sanitizeSvg } from '../src/architecture/render'

const purify = createDOMPurify(new JSDOM('').window as unknown as Window & typeof globalThis)
const known = new Set(['ADR-001', 'MS-01', 'T-003'])
const render = (md: string) => renderMarkdown(md, known, purify)

describe('architecture renderer', () => {
  it('links known card codes in prose and marks unknown ones', () => {
    const { html } = render('決策見 ADR-001 與 MS-01；ADR-999 不存在。')
    expect(html).toContain('<a class="card-ref" href="#card/ADR-001" data-card="ADR-001">ADR-001</a>')
    expect(html).toContain('data-card="MS-01"')
    expect(html).toContain('<span class="card-ref is-missing" title="找不到這張卡片">ADR-999</span>')
  })

  it('shows task list state without letting input elements through the sanitizer', () => {
    const { html } = render('- [ ] open\n- [x] done\n  - [X] nested')
    expect(html).not.toContain('<input')
    expect(html.match(/data-checked="false"/g)).toHaveLength(1)
    expect(html.match(/data-checked="true"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="已完成"')
  })

  it('never links inside code spans, fenced code, existing links or mermaid', () => {
    const { html, mermaid } = render(
      ['`ADR-001`', '', '```ts', 'const x = "T-003"', '```', '', '[see ADR-001](https://example.com)', '', '```mermaid', 'flowchart LR', '  ADR-001 --> MS-01', '```'].join('\n'),
    )
    expect(html.match(/class="card-ref"/g)).toBeNull()
    expect(html).toContain('<code>ADR-001</code>')
    expect(html).toContain('<a href="https://example.com">see ADR-001</a>')
    expect(mermaid).toEqual(['flowchart LR\n  ADR-001 --> MS-01'])
    expect(html).toContain('<div class="mermaid-block" data-mermaid="0"></div>')
  })

  it('strips scripts, event handlers, javascript: links and embedded frames', () => {
    const { html } = render(
      [
        '<script>alert(1)</script>',
        '<img src=x onerror="alert(2)">',
        '[click](javascript:alert(3))',
        '<a href="javascript:alert(4)">raw</a>',
        '<iframe src="https://evil.example"></iframe>',
        '<div style="background:url(javascript:alert(5))">styled</div>',
        '<svg><script>alert(6)</script></svg>',
      ].join('\n\n'),
    )
    expect(html).not.toMatch(/<script|onerror|javascript:|<iframe|style=/i)
    expect(html).toContain('styled')
  })

  it('builds a table of contents with unique, prefixed ids', () => {
    const { html, toc } = render('# Title\n\n## 概觀\n\n### 細節\n\n## 概觀\n')
    expect(toc).toEqual([
      { id: 'sec-概觀', text: '概觀', level: 2 },
      { id: 'sec-細節', text: '細節', level: 3 },
      { id: 'sec-概觀-1', text: '概觀', level: 2 },
    ])
    expect(html).toContain('<h2 id="sec-概觀-1">概觀</h2>')
  })

  it('parses nodit-tree indentation into nested nodes and tolerates sloppy indents', () => {
    const tree = parseTree(['core/          規則', '  writer.ts    寫入', '      deep.ts  過度縮排', '  scope.ts', 'README.md\t說明', ''].join('\n'))
    expect(tree).toEqual([
      {
        name: 'core/',
        desc: '規則',
        children: [
          { name: 'writer.ts', desc: '寫入', children: [{ name: 'deep.ts', desc: '過度縮排', children: [] }] },
          { name: 'scope.ts', desc: '', children: [] },
        ],
      },
      { name: 'README.md', desc: '說明', children: [] },
    ])
  })

  it('moves nodit-tree blocks out of the document and links card codes in descriptions', () => {
    const { html, trees, toc } = render(['## 專案結構', '', '```nodit-tree', 'core/        見 ADR-001', '  a.ts       <img src=x onerror="alert(1)">`code`', 'b.ts', '```'].join('\n'))
    expect(toc).toEqual([{ id: 'sec-專案結構', text: '專案結構', level: 2 }])
    expect(html).not.toContain('core/')
    expect(html).toContain('<a href="#structure" data-tab="structure">')
    expect(trees).toHaveLength(1)
    const [core, b] = trees[0]!
    expect(core).toMatchObject({ name: 'core/', dir: true })
    expect(core!.html).toContain('data-card="ADR-001"')
    expect(core!.children[0]!.html).not.toMatch(/onerror/)
    expect(core!.children[0]!.html).toContain('<code>code</code>')
    expect(b).toMatchObject({ name: 'b.ts', dir: false, html: '', children: [] })
  })

  it('sanitizes mermaid SVG output', () => {
    const svg = sanitizeSvg('<svg onload="alert(1)"><script>alert(2)</script><g><text>ok</text></g><foreignObject><div onclick="x()">x</div></foreignObject></svg>', purify)
    expect(svg).not.toMatch(/onload|<script|onclick/i)
    expect(svg).toContain('<text>ok</text>')
  })
})
