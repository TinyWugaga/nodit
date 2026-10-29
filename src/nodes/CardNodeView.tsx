import { Handle, Position, type NodeProps } from '@xyflow/react'
import { BadgeCheck, CalendarDays, CircleDashed, ListChecks, Lock, Replace, TriangleAlert, User } from 'lucide-react'
import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Frame, StatusDots } from '../components/Frame'
import { KindIcon } from '../components/KindIcon'
import { StatusChip } from '../components/StatusChip'
import { assertNever, KIND_META, matchesQuery, PRIORITY_LABEL, SPEC_ADR_LABEL, STATUS_RANK } from '../presentation'
import { criteriaCount, worstAdrState } from '../specs'
import { useProject } from '../store'
import type { AdrStatus, CardData, CardNode, SpecData } from '../types'
import { ReviewBadge } from '../components/ReviewParts'

const HANDLES = [
  { id: 't', position: Position.Top },
  { id: 'r', position: Position.Right },
  { id: 'b', position: Position.Bottom },
  { id: 'l', position: Position.Left },
]

const ADR_VERDICT: Record<AdrStatus, { icon: typeof BadgeCheck; label: string }> = {
  accepted: { icon: BadgeCheck, label: 'Adopted' },
  proposed: { icon: CircleDashed, label: 'Under review' },
  superseded: { icon: Replace, label: 'Replaced' },
  deprecated: { icon: Lock, label: 'Retired' },
}

export function useMilestoneProgress(id: string) {
  return useProject(
    useShallow((s) => {
      const taskIds = new Set<string>()
      for (const e of s.edges) {
        if (e.data?.kind !== 'part-of') continue
        if (e.target === id) taskIds.add(e.source)
        else if (e.source === id) taskIds.add(e.target)
      }
      let total = 0
      let done = 0
      let blocked = 0
      for (const n of s.nodes) {
        if (n.data.kind !== 'task' || !taskIds.has(n.id)) continue
        total++
        if (n.data.status === 'done') done++
        if (n.data.status === 'blocked') blocked++
      }
      return { total, done, blocked, pct: total ? Math.round((done / total) * 100) : 0 }
    }),
  )
}

function MilestoneProgress({ id }: { id: string }) {
  const { total, done, pct } = useMilestoneProgress(id)
  return (
    <div className="card__metric">
      <div className="card__metric-row mono">
        <span>
          Tasks: {done}/{total} done
        </span>
        <b>{pct}%</b>
      </div>
      <div className="segmeter">
        <div className="segmeter__bar" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
    </div>
  )
}

function SpecFooter({ data }: { data: SpecData }) {
  const worst = worstAdrState(data.adrStates)
  const count = criteriaCount(data.criteria)
  return (
    <footer className="card__tags mono">
      {count && (
        <span className="tag">
          <ListChecks size={11} />
          {count.done}/{count.total}
        </span>
      )}
      {worst && (
        <span className="tag tag--warn" data-state={worst}>
          <TriangleAlert size={11} />
          {SPEC_ADR_LABEL[worst]}
        </span>
      )}
      {!count && !worst && <span className="tag">{data.date || 'No date'}</span>}
    </footer>
  )
}

function KindBody({ id, data }: { id: string; data: CardData }) {
  switch (data.kind) {
    case 'adr': {
      const verdict = ADR_VERDICT[data.status]
      return (
        <>
          {data.decision && <p className="card__body">{data.decision}</p>}
          <footer className="inset mono">
            <span className="muted">Decided {data.date || '—'}</span>
            {verdict && (
              <span className="inset__accent">
                <verdict.icon size={12} />
                {verdict.label}
              </span>
            )}
          </footer>
        </>
      )
    }
    case 'milestone':
      return (
        <>
          {data.goal && <p className="card__body">{data.goal}</p>}
          <MilestoneProgress id={id} />
          <footer className="card__tags mono">
            <span className="tag">
              <CalendarDays size={11} />
              {data.dueDate ? `Due ${data.dueDate}` : 'No due date'}
            </span>
          </footer>
        </>
      )
    case 'task':
      return (
        <>
          {data.description && <p className="card__body">{data.description}</p>}
          {data.status === 'blocked' ? (
            <footer className="inset inset--hazard mono">
              <span className="inset__accent">
                <Lock size={12} />
                Blocked
              </span>
              <span className="muted">{data.assignee || 'Unassigned'}</span>
            </footer>
          ) : (
            <footer className="card__tags mono">
              <span className={`tag tag--${data.priority}`}>
                <i />
                {PRIORITY_LABEL[data.priority]}
              </span>
              <span className="tag">
                <User size={11} />
                {data.assignee || 'Unassigned'}
              </span>
            </footer>
          )}
        </>
      )
    case 'spec':
      return (
        <>
          {data.scope && <p className="card__body">{data.scope}</p>}
          <SpecFooter data={data} />
        </>
      )
    default:
      return assertNever(data)
  }
}

function CardNodeViewImpl({ id, data, selected }: NodeProps<CardNode>) {
  const dimmed = useProject((s) => !matchesQuery(data, s.query))

  return (
    <article
      className={`card card--${data.kind}${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`}
      data-status={data.status}
    >
      <Frame />
      {HANDLES.map((h) => (
        <Handle key={h.id} id={h.id} type="source" position={h.position} className="card__handle" />
      ))}

      <header className="card__head">
        <span className="card__tab label-caps">
          <KindIcon kind={data.kind} size={13} />
          {data.code}
        </span>
        {selected && <span className="card__selected label-caps">• Selected</span>}
        <ReviewBadge cardId={data.code} />
        <span className="card__status">
          <StatusDots rank={STATUS_RANK[data.status] ?? 0} />
          <StatusChip kind={data.kind} status={data.status} />
        </span>
      </header>

      <h3 className={`card__title${data.title ? '' : ' is-empty'}`}>{data.title || `未命名 ${KIND_META[data.kind].label}`}</h3>

      <KindBody id={id} data={data} />
    </article>
  )
}

export const CardNodeView = memo(CardNodeViewImpl)
