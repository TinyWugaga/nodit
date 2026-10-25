import DOMPurify from 'dompurify'
import { ChevronRight, File, FileText, Folder, FolderOpen, Rocket } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Frame, Rule } from '../components/Frame'
import { client, useProject } from '../store'
import { renderMarkdown, sanitizeSvg, TREE_LANG, type TreeNode } from './render'

let mermaidSeq = 0

type Tab = 'contents' | 'structure'

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
  const [tab, setTab] = useState<Tab>('contents')
  const [closed, setClosed] = useState<Set<number>>(new Set())
  const [pendingJump, setPendingJump] = useState<string | null>(null)
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
  }, [rendered, theme, tab])

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const card = a.getAttribute('data-card')
    const href = a.getAttribute('href') ?? ''
    if (card) {
      e.preventDefault()
      focusCard(card)
    } else if (a.getAttribute('data-tab') === 'structure') {
      e.preventDefault()
      setTab('structure')
    } else if (href.startsWith('#')) {
      e.preventDefault()
      body.current?.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else if (/^https?:/i.test(href)) {
      e.preventDefault()
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }

  const jump = (id: string) => body.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const trees = rendered?.trees ?? []
  const roots = useMemo(() => trees.flat(), [trees])

  useEffect(() => setClosed(new Set()), [rendered])

  useEffect(() => {
    if (!pendingJump) return
    jump(pendingJump)
    setPendingJump(null)
  }, [pendingJump])

  const focusRoot = (i: number) => {
    setClosed(new Set(roots.flatMap((n, j) => (j !== i && n.children.length ? [j] : []))))
    setPendingJump(`tree-${i}`)
  }
  const toggleRoot = (i: number) =>
    setClosed((prev) => {
      const next = new Set(prev)
      if (!next.delete(i)) next.add(i)
      return next
    })

  return (
    <div className="arch">
      <nav className="arch__toc" aria-label="目錄">
        <div className="sec-head arch__tabs" role="tablist">
          {(['contents', 'structure'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`sec-head__tag label-caps arch__tab${tab === t ? ' is-active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
          <Rule />
        </div>
        <div className="arch__toc-list">
          {tab === 'contents' && (
            <>
              {rendered?.toc.map((t) => (
                <button key={t.id} type="button" className={`arch__toc-item arch__toc-item--h${t.level}`} onClick={() => jump(t.id)}>
                  {t.text}
                </button>
              ))}
              {rendered && !rendered.toc.length && <p className="sidebar__empty">沒有 ## 標題</p>}
            </>
          )}
          {tab === 'structure' &&
            roots.map((n, i) => (
              <button key={`${n.name}-${i}`} type="button" className="arch__toc-item mono" onClick={() => focusRoot(i)}>
                {n.name}
              </button>
            ))}
        </div>
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
        {rendered && tab === 'contents' && (
          <div ref={body} className="arch__body prose" onClick={onClick} dangerouslySetInnerHTML={{ __html: rendered.html }} />
        )}
        {rendered && tab === 'structure' && (
          <div ref={body} className="arch__body prose" onClick={onClick}>
            {trees.length ? (
              roots.map((n, i) => (
                <ul key={`${n.name}-${i}`} id={`tree-${i}`} className="tree" role="tree">
                  <TreeItem node={n} open={!closed.has(i)} onToggle={() => toggleRoot(i)} />
                </ul>
              ))
            ) : (
              <div className="arch__empty">
                <p>
                  這份文件還沒有資料夾結構。在 <code className="mono">{file?.path ?? architecture.path}</code> 加一個 <code className="mono">{TREE_LANG}</code> 程式碼區塊：每行寫「路徑、兩個以上空白、說明」，縮排兩格表示子層，資料夾以 <code className="mono">/</code> 結尾。
                </p>
                <pre className="code">
                  <code>{`\`\`\`${TREE_LANG}\nsrc/            前端程式碼\n  components/   共用元件\ndocs/           ADR、Milestone、Task 卡片\n\`\`\``}</code>
                </pre>
              </div>
            )}
          </div>
        )}
        </div>
      </article>
    </div>
  )
}

function TreeItem({ node, open: openProp, onToggle }: { node: TreeNode; open?: boolean; onToggle?: () => void }) {
  const [openState, setOpenState] = useState(true)
  const open = openProp ?? openState
  const toggle = onToggle ?? (() => setOpenState(!openState))
  const branch = node.children.length > 0
  const Icon = node.dir ? (open && branch ? FolderOpen : Folder) : File
  const label = (
    <>
      <ChevronRight size={12} className={`tree__chevron${branch ? '' : ' is-leaf'}${open ? ' is-open' : ''}`} />
      <Icon size={14} className="tree__icon" />
      <span className="tree__name mono">{node.name}</span>
    </>
  )
  return (
    <li role="treeitem" aria-expanded={branch ? open : undefined}>
      <div className="tree__row">
        {branch ? (
          <button type="button" className="tree__toggle" onClick={toggle}>
            {label}
          </button>
        ) : (
          <span className="tree__toggle">{label}</span>
        )}
        {node.html && <span className="tree__desc" dangerouslySetInnerHTML={{ __html: node.html }} />}
      </div>
      {open && branch && (
        <ul role="group">
          {node.children.map((c, i) => (
            <TreeItem key={`${c.name}-${i}`} node={c} />
          ))}
        </ul>
      )}
    </li>
  )
}
