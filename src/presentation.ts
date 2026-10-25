import type { AdrStatus, CardData, CardKind, LinkKind, MilestoneStatus, Priority, TaskStatus } from './types'
import type { ReviewTargetState } from '../core/domain'

export const KIND_META: Record<CardKind, { label: string; prefix: string; pad: number }> = {
  adr: { label: 'ADR', prefix: 'ADR-', pad: 3 },
  milestone: { label: 'Milestone', prefix: 'MS-', pad: 2 },
  task: { label: 'Task', prefix: 'T-', pad: 3 },
}

export const STATUS_LABEL = {
  adr: {
    proposed: 'Proposed',
    accepted: 'Accepted',
    deprecated: 'Deprecated',
    superseded: 'Superseded',
  } satisfies Record<AdrStatus, string>,
  milestone: {
    planned: 'Planned',
    active: 'Active',
    done: 'Done',
  } satisfies Record<MilestoneStatus, string>,
  task: {
    todo: 'To do',
    doing: 'Doing',
    blocked: 'Blocked',
    done: 'Done',
  } satisfies Record<TaskStatus, string>,
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const LINK_META: Record<LinkKind, { label: string; hint: string }> = {
  relates: { label: 'relates', hint: '一般關聯' },
  implements: { label: 'implements', hint: '實作某項決策' },
  'part-of': { label: 'part of', hint: '隸屬於里程碑' },
  depends: { label: 'depends on', hint: '依賴（需先完成）' },
  supersedes: { label: 'supersedes', hint: '取代舊決策' },
}




export function matchesQuery(d: CardData, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields = [d.code, d.title]
  if (d.kind === 'adr') fields.push(d.context, d.decision, d.consequences)
  else if (d.kind === 'milestone') fields.push(d.goal)
  else fields.push(d.description, d.assignee)
  return fields.some((f) => f.toLowerCase().includes(q))
}

export const STATUS_RANK: Record<string, number> = {
  deprecated: 0,
  superseded: 0,
  proposed: 1,
  planned: 1,
  todo: 1,
  blocked: 2,
  doing: 2,
  active: 2,
  accepted: 3,
  done: 3,
}

export const VERDICT_META: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  approve: { label: 'Approve', tone: 'good' },
  changes: { label: 'Changes', tone: 'warn' },
  reject: { label: 'Reject', tone: 'bad' },
}

export const REVIEW_STATUS_LABEL: Record<string, string> = { open: 'Open', addressed: '已處理', dismissed: '已略過' }

export const TARGET_STATE_LABEL: Record<ReviewTargetState, string> = {
  current: '評估的是目前版本',
  stale: '評估後已修改',
  unrecorded: '未記錄版本',
  missing: '卡片不存在',
}
