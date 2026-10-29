import type { DOMPurify } from 'dompurify'
import { Marked, type Token, type Tokens } from 'marked'
import { CARD_KINDS, ID_PREFIX_SOURCE, ID_RULES } from '../../core/domain'

export type TocEntry = { id: string; text: string; level: number }
export type TreeLine = { name: string; desc: string; children: TreeLine[] }
export type TreeNode = { name: string; html: string; dir: boolean; children: TreeNode[] }
export type RenderedDoc = { html: string; toc: TocEntry[]; mermaid: string[]; trees: TreeNode[][] }

export const TREE_LANG = 'nodit-tree'

const CARD_RE = new RegExp(`^(?:${CARD_KINDS.map((k) => `${ID_RULES[k].prefix}\\d{${ID_RULES[k].pad},}`).join('|')})(?![\\w-])`)
const CARD_START = new RegExp(`(?:${ID_PREFIX_SOURCE})-\\d`)

type CardRefToken = { type: 'cardRef'; raw: string; id: string }

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function slugify(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}

/** Card refs inside link text would nest anchors; turn them back into plain text. */
function demoteRefs(tokens: Token[] | undefined) {
  if (!tokens) return
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token & { tokens?: Token[] }
    if (t.type === 'cardRef') tokens[i] = { type: 'text', raw: t.raw, text: t.raw } as Tokens.Text
    else demoteRefs(t.tokens)
  }
}

/**
 * `nodit-tree` source → nested nodes. Each line is `path  description`; indentation sets depth
 * and a trailing `/` (or having children) marks a folder. Over-indented lines attach to the
 * previous line, so a sloppy indent degrades instead of failing.
 */
export function parseTree(src: string): TreeLine[] {
  const roots: TreeLine[] = []
  const stack: { indent: number; node: TreeLine }[] = []
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim()) continue
    const indent = line.match(/^[ \t]*/)![0].replace(/\t/g, '  ').length
    const [name, ...rest] = line.trim().split(/\t|\s{2,}/)
    const node: TreeLine = { name: name!, desc: rest.join(' ').trim(), children: [] }
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop()
    ;(stack.length ? stack[stack.length - 1]!.node.children : roots).push(node)
    stack.push({ indent, node })
  }
  return roots
}

/**
 * Markdown → sanitized HTML. Card codes become links at the token level (so code spans, fenced
 * code, existing links and mermaid blocks are never touched); mermaid sources are returned
 * separately and rendered later into placeholders.
 */
export function renderMarkdown(markdown: string, knownIds: Set<string>, purify: DOMPurify): RenderedDoc {
  const mermaid: string[] = []
  const treeSources: string[] = []
  const toc: TocEntry[] = []
  const seen = new Map<string, number>()

  const marked = new Marked({
    gfm: true,
    extensions: [
      {
        name: 'cardRef',
        level: 'inline',
        start: (src: string) => src.match(CARD_START)?.index,
        tokenizer: (src: string) => {
          const m = CARD_RE.exec(src)
          return m ? ({ type: 'cardRef', raw: m[0], id: m[0] } satisfies CardRefToken) : undefined
        },
        renderer: (token) => {
          const id = (token as unknown as CardRefToken).id
          return knownIds.has(id)
            ? `<a class="card-ref" href="#card/${id}" data-card="${id}">${id}</a>`
            : `<span class="card-ref is-missing" title="找不到這張卡片">${id}</span>`
        },
      },
    ],
    walkTokens: (token) => {
      if (token.type === 'link') demoteRefs((token as Tokens.Link).tokens)
    },
    renderer: {
      code({ text, lang }) {
        if (lang?.trim().toLowerCase() === 'mermaid') {
          const i = mermaid.push(text) - 1
          return `<div class="mermaid-block" data-mermaid="${i}"></div>`
        }
        if (lang?.trim().toLowerCase() === TREE_LANG) {
          treeSources.push(text)
          return '<p class="tree-ref"><a href="#structure" data-tab="structure">在 Structure 查看資料夾結構</a></p>'
        }
        return `<pre class="code"><code>${escapeHtml(text)}</code></pre>`
      },
      // `input` is forbidden by the sanitizer; show task state with a span instead
      checkbox({ checked }) {
        return `<span class="task-box" data-checked="${checked}" role="img" aria-label="${checked ? '已完成' : '未完成'}"></span> `
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens)
        const plain = inner.replace(/<[^>]+>/g, '')
        const base = slugify(plain)
        const n = seen.get(base) ?? 0
        seen.set(base, n + 1)
        const id = `sec-${base}${n ? `-${n}` : ''}`
        if (depth === 2 || depth === 3) toc.push({ id, text: plain, level: depth })
        return `<h${depth} id="${id}">${inner}</h${depth}>`
      },
    },
  })

  const sanitize = (raw: string) =>
    purify.sanitize(raw, {
      ADD_ATTR: ['data-card', 'data-mermaid', 'data-tab', 'data-checked'],
      FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'textarea', 'select', 'button', 'object', 'embed'],
      FORBID_ATTR: ['style'],
    })
  const html = sanitize(marked.parse(markdown, { async: false }) as string)
  const toNode = (n: TreeLine): TreeNode => ({
    name: n.name,
    html: n.desc ? sanitize(marked.parseInline(n.desc, { async: false }) as string) : '',
    dir: n.name.endsWith('/') || n.children.length > 0,
    children: n.children.map(toNode),
  })
  return { html, toc, mermaid, trees: treeSources.map((src) => parseTree(src).map(toNode)) }
}

/** Mermaid output is SVG; sanitize it with the SVG profile before inserting. */
export function sanitizeSvg(svg: string, purify: DOMPurify) {
  return purify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
}
