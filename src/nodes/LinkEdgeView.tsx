import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { LINK_META } from '../presentation'
import { useProject } from '../store'
import type { LinkEdge, LinkKind } from '../types'

const FLOWING: LinkKind[] = ['implements', 'part-of', 'depends']

function duration(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0
  return 2.4 + (Math.abs(h) % 14) / 10
}

export function LinkEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<LinkEdge>) {
  const select = useProject((s) => s.select)
  const kind = data?.kind ?? 'relates'
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const stroke = `var(--link-${kind})`

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#nodit-arrow-${kind})`}
        style={{ stroke }}
        className={`link link--${kind}${selected ? ' is-selected' : ''}`}
        interactionWidth={18}
      />
      {selected && <path d={path} className="link__flow" style={{ stroke }} />}
      {FLOWING.includes(kind) && (
        <circle r={selected ? 3.5 : 2.75} className="link__particle" style={{ fill: selected ? 'var(--ink)' : stroke }}>
          <animateMotion dur={`${duration(id)}s`} repeatCount="indefinite" path={path} />
        </circle>
      )}
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`link-label nodrag nopan${selected ? ' is-selected' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, ['--c' as string]: stroke }}
          onClick={() => select(id)}
        >
          {LINK_META[kind].label}
        </button>
      </EdgeLabelRenderer>
    </>
  )
}

const KINDS = Object.keys(LINK_META) as LinkKind[]

export function LinkMarkers() {
  return (
    <svg className="link-markers" aria-hidden>
      <defs>
        <filter id="nodit-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        {KINDS.map((k) => (
          <marker
            key={k}
            id={`nodit-arrow-${k}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: `var(--link-${k})` }} />
          </marker>
        ))}
      </defs>
    </svg>
  )
}
