import DOMPurify from 'dompurify'
import { FileText, Rocket } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Frame, Rule } from '../components/Frame'
import { client, useProject } from '../store'
import { renderMarkdown, sanitizeSvg } from './render'

let mermaidSeq = 0

const MERMAID_THEME = {
  dark: {
    background: 'transparent',
    primaryColor: '#383135',
    primaryTextColor: '#f7ede9',
    primaryBorderColor: '#f4acb7',
    secondaryColor: '#41393d',
    tertiaryColor: '#2a2427',
    lineColor: '#ab969c',
    textColor: '#dcc7c9',
  },
  light: {
    background: 'transparent',
    primaryColor: '#ffffff',
    primaryTextColor: '#2d2427',
    primaryBorderColor: '#e8909f',
    secondaryColor: '#fbf4f2',
    tertiaryColor: '#f4eeec',
    lineColor: '#9d8189',
    textColor: '#6d5c63',
  },
}

export function ArchitecturePage() {
  const { architecture, docs, theme, focusCard, setInitOpen, initialized } = useProject(
    useShallow((s) => ({
      architecture: s.architecture,
      docs: s.docs,
      theme: s.theme,
      focusCard: s.focusCard,
      setInitOpen: s.setInitOpen,
      initialized: s.initialized,
    })),
  )
  const [file, setFile] = useState<{ path: string; markdown: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    client
      .getArchitecture()
      .then((f) => live && (setFile(f), setError(null)))
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      live = false
    }
  }, [architecture.revision])

  const known = useMemo(() => new Set(docs.flatMap((d) => (d.card ? [d.card.id] : []))), [docs])
  const rendered = useMemo(() => (file?.markdown != null ? renderMarkdown(file.markdown, known, DOMPurify) : null), [file, known])

  useEffect(() => {
    if (!rendered?.mermaid.length || !body.current) return
    let cancelled = false
    const blocks = [...body.current.querySelectorAll<HTMLElement>('.mermaid-block')]
    void (async () => {
      const mermaid = (await import('mermaid')).default
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        theme: 'base',
        themeVariables: { ...MERMAID_THEME[theme], fontFamily: 'JetBrains Mono Variable, ui-monospace, monospace' },
      })
      for (const el of blocks) {
        const src = rendered.mermaid[Number(el.dataset.mermaid)]
        if (src == null) continue
        try {
          const { svg } = await mermaid.render(`nodit-mermaid-${++mermaidSeq}`, src)
          if (cancelled) return
          el.classList.remove('is-error')
          el.innerHTML = sanitizeSvg(svg, DOMPurify)
        } catch (err) {
          if (cancelled) return
          el.classList.add('is-error')
          el.textContent = `Mermaid 語法錯誤：${err instanceof Error ? err.message.split('\n')[0] : String(err)}`
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rendered, theme])

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const card = a.getAttribute('data-card')
    const href = a.getAttribute('href') ?? ''
    if (card) {
      e.preventDefault()
      focusCard(card)
    } else if (href.startsWith('#')) {
      e.preventDefault()
      body.current?.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else if (/^https?:/i.test(href)) {
      e.preventDefault()
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }

  const jump = (id: string) => body.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="arch">
      <nav className="arch__toc" aria-label="目錄">
        <h2 className="sec-head">
          <span className="sec-head__tag label-caps">Contents</span>
          <Rule />
        </h2>
        {rendered?.toc.map((t) => (
          <button key={t.id} type="button" className={`arch__toc-item arch__toc-item--h${t.level}`} onClick={() => jump(t.id)}>
            {t.text}
          </button>
        ))}
        {rendered && !rendered.toc.length && <p className="sidebar__empty">沒有 ## 標題</p>}
        <p className="arch__path mono">
          <FileText size={12} />
          {file?.path ?? architecture.path}
        </p>
      </nav>

      <article className="arch__doc">
        <Frame />
        <div className="arch__scroll">
        {error && <p className="arch__empty">{error}</p>}
        {file && file.markdown === null && (
          <div className="arch__empty">
            <p>
              找不到 <code className="mono">{file.path}</code>。這份文件描述系統架構，文中的 ADR-001、MS-01、T-001 這類代號會自動連到卡片。
            </p>
            <button type="button" className="btn btn--primary" onClick={() => setInitOpen(true)}>
              <Rocket size={14} />
              {initialized ? '用 init 建立模板' : '開始 init'}
            </button>
          </div>
        )}
        {rendered && <div ref={body} className="arch__body" onClick={onClick} dangerouslySetInnerHTML={{ __html: rendered.html }} />}
        </div>
      </article>
    </div>
  )
}
