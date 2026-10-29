import { AlertTriangle, Moon, PanelLeftClose, PanelLeftOpen, Rocket, Sun } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useFocusNode } from '../hooks'
import { CARD_KINDS } from '../../core/domain'
import { KIND_SECTION, matchesQuery } from '../presentation'
import { useProject } from '../store'
import type { CardKind, CardNode } from '../types'
import { Rule } from './Frame'
import { KindIcon } from './KindIcon'

const SECTIONS = CARD_KINDS.map((kind) => ({ kind, label: KIND_SECTION[kind] }))

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="6" />
      <path d="M12.5 13.5 19.5 18.5" />
      <circle cx="10" cy="11" r="3.5" />
      <circle cx="22" cy="21" r="3.5" />
    </svg>
  )
}

export function Sidebar() {
  const { nodes, docs, projectDiagnostics, connection, compromised, loadError, query, theme, setTheme, collapsed, toggleSidebar, openRaw, setInitOpen, view, focusCard } = useProject(
    useShallow((s) => ({
      nodes: s.nodes,
      docs: s.docs,
      projectDiagnostics: s.projectDiagnostics,
      connection: s.connection,
      compromised: s.compromised,
      loadError: s.loadError,
      query: s.query,
      theme: s.theme,
      setTheme: s.setTheme,
      collapsed: s.sidebarCollapsed,
      toggleSidebar: s.toggleSidebar,
      openRaw: s.openRaw,
      setInitOpen: s.setInitOpen,
      view: s.view,
      focusCard: s.focusCard,
    })),
  )
  const seen = new Set<string>()
  const diagnostics = [...docs.flatMap((d) => d.diagnostics), ...projectDiagnostics].filter((x) => {
    const key = `${x.path}|${x.code}|${x.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const focus = useFocusNode()

  const byKind = (kind: CardKind) =>
    nodes
      .filter((n): n is CardNode => n.data.kind === kind && matchesQuery(n.data, query))
      .sort((a, b) => a.data.code.localeCompare(b.data.code))

  return (
    <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="sidebar__brand">
        <Logo />
        <span className="sidebar__name">Nodit</span>
        <button
          type="button"
          className="icon-btn sidebar__toggle"
          aria-label={collapsed ? '展開側欄' : '收合側欄'}
          aria-expanded={!collapsed}
          title={collapsed ? '展開側欄' : '收合側欄'}
          onClick={toggleSidebar}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <div className="sidebar__scroll">
        {SECTIONS.map(({ kind, label }) => {
          const items = byKind(kind)
          return (
            <section key={kind} className="sidebar__section">
              <h2 className="sec-head" title={collapsed ? label : undefined}>
                <span className="sec-head__tag label-caps">{label}</span>
                <Rule />
                <span className="mono">{String(items.length).padStart(2, '0')}</span>
              </h2>
              <nav className="sidebar__list">
                {items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`nav-item nav-item--${kind}${n.selected ? ' is-active' : ''}`}
                    aria-current={n.selected ? 'true' : undefined}
                    data-status={n.data.status}
                    title={collapsed ? `${n.data.code} ${n.data.title || '未命名'}` : undefined}
                    onClick={() => (view === 'graph' ? focus(n.id) : focusCard(n.data.code))}
                  >
                    <KindIcon kind={kind} size={14} />
                    <span className="nav-item__code mono">{n.data.code}</span>
                    <span className="nav-item__title">{n.data.title || '未命名'}</span>
                    <i className="nav-item__dot" />
                  </button>
                ))}
                {!items.length && <p className="sidebar__empty">{query ? '沒有符合的卡片' : '尚無卡片'}</p>}
              </nav>
            </section>
          )
        })}
        <section className="sidebar__section">
          <h2 className="sec-head" title={collapsed ? 'Diagnostics' : undefined}>
            <span className="sec-head__tag label-caps">Diagnostics</span>
            <Rule />
            <span className="mono">{String(diagnostics.length).padStart(2, '0')}</span>
          </h2>
          <div className="diag-list">
            {diagnostics.map((x, i) => (
              <button
                key={i}
                type="button"
                className={`diag diag--${x.level}`}
                disabled={!x.docKey}
                onClick={() => {
                  if (!x.docKey) return
                  const node = nodes.find((n) => n.id === x.docKey)
                  if (!node) openRaw(x.docKey)
                  else if (view === 'graph') focus(x.docKey)
                  else focusCard(node.data.code)
                }}
                title={x.path}
              >
                <AlertTriangle size={13} />
                <span>
                  <b className="mono">{x.path ?? 'project'}</b>
                  {x.message}
                </span>
              </button>
            ))}
            {!diagnostics.length && <p className="sidebar__empty">沒有問題</p>}
          </div>
        </section>
      </div>

      <footer className="sidebar__foot">
        <span className="live mono" data-state={compromised || loadError ? 'error' : connection} title={compromised ?? loadError ?? (collapsed ? connection : undefined)}>
          <i />
          <span className="live__text">{compromised ? 'writer lost' : loadError ? 'load error' : connection === 'open' ? 'live · 127.0.0.1' : connection}</span>
        </span>
        <span className="sidebar__actions">
        <button type="button" className="icon-btn" title="Init / 更新 AI 指令檔" onClick={() => setInitOpen(true)}>
          <Rocket size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={theme === 'light' ? '切換深色' : '切換淺色'}
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
        </span>
      </footer>
    </aside>
  )
}
