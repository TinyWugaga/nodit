import type { Edge, Node } from '@xyflow/react'
import type { AdrStatus, CardKind, LinkKind, MilestoneStatus, Priority, TaskStatus } from '../core/domain'
import type { Diagnostic } from '../core/protocol'
import type { DraftView } from './data/drafts'

export type { AdrStatus, CardKind, LinkKind, MilestoneStatus, Priority, TaskStatus }

type CardBase = {
  code: string
  title: string
  docKey: string
  path: string
  revision: string
  writable: boolean
  legacy: boolean
  inferred: string[]
  diagnostics: Diagnostic[]
  /** managed sections: ok = editable, missing = appended on first edit, duplicate = raw only */
  sectionStates: Record<string, 'ok' | 'missing' | 'duplicate'>
  draft?: DraftView
}

export type AdrData = CardBase & {
  kind: 'adr'
  status: AdrStatus
  date: string
  context: string
  decision: string
  consequences: string
}

export type MilestoneData = CardBase & {
  kind: 'milestone'
  status: MilestoneStatus
  dueDate: string
  goal: string
}

export type TaskData = CardBase & {
  kind: 'task'
  status: TaskStatus
  priority: Priority
  assignee: string
  description: string
}

export type CardData = AdrData | MilestoneData | TaskData

export type CardNode = Node<CardData, 'card'>

/** where the relation is physically written: the storing doc and the id it points to */
export type LinkData = { kind: LinkKind; storedAt: { docKey: string; to: string }[] }

export type LinkEdge = Edge<LinkData, 'link'>
