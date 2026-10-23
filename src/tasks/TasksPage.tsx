import { AlertTriangle, GitBranch, Link2Off, User } from 'lucide-react'
import { useMemo, useState, type DragEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { SyncChip } from '../components/Inspector'
import { matchesQuery, PRIORITY_LABEL, STATUS_LABEL } from '../presentation'
import { useProject } from '../store'
import type { TaskStatus } from '../types'
import {
  assigneeLoad,
  buildLanes,
  canDrop,
  dependencyHints,
  milestoneProgress,
  statusIndex,
  TASK_STATUSES,
  taskItems,
  UNSET,
  type GroupBy,
  type Lane,
  type TaskItem,
} from './board'

const GROUPS: Record<GroupBy, string> = { none: '不分組', milestone: 'Milestone', assignee: 'Assignee', priority: 'Priority' }

type Drag = { item: TaskItem; lane: string }

export function TasksPage() {
  const { nodes, docs, query, select, editField } = useProject(
    useShallow((s) => ({ nodes: s.nodes, docs: s.docs, query: s.query, select: s.select, editField: s.editField })),
  )
  const [by, setBy] = useState<GroupBy>('none')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const items = useMemo(() => taskItems(nodes, docs), [nodes, docs])
  const statuses = useMemo(() => statusIndex(nodes), [nodes])
  const titleByCode = useMemo(() => new Map(nodes.map((n) => [n.data.code, n.data.title])), [nodes])
  const visible = useMemo(() => {
    const data = new Map(nodes.map((n) => [n.id, n.data]))
    return (i: TaskItem) => matchesQuery(data.get(i.docKey)!, query)
  }, [nodes, query])
  const lanes = useMemo(() => buildLanes(items, by, visible), [items, by, visible])
  const progress = useMemo(
    () =>
      milestoneProgress(
        items,
        nodes.filter((n) => n.data.kind === 'milestone').map((n) => ({ code: n.data.code, title: n.data.title })),
      ),
    [items, nodes],
  )
  const load = useMemo(() => assigneeLoad(items), [items])
  const selected = nodes.find((n) => n.selected)?.id
  const shown = lanes.reduce((sum, l) => sum + l.shown, 0)
  const filtered = query.trim() !== ''
  const unsaved = items.filter((i) => i.draft).length

  const laneTitle = (lane: Lane) => {
    if (lane.key === UNSET) return by === 'milestone' ? '未指定 milestone' : '未指定 assignee'
    if (by === 'milestone') {
      const title = titleByCode.get(lane.key)
      return title === undefined ? `${lane.key}（無法解析）` : `${lane.key} · ${title}`
    }
    if (by === 'priority') return PRIORITY_LABEL[lane.key as keyof typeof PRIORITY_LABEL]
    return lane.key
  }

  const laneStat = (lane: Lane) => {
    if (by === 'milestone') {
      const done = items.filter((i) => i.milestone === lane.key && i.saved.status === 'done').length
      return `已完成 ${done} / ${lane.total} 個任務`
    }
    if (by === 'assignee') {
      const own = items.filter((i) => (i.saved.assignee || UNSET) === lane.key)
      return `doing ${own.filter((i) => i.saved.status === 'doing').length} · blocked ${own.filter((i) => i.saved.status === 'blocked').length}`
    }
    return `${lane.total} 個任務`
  }

  const onDrop = (e: DragEvent, lane: string, status: TaskStatus) => {
    e.preventDefault()
    setOver(null)
    if (drag && canDrop(drag.item, status, lane, by)) editField(drag.item.docKey, 'status', status, true)
    setDrag(null)
  }

  return (
    <div className="tasks">
      <div className="tasks__bar">
        <span className="view-tabs tasks__group" role="radiogroup" aria-label="分組">
          {(Object.keys(GROUPS) as GroupBy[]).map((g) => (
            <button key={g} type="button" role="radio" aria-checked={by === g} className={by === g ? 'is-active' : ''} onClick={() => setBy(g)}>
              {GROUPS[g]}
            </button>
          ))}
        </span>
        <span className="muted tasks__note">
          {filtered ? `顯示 ${shown} / ${items.length} 個任務 · ` : ''}
          {unsaved ? `${unsaved} 個任務有未存檔的修改，不計入統計 · ` : ''}統計以全部任務的已存檔內容計算，不受搜尋影響
        </span>
      </div>

      <div className="tasks__summary">
        <section>
          <h3 className="label-caps">Milestones</h3>
          {progress.length ? (
            <ul>
              {progress.map((p) => (
                <li key={p.code}>
                  <span className="mono">{p.code}</span>
                  <span className="tasks__summary-title">{p.title}</span>
                  <span className="mono muted">{p.total ? `已完成 ${p.done} / ${p.total} 個任務` : '尚無任務'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">沒有 milestone</p>
          )}
        </section>
        <section>
          <h3 className="label-caps">負荷（doing · blocked）</h3>
          {load.length ? (
            <ul>
              {load.map((r) => (
                <li key={r.assignee}>
                  <User size={12} />
                  <span className="tasks__summary-title">{r.assignee === UNSET ? '未指定' : r.assignee}</span>
                  <span className="mono muted">
                    doing {r.doing} · blocked {r.blocked}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">沒有進行中或卡住的任務</p>
          )}
        </section>
      </div>

      {!items.length ? (
        <p className="muted tasks__empty">這個專案還沒有任務</p>
      ) : !shown ? (
        <p className="muted tasks__empty">沒有符合搜尋的任務</p>
      ) : (
        <div className="tasks__board">
          {lanes
            .filter((lane) => lane.shown > 0)
            .map((lane) => (
              <section key={lane.key} className="tasks__lane" aria-label={by === 'none' ? '全部任務' : laneTitle(lane)}>
                {by !== 'none' && (
                  <header className="tasks__lane-head">
                    <span>{laneTitle(lane)}</span>
                    <span className="mono muted">{laneStat(lane)}</span>
                  </header>
                )}
                <div className="tasks__columns">
                  {TASK_STATUSES.map((status) => {
                    const id = `${lane.key}|${status}`
                    const droppable = drag !== null && canDrop(drag.item, status, lane.key, by)
                    return (
                      <div
                        key={status}
                        className="tasks__col"
                        data-status={status}
                        data-drop={drag ? (droppable ? (over === id ? 'over' : 'ok') : 'no') : undefined}
                        onDragOver={(e) => {
                          if (!droppable) return
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          if (over !== id) setOver(id)
                        }}
                        onDragLeave={() => over === id && setOver(null)}
                        onDrop={(e) => onDrop(e, lane.key, status)}
                      >
                        <h4 className="tasks__col-head label-caps">
                          {STATUS_LABEL.task[status]}
                          <span className="mono muted">{lane.columns[status].length}</span>
                        </h4>
                        {lane.columns[status].map((item) => (
                          <TaskCard
                            key={item.docKey}
                            item={item}
                            hints={dependencyHints(item, statuses)}
                            milestone={by === 'milestone' ? null : item.milestone}
                            selected={selected === item.docKey}
                            onSelect={() => select(item.docKey)}
                            onDragStart={() => setDrag({ item, lane: lane.key })}
                            onDragEnd={() => {
                              setDrag(null)
                              setOver(null)
                            }}
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  )
}

function TaskCard({
  item,
  hints,
  milestone,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  item: TaskItem
  hints: ReturnType<typeof dependencyHints>
  milestone: string | null
  selected: boolean
  onSelect: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  return (
    <article
      className={`task-card${selected ? ' is-selected' : ''}`}
      data-priority={item.priority}
      draggable={item.writable}
      tabIndex={0}
      aria-label={`${item.code} ${item.title}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', item.code)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      <div className="task-card__top">
        <span className="mono task-card__code">{item.code}</span>
        <span className="task-card__priority mono">{PRIORITY_LABEL[item.priority]}</span>
      </div>
      <p className="task-card__title">{item.title || '未命名'}</p>
      <div className="task-card__meta mono">
        {item.assignee && (
          <span>
            <User size={11} />
            {item.assignee}
          </span>
        )}
        {milestone && <span>{milestone}</span>}
      </div>
      {(hints.unfinished.length > 0 || hints.unresolved.length > 0) && (
        <ul className="task-card__hints">
          {hints.unfinished.length > 0 && (
            <li data-kind="unfinished">
              <GitBranch size={11} />
              依賴未完成：{hints.unfinished.join('、')}
            </li>
          )}
          {hints.unresolved.length > 0 && (
            <li data-kind="unresolved">
              <Link2Off size={11} />
              依賴無法解析：{hints.unresolved.join('、')}
            </li>
          )}
        </ul>
      )}
      {(item.draft || !item.writable) && (
        <div className="task-card__sync" title={item.draft?.message}>
          <SyncChip draft={item.draft} writable={item.writable} />
          {item.draft && ['conflict', 'invalid', 'error', 'auth'].includes(item.draft.status) && (
            <span className="task-card__fix">
              <AlertTriangle size={11} />
              點開卡片處理
            </span>
          )}
        </div>
      )}
    </article>
  )
}
