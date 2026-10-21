import { AlertTriangle, Check, Rocket, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { InitItemView, InitPlanView, InitResultView } from '../data/client'
import { client, useProject } from '../store'
import { Frame, Rule } from './Frame'

const ACTION_LABEL: Record<InitItemView['action'], string> = {
  create: 'Create',
  append: 'Append',
  upgrade: 'Update',
  skip: 'Skip',
  conflict: 'Conflict',
}

const CONFIG_ITEM = 'nodit.config.json'

const applicable = (i: InitItemView) => i.action !== 'skip' && i.action !== 'conflict'

export function InitPanel() {
  const { open, setOpen, initialized } = useProject(
    useShallow((s) => ({ open: s.initOpen, setOpen: s.setInitOpen, initialized: s.initialized })),
  )
  const [ai, setAi] = useState(true)
  const [plan, setPlan] = useState<InitPlanView | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<InitResultView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (withAi: boolean) => {
    setError(null)
    setResults(null)
    try {
      const p = await client.getInitPlan(withAi)
      setPlan(p)
      setPicked(new Set(p.items.filter(applicable).map((i) => i.itemId)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (open) void load(ai)
  }, [open, ai])

  if (!open) return null

  const apply = async () => {
    if (!plan) return
    setBusy(true)
    const r = await client.applyInit(plan.planId, [...picked])
    setBusy(false)
    if (r.ok) setResults(r.results)
    else setError(r.message)
  }

  const toggle = (id: string) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  const groups: { key: InitItemView['group']; label: string }[] = [
    { key: 'core', label: 'Project' },
    { key: 'ai', label: 'AI instructions' },
  ]

  return (
    <div className="modal" role="dialog" aria-label="Initialize project">
      <div className="modal__panel modal__panel--wide init">
        <Frame />
        <header className="modal__head">
          <span className="sec-head__tag label-caps">
            <Rocket size={12} /> {initialized ? 'Update' : 'Init'}
          </span>
          <span className="mono muted">nodit.config.json · docs/ · AGENTS.md · CLAUDE.md · .claude/skills</span>
          <button type="button" className="icon-btn" aria-label="關閉" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </header>

        <label className="check">
          <input type="checkbox" checked={ai} disabled={busy || !!results} onChange={(e) => setAi(e.target.checked)} />
          產生 AI 指令檔（AGENTS.md、CLAUDE.md 各自加入 Nodit 區塊，並建立 Claude Code skills）。不勾選也能使用 graph。
        </label>

        {error && (
          <div className="ins-alert ins-alert--conflict">
            <p>
              <AlertTriangle size={14} />
              {error}
            </p>
          </div>
        )}

        <div className="init__body">
          {results ? (
            <ul className="init__results mono">
              {results.map((r) => (
                <li key={r.itemId} className={r.ok ? 'is-ok' : 'is-fail'}>
                  {r.ok ? <Check size={13} /> : <AlertTriangle size={13} />}
                  {r.path}
                  {r.error && <span className="muted"> — {r.error}</span>}
                </li>
              ))}
            </ul>
          ) : (
            plan &&
            groups.map(({ key, label }) => {
              const items = plan.items.filter((i) => i.group === key)
              if (!items.length) return null
              return (
                <section key={key} className="init__group">
                  <h2 className="sec-head">
                    <span className="sec-head__tag label-caps">{label}</span>
                    <Rule />
                  </h2>
                  {items.map((item) => (
                    <div key={item.itemId} className="init-item" data-action={item.action}>
                      <label className="init-item__row">
                        <input
                          type="checkbox"
                          disabled={!applicable(item) || busy || item.itemId === CONFIG_ITEM}
                          checked={picked.has(item.itemId) || (item.itemId === CONFIG_ITEM && applicable(item))}
                          onChange={() => toggle(item.itemId)}
                        />
                        <span className="init-item__action mono">{ACTION_LABEL[item.action]}</span>
                        <span className="init-item__path mono">{item.path}</span>
                        <span className="init-item__label">{item.label}</span>
                      </label>
                      {item.reason && <p className="init-item__reason">{item.reason}</p>}
                      {item.diff && (
                        <details className="init-item__diff">
                          <summary className="mono">預覽</summary>
                          <pre className="mono">{item.diff}</pre>
                        </details>
                      )}
                    </div>
                  ))}
                </section>
              )
            })
          )}
        </div>

        <footer className="modal__foot">
          <span className="mono muted">
            {results ? '已開著的 AI 工作階段需要重開，才會載入新的指令檔' : '只會新增或附加；有衝突的項目會略過，不會覆寫'}
          </span>
          {results ? (
            <button type="button" className="btn btn--primary" onClick={() => setOpen(false)}>
              完成
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                取消
              </button>
              <button type="button" className="btn btn--primary" disabled={busy || !plan || !picked.size} onClick={() => void apply()}>
                套用 {picked.size} 項
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
