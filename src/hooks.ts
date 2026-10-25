import { useReactFlow } from '@xyflow/react'
import { useCallback, useMemo } from 'react'
import { reviewsFor } from './reviews'
import { useProject } from './store'
import type { CardKind } from './types'

export const CARD_W = 320
export const INSPECTOR_W = 420

function visibleCanvasRect() {
  const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
  const drawer = document.querySelector('.inspector')?.getBoundingClientRect()
  if (!pane) return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const right = drawer ? drawer.left : pane.right
  return { x: (pane.left + right) / 2, y: (pane.top + pane.bottom) / 2 }
}

export function useFocusNode() {
  const { setCenter, getZoom, getNode } = useReactFlow()
  const select = useProject((s) => s.select)

  return useCallback(
    (id: string) => {
      select(id)
      requestAnimationFrame(() => {
        const node = getNode(id)
        if (!node) return
        const zoom = Math.max(getZoom(), 0.8)
        const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
        const offset = pane ? (pane.width / 2 - (visibleCanvasRect().x - pane.left)) / zoom : 0
        const w = node.measured?.width ?? CARD_W
        const h = node.measured?.height ?? 160
        setCenter(node.position.x + w / 2 + offset, node.position.y + h / 2, { zoom, duration: 400 })
      })
    },
    [getNode, getZoom, select, setCenter],
  )
}


export function useAddCard() {
  const { screenToFlowPosition } = useReactFlow()
  const createCard = useProject((s) => s.createCard)

  return useCallback(
    (kind: CardKind, linkFrom?: string, at?: { x: number; y: number }) => {
      const center = at ?? screenToFlowPosition(visibleCanvasRect())
      const jitter = () => (at ? 0 : (Math.random() - 0.5) * 80)
      return createCard(kind, { x: center.x - (at ? 0 : CARD_W / 2) + jitter(), y: center.y - (at ? 0 : 80) + jitter() }, linkFrom)
    },
    [createCard, screenToFlowPosition],
  )
}

export function isTyping(el: EventTarget | null) {
  return el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

export function useReviewsFor(cardId: string) {
  const reviews = useProject((s) => s.reviews)
  return useMemo(() => reviewsFor(reviews, cardId), [reviews, cardId])
}
