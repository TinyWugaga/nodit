import { PRIORITIES, STATUSES, type Priority, type TaskStatus } from '../../core/domain'
import type { ClientDoc } from '../../core/protocol'
import type { DraftView } from '../data/drafts'
import type { CardNode } from '../types'

export const TASK_STATUSES = STATUSES.task
export type GroupBy = 'none' | 'milestone' | 'assignee' | 'priority'

/** Lane key for cards without a value in the grouped field. */
export const UNSET = '\u0000unset'

/**
 * One task as the board shows it: draft values place the card, disk values for links. `saved`
 * holds what is on disk; statistics only ever read `saved`.
 */
export type TaskItem = {
  docKey: string
  code: string
  title: string
  status: TaskStatus
  priority: Priority
  assignee: string
  milestone: string | null
  depends: string[]
  writable: boolean
  draft?: DraftView
  saved: { status: TaskStatus; assignee: string }
}

const asStatus = (s: unknown): TaskStatus => ((TASK_STATUSES as readonly unknown[]).includes(s) ? (s as TaskStatus) : 'todo')

export function taskItems(nodes: CardNode[], docs: ClientDoc[]): TaskItem[] {
  const cards = new Map(docs.map((d) => [d.docKey, d.card]))
  const out: TaskItem[] = []
  for (const n of nodes) {
    const d = n.data
    if (d.kind !== 'task') continue
    const card = cards.get(n.id)
    const l = card?.links
    out.push({
      docKey: n.id,
      code: d.code,
      title: d.title,
      status: asStatus(d.status),
      priority: (PRIORITIES as readonly string[]).includes(d.priority) ? d.priority : 'medium',
      assignee: d.assignee.trim(),
      milestone: l?.milestone ?? null,
      depends: l?.depends ?? [],
      writable: d.writable,
      draft: d.draft,
      saved: {
        status: asStatus(card?.status),
        assignee: (card?.type === 'task' ? (card.assignee ?? '') : '').trim(),
      },
    })
  }
  return out
}

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

/** Fixed order inside a column: priority high → low, then ID. Manual order is not kept. */
export function compareTasks(a: TaskItem, b: TaskItem) {
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.code.localeCompare(b.code, undefined, { numeric: true })
}

export function laneOf(item: TaskItem, by: GroupBy): string {
  if (by === 'milestone') return item.milestone ?? UNSET
  if (by === 'assignee') return item.assignee || UNSET
  if (by === 'priority') return item.priority
  return 'all'
}

/** Only a change of status, inside the same lane, on a writable card. */
export function canDrop(item: TaskItem, to: TaskStatus, lane: string, by: GroupBy) {
  return item.writable && item.status !== to && laneOf(item, by) === lane
}

export type Lane = { key: string; columns: Record<TaskStatus, TaskItem[]>; total: number; shown: number }

/**
 * Lanes hold the cards that pass `visible`; `total` still counts every task of the lane so a
 * search never changes what the header reports.
 */
export function buildLanes(items: TaskItem[], by: GroupBy, visible: (i: TaskItem) => boolean): Lane[] {
  const lanes = new Map<string, Lane>()
  for (const item of items) {
    const key = laneOf(item, by)
    let lane = lanes.get(key)
    if (!lane) {
      lane = { key, columns: { todo: [], doing: [], blocked: [], done: [] }, total: 0, shown: 0 }
      lanes.set(key, lane)
    }
    lane.total++
    if (!visible(item)) continue
    lane.shown++
    lane.columns[item.status].push(item)
  }
  for (const lane of lanes.values()) for (const s of TASK_STATUSES) lane.columns[s].sort(compareTasks)
  const rank = (key: string) => (by === 'priority' ? PRIORITY_ORDER[key as Priority] : 0)
  return [...lanes.values()].sort(
    (a, b) => Number(a.key === UNSET) - Number(b.key === UNSET) || rank(a.key) - rank(b.key) || a.key.localeCompare(b.key, undefined, { numeric: true }),
  )
}

export type MilestoneProgress = { code: string; title: string; done: number; total: number }

/**
 * Completed tasks over all tasks of each milestone; counts tasks, not effort. Always over every
 * task and only saved values: a draft that is pending or failed changes nothing here.
 */
export function milestoneProgress(items: TaskItem[], milestones: { code: string; title: string }[]): MilestoneProgress[] {
  return milestones
    .map((m) => {
      const own = items.filter((i) => i.milestone === m.code)
      return { code: m.code, title: m.title, done: own.filter((i) => i.saved.status === 'done').length, total: own.length }
    })
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
}

export type AssigneeLoad = { assignee: string; doing: number; blocked: number }

/** doing and blocked are kept apart: merged, stuck work would vanish from the load. Saved values only. */
export function assigneeLoad(items: TaskItem[]): AssigneeLoad[] {
  const load = new Map<string, AssigneeLoad>()
  for (const i of items) {
    const key = i.saved.assignee || UNSET
    const row = load.get(key) ?? { assignee: key, doing: 0, blocked: 0 }
    if (i.saved.status === 'doing') row.doing++
    if (i.saved.status === 'blocked') row.blocked++
    load.set(key, row)
  }
  return [...load.values()]
    .filter((r) => r.doing || r.blocked)
    .sort((a, b) => Number(a.assignee === UNSET) - Number(b.assignee === UNSET) || a.assignee.localeCompare(b.assignee))
}

export type DependencyHints = { unfinished: string[]; unresolved: string[] }

/**
 * Direct `depends` only. An ID that matches no card, or more than one, is unresolved: Nodit cannot
 * tell its state, so it is never reported as merely unfinished. Never changes any status.
 */
export function dependencyHints(item: TaskItem, statusById: Map<string, string[]>): DependencyHints {
  const hints: DependencyHints = { unfinished: [], unresolved: [] }
  for (const id of item.depends) {
    const found = statusById.get(id)
    if (found?.length !== 1) hints.unresolved.push(id)
    else if (found[0] !== 'done') hints.unfinished.push(id)
  }
  return hints
}

export function statusIndex(nodes: CardNode[]) {
  const index = new Map<string, string[]>()
  for (const n of nodes) index.set(n.data.code, [...(index.get(n.data.code) ?? []), n.data.status])
  return index
}
