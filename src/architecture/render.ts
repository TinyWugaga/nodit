import type { DOMPurify } from 'dompurify'
import { Marked, type Token, type Tokens } from 'marked'

export type TocEntry = { id: string; text: string; level: number }
export type RenderedDoc = { html: string; toc: TocEntry[]; mermaid: string[] }

const CARD_RE = /^(?:ADR-\d{3,}|MS-\d{2,}|T-\d{3,})(?![\w-])/
const CARD_START = /(?:ADR|MS|T)-\d/

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
 * Markdown → sanitized HTML. Card codes become links at the token level (so code spans, fenced
 * code, existing links and mermaid blocks are never touched); mermaid sources are returned
 * separately and rendered later into placeholders.
 */
export function renderMarkdown(markdown: string, knownIds: Set<string>, purify: DOMPurify): RenderedDoc {
  const mermaid: string[] = []
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
        return `<pre class="code"><code>${escapeHtml(text)}</code></pre>`
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

  const raw = marked.parse(markdown, { async: false }) as string
  const html = purify.sanitize(raw, {
    ADD_ATTR: ['data-card', 'data-mermaid'],
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'textarea', 'select', 'button', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  })
  return { html, toc, mermaid }
}

/** Mermaid output is SVG; sanitize it with the SVG profile before inserting. */
export function sanitizeSvg(svg: string, purify: DOMPurify) {
  return purify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
}
