import type { Edge, Node } from '@xyflow/react'
import type { AdrStatus, CardKind, LinkKind, MilestoneStatus, Priority, SpecStatus, TaskStatus } from '../core/domain'
import type { Diagnostic, SpecAdr } from '../core/protocol'
import type { DraftView } from './data/drafts'

export type { AdrStatus, CardKind, LinkKind, MilestoneStatus, Priority, SpecStatus, TaskStatus }

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
  /** managed sections: only ok is editable; missing and duplicate are fixed through raw */
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

export type SpecData = CardBase & {
  kind: 'spec'
  status: SpecStatus
  date: string
  scope: string
  design: string
  criteria: string
  /** each implemented ADR against `adr_rev`; empty when the spec implements no ADR */
  adrStates: SpecAdr[]
}

export type CardData = AdrData | MilestoneData | TaskData | SpecData

export type CardNode = Node<CardData, 'card'>

/** where the relation is physically written: the storing doc and the id it points to */
/** every document that stores this relation, with the revision it was read at */
export type LinkData = { kind: LinkKind; storedAt: { docKey: string; revision: string; to: string }[] }

export type LinkEdge = Edge<LinkData, 'link'>
