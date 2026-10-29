import { useReactFlow, useStore } from '@xyflow/react'
import { Hand, Maximize, Minus, MousePointer2, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { isTyping, useAddCard } from '../hooks'
import { CARD_KINDS } from '../../core/domain'
import { KIND_META } from '../presentation'
import { useProject } from '../store'
import type { CardKind } from '../types'
import { Frame } from './Frame'
import { KindIcon } from './KindIcon'

const ADD_KEYS: Record<string, CardKind> = Object.fromEntries(CARD_KINDS.map((k) => [k[0], k]))
const FIT = { duration: 400, padding: 0.15 }

export function Toolbar() {
  const { tool, setTool } = useProject(useShallow((s) => ({ tool: s.tool, setTool: s.setTool })))
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const zoom = useStore((s) => s.transform[2])
  const add = useAddCard()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if (ADD_KEYS[key]) void add(ADD_KEYS[key])
      else if (key === 'n') setMenuOpen((o) => !o)
      else if (key === 'v') setTool('select')
      else if (key === 'h') setTool('hand')
      else if (key === 'f') fitView(FIT)
      else if (key === 'escape') setMenuOpen(false)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [add, fitView, setTool])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  return (
    <div className="hud" role="toolbar" aria-label="Canvas tools">
      <Frame />
      <div className="hud__seg">
        <button
          type="button"
          className={`hud__btn${tool === 'select' ? ' is-active' : ''}`}
          title="Select (V)"
          aria-pressed={tool === 'select'}
          onClick={() => setTool('select')}
        >
          <MousePointer2 size={16} />
        </button>
        <button
          type="button"
          className={`hud__btn${tool === 'hand' ? ' is-active' : ''}`}
          title="Hand / Pan (H)"
          aria-pressed={tool === 'hand'}
          onClick={() => setTool('hand')}
        >
          <Hand size={16} />
        </button>
      </div>

      <span className="hud__div" />

      <div className="hud__add" ref={menuRef}>
        <button type="button" className="btn btn--primary" title="Add node (N)" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          <Plus size={16} />
          Add Node
        </button>
        {menuOpen && (
          <div className="menu" role="menu">
            <Frame />
            <span className="menu__title label-caps">Add node · 寫入 docs/</span>
            {CARD_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="menuitem"
                className={`menu__item menu__item--${k}`}
                onClick={() => {
                  void add(k)
                  setMenuOpen(false)
                }}
              >
                <KindIcon kind={k} size={15} />
                {KIND_META[k].label}
                <kbd>{k[0].toUpperCase()}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="hud__div" />

      <div className="hud__zoom">
        <button type="button" className="hud__btn" title="Zoom out" onClick={() => zoomOut({ duration: 200 })}>
          <Minus size={16} />
        </button>
        <span className="hud__pct mono">{Math.round(zoom * 100)}%</span>
        <button type="button" className="hud__btn" title="Zoom in" onClick={() => zoomIn({ duration: 200 })}>
          <Plus size={16} />
        </button>
        <button type="button" className="hud__btn" title="Fit to screen (F)" onClick={() => fitView(FIT)}>
          <Maximize size={15} />
        </button>
      </div>
    </div>
  )
}
