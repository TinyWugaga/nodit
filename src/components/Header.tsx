import { Archive, ChevronDown, Download, Search, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { LEGACY_STORAGE_KEY, useProject } from '../store'

function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

function readLegacy() {
  try {
    return localStorage.getItem(LEGACY_STORAGE_KEY)
  } catch {
    return null
  }
}

export function Header() {
  const { projectName, query, setQuery, view, setView, importLegacy, setSwitcherOpen } = useProject(
    useShallow((s) => ({
      projectName: s.projectName,
      query: s.query,
      setQuery: s.setQuery,
      view: s.view,
      setView: s.setView,
      importLegacy: s.importLegacy,
      setSwitcherOpen: s.setSwitcherOpen,
    })),
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [legacy] = useState(readLegacy)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const exportSnapshot = () => {
    const { meta, docs, layout } = useProject.getState()
    download(`${projectName || 'project'}.nodit-snapshot.json`, JSON.stringify({ meta, docs, layout }, null, 2))
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    try {
      await importLegacy(await file.text())
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <header className="header">
      <div className="crumbs mono">
        <span>Workspace</span>
        <span className="crumbs__sep">/</span>
        <button type="button" className="crumbs__project crumbs__switch" title="切換到另一個本地專案" onClick={() => setSwitcherOpen(true)}>
          {projectName || '…'}
          <ChevronDown size={13} />
        </button>
        <span className="crumbs__sep">/</span>
        <span className="view-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'graph'} className={view === 'graph' ? 'is-active' : ''} onClick={() => setView('graph')}>
            Graph Canvas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'architecture'}
            className={view === 'architecture' ? 'is-active' : ''}
            onClick={() => setView('architecture')}
          >
            Architecture
          </button>
        </span>
      </div>

      <div className="header__right">
        <label className="search">
          <Search size={15} />
          <input
            ref={searchRef}
            value={query}
            placeholder="Filter nodes…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('')
                e.currentTarget.blur()
              }
            }}
          />
          {query ? (
            <button type="button" className="search__clear" aria-label="清除搜尋" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          ) : (
            <kbd>⌘K</kbd>
          )}
        </label>

        <div className="btn-group">
          <button type="button" className="icon-btn" title="匯出目前的 snapshot（JSON）" onClick={exportSnapshot}>
            <Download size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="匯入舊版 localStorage 匯出的 JSON（只能匯入沒有卡片的專案；中斷後選同一個檔案即可續跑）"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={16} />
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
          {legacy && (
            <button
              type="button"
              className="icon-btn"
              title="下載舊版瀏覽器裡的專案資料（localStorage）"
              onClick={() => download('nodit-legacy-localstorage.json', legacy)}
            >
              <Archive size={16} />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
