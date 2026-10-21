import { AlertTriangle, FileCode2, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Diagnostic } from '../../core/protocol'
import { LINK_META } from '../presentation'
import { client, useProject } from '../store'
import { Frame } from './Frame'

export function Toast() {
  const toast = useProject((s) => s.toast)
  if (!toast) return null
  return (
    <div className={`toast toast--${toast.level}`} role="status">
      <AlertTriangle size={14} />
      {toast.message}
    </div>
  )
}

/** Full-file editor for repairs (broken YAML, duplicate ids, legacy conversion). Never saves invalid content. */
export function RawEditor() {
  const { rawDocKey, closeRaw, saveRaw, docs } = useProject(
    useShallow((s) => ({ rawDocKey: s.rawDocKey, closeRaw: s.closeRaw, saveRaw: s.saveRaw, docs: s.docs })),
  )
  const doc = docs.find((d) => d.docKey === rawDocKey)
  const [base, setBase] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [original, setOriginal] = useState('')
  const [problems, setProblems] = useState<Diagnostic[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async (key: string) => {
    const raw = await client.getRaw(key)
    setBase(raw.revision)
    setText(raw.text)
    setOriginal(raw.text)
    setProblems([])
    setMessage(null)
  }

  useEffect(() => {
    if (rawDocKey) void load(rawDocKey).catch((err) => setMessage(String(err)))
  }, [rawDocKey])

  if (!rawDocKey || !doc) return null
  const diskMoved = base !== null && doc.revision !== base

  const save = async () => {
    if (!base) return
    setSaving(true)
    const result = await saveRaw(rawDocKey, base, text)
    setSaving(false)
    if (result.ok) {
      setBase(result.envelope.doc.revision)
      setOriginal(text)
      setProblems([])
      setMessage('已儲存')
      return
    }
    if (result.reason === 'invalid') {
      setProblems(result.diagnostics)
      setMessage('內容無效，沒有寫入；修正下列問題後再存')
    } else if (result.reason === 'conflict') setMessage('檔案在你編輯期間被修改，沒有寫入。你的內容仍保留在編輯器裡。')
    else setMessage(result.message)
  }

  return (
    <div className="modal" role="dialog" aria-label="Raw markdown">
      <div className="modal__panel modal__panel--wide">
        <Frame />
        <header className="modal__head">
          <span className="sec-head__tag label-caps">
            <FileCode2 size={12} /> Raw
          </span>
          <span className="mono muted">{doc.path}</span>
          <button type="button" className="icon-btn" aria-label="關閉" onClick={closeRaw}>
            <X size={16} />
          </button>
        </header>
        {diskMoved && (
          <div className="ins-alert">
            <p>
              <AlertTriangle size={14} />
              磁碟上的檔案已更新。存檔會被拒絕，可以先重新載入（會丟掉這裡的修改）。
            </p>
            <div className="ins-alert__actions">
              <button type="button" className="btn" onClick={() => void load(rawDocKey)}>
                重新載入磁碟版本
              </button>
            </div>
          </div>
        )}
        <textarea className="raw-editor mono" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        {problems.length > 0 && (
          <ul className="raw-problems">
            {problems.map((p, i) => (
              <li key={i}>
                <AlertTriangle size={13} />
                {p.message}
              </li>
            ))}
          </ul>
        )}
        <footer className="modal__foot">
          <span className="mono muted">{message ?? (text === original ? '未修改' : '尚未儲存')}</span>
          <button type="button" className="btn" onClick={closeRaw}>
            關閉
          </button>
          <button type="button" className="btn btn--primary" disabled={saving || text === original || !base} onClick={() => void save()}>
            驗證並儲存
          </button>
        </footer>
      </div>
    </div>
  )
}

export function DeleteDialog() {
  const { deleteRequest, requestDelete, deleteCard, referencesTo, docs } = useProject(
    useShallow((s) => ({
      deleteRequest: s.deleteRequest,
      requestDelete: s.requestDelete,
      deleteCard: s.deleteCard,
      referencesTo: s.referencesTo,
      docs: s.docs,
    })),
  )
  const [clear, setClear] = useState(false)
  const [busy, setBusy] = useState(false)
  const doc = docs.find((d) => d.docKey === deleteRequest)
  if (!deleteRequest || !doc?.card) return null
  const refs = referencesTo(deleteRequest)

  return (
    <div className="modal" role="dialog" aria-label="Delete card">
      <div className="modal__panel">
        <Frame />
        <header className="modal__head">
          <span className="sec-head__tag label-caps">Delete</span>
          <span className="mono">{doc.card.id}</span>
          <button type="button" className="icon-btn" aria-label="關閉" onClick={() => requestDelete(null)}>
            <X size={16} />
          </button>
        </header>
        <p className="modal__text">
          刪除 <b className="mono">{doc.path}</b>。檔案會從磁碟移除；如果有版控，可以從 git 還原。
        </p>
        {refs.length > 0 ? (
          <>
            <p className="modal__text">有 {refs.length} 份文件引用這張卡片：</p>
            <ul className="ref-list mono">
              {refs.map((r) => (
                <li key={r.docKey}>
                  {r.code} <span className="muted">{r.changes.map((c) => LINK_META[c.rel].label).join('、')}</span>
                </li>
              ))}
            </ul>
            <label className="check">
              <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
              同時從這些文件移除引用（逐份寫入；不勾選則保留為懸空參照並顯示診斷）
            </label>
          </>
        ) : (
          <p className="modal__text muted">沒有其他文件引用這張卡片。</p>
        )}
        <footer className="modal__foot">
          <span />
          <button type="button" className="btn" onClick={() => requestDelete(null)}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await deleteCard(deleteRequest, clear)
              setBusy(false)
              setClear(false)
            }}
          >
            <Trash2 size={14} />
            刪除檔案
          </button>
        </footer>
      </div>
    </div>
  )
}
