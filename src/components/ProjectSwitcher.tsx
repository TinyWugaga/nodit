import { AlertTriangle, ArrowUp, Folder, FolderGit2, FolderOpen, History, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { DirListing, RecentProjects } from '../data/client'
import { client, useProject } from '../store'
import { Frame } from './Frame'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function parentOf(p: string) {
  const i = p.replace(/[\\/]+$/, '').search(/[\\/][^\\/]*$/)
  return i > 0 ? p.slice(0, i) : null
}

/** Open another local project on this server: type a path, pick a recent one, or browse inside the browse root. */
export function ProjectSwitcher() {
  const { open, setOpen, switchProject, unsavedDrafts } = useProject(
    useShallow((s) => ({ open: s.switcherOpen, setOpen: s.setSwitcherOpen, switchProject: s.switchProject, unsavedDrafts: s.unsavedDrafts })),
  )
  const [recent, setRecent] = useState<RecentProjects | null>(null)
  const [listing, setListing] = useState<DirListing | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const browse = async (dir: string | null) => {
    try {
      setListing(await client.listDir(dir))
      setError(null)
    } catch (err) {
      setError(message(err))
    }
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    void (async () => {
      try {
        const r = await client.recentProjects()
        setRecent(r)
        setInput(r.current)
        const start = parentOf(r.current)
        const listed = start ? await client.listDir(start).catch(() => null) : null
        setListing(listed ?? (await client.listDir(null)))
      } catch (err) {
        setError(message(err))
      }
    })()
  }, [open])

  if (!open) return null

  const go = async (target: string) => {
    const unsaved = unsavedDrafts()
    if (unsaved && !window.confirm(`還有 ${unsaved} 項修改沒有存檔，切換專案會丟掉它們。要繼續嗎？`)) return
    setBusy(true)
    setError(null)
    const failure = await switchProject(target)
    setBusy(false)
    if (failure) setError(failure)
  }

  return (
    <div className="modal" role="dialog" aria-label="開啟專案">
      <div className="modal__panel modal__panel--switch">
        <Frame />
        <header className="modal__head">
          <span className="sec-head__tag label-caps">
            <FolderOpen size={12} /> Open project
          </span>
          <span className="mono muted">{recent ? `可瀏覽範圍：${recent.browseRoot}` : ''}</span>
          <button type="button" className="icon-btn" aria-label="關閉" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </header>

        <form
          className="switch-path"
          onSubmit={(e) => {
            e.preventDefault()
            if (input.trim()) void go(input.trim())
          }}
        >
          <input className="input mono" value={input} placeholder="/Users/me/code/my-repo" spellCheck={false} onChange={(e) => setInput(e.target.value)} />
          <button type="submit" className="btn btn--primary" disabled={busy || !input.trim()}>
            {busy ? '開啟中…' : '開啟'}
          </button>
        </form>

        {error && (
          <p className="switch-error" role="alert">
            <AlertTriangle size={14} />
            {error}
          </p>
        )}

        <div className="switch-body">
          <section className="switch-col">
            <h3 className="label-caps switch-col__head">
              <History size={12} /> Recent
            </h3>
            {recent?.items.length ? (
              <ul className="switch-list">
                {recent.items.map((r) => (
                  <li key={r.path}>
                    <button type="button" disabled={busy || r.path === recent.current} onClick={() => void go(r.path)}>
                      <FolderGit2 size={14} />
                      <span className="switch-list__name">{r.name}</span>
                      <span className="switch-list__path mono">{r.path === recent.current ? '目前開啟' : r.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted switch-empty">還沒有最近開過的專案</p>
            )}
          </section>

          <section className="switch-col">
            <h3 className="label-caps switch-col__head">
              <Folder size={12} /> Browse
            </h3>
            {listing && (
              <>
                <div className="switch-crumb">
                  <button type="button" className="icon-btn" aria-label="上一層" disabled={!listing.parent} onClick={() => void browse(listing.parent)}>
                    <ArrowUp size={14} />
                  </button>
                  <span className="mono" title={listing.path}>
                    <bdi>{listing.path}</bdi>
                  </span>
                  <button type="button" className="btn" disabled={busy} onClick={() => void go(listing.path)}>
                    開啟這個資料夾
                  </button>
                </div>
                <ul className="switch-list">
                  {listing.entries.map((e) => (
                    <li key={e.path}>
                      <button type="button" onClick={() => void browse(e.path)} onDoubleClick={() => void go(e.path)}>
                        {e.project ? <FolderGit2 size={14} /> : <Folder size={14} />}
                        <span className="switch-list__name">{e.name}</span>
                        {e.project && <span className="switch-list__path mono">repo</span>}
                      </button>
                    </li>
                  ))}
                  {!listing.entries.length && <li className="muted switch-empty">沒有子資料夾</li>}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

/** Shown when another tab switched the server away from the project this tab was editing. */
export function SwitchedAway() {
  const to = useProject((s) => s.switchedAway)
  if (!to) return null
  return (
    <div className="modal" role="alertdialog" aria-label="專案已切換">
      <div className="modal__panel">
        <Frame />
        <header className="modal__head">
          <span className="sec-head__tag label-caps">
            <AlertTriangle size={12} /> Project switched
          </span>
          <span />
          <span />
        </header>
        <p className="modal__text">
          另一個分頁已把 Nodit server 切換到「{to.name}」。這個分頁已停止同步，也不能再寫入；尚未存檔的修改不會寫進新專案。
        </p>
        <div className="modal__foot">
          <span />
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            重新載入並開啟新專案
          </button>
        </div>
      </div>
    </div>
  )
}
