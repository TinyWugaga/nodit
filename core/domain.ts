export const SCHEMA_VERSION = 1

export type CardKind = 'adr' | 'milestone' | 'task'
export const CARD_KINDS: CardKind[] = ['adr', 'milestone', 'task']

export const STATUSES = {
  adr: ['proposed', 'accepted', 'deprecated', 'superseded'],
  milestone: ['planned', 'active', 'done'],
  task: ['todo', 'doing', 'blocked', 'done'],
} as const satisfies Record<CardKind, readonly string[]>

export type AdrStatus = (typeof STATUSES.adr)[number]
export type MilestoneStatus = (typeof STATUSES.milestone)[number]
export type TaskStatus = (typeof STATUSES.task)[number]
export type CardStatus = AdrStatus | MilestoneStatus | TaskStatus

export const PRIORITIES = ['low', 'medium', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]

export type LinkKind = 'relates' | 'implements' | 'part-of' | 'depends' | 'supersedes'
export const LINK_KINDS: LinkKind[] = ['relates', 'implements', 'part-of', 'depends', 'supersedes']

/** frontmatter key that stores each relation on the source document */
export const LINK_FIELD: Record<LinkKind, string> = {
  relates: 'relates',
  implements: 'implements',
  'part-of': 'milestone',
  depends: 'depends',
  supersedes: 'supersedes',
}

/** relation keys each card kind may carry, and whether the key holds a single id */
export const LINK_SCHEMA: Record<CardKind, Partial<Record<LinkKind, { single?: boolean; target: CardKind[] }>>> = {
  adr: { supersedes: { target: ['adr'] }, relates: { target: ['adr', 'milestone', 'task'] } },
  milestone: {
    implements: { target: ['adr'] },
    depends: { target: ['milestone'] },
    relates: { target: ['adr', 'milestone', 'task'] },
  },
  task: {
    implements: { target: ['adr'] },
    'part-of': { single: true, target: ['milestone'] },
    depends: { target: ['task'] },
    relates: { target: ['adr', 'milestone', 'task'] },
  },
}

export const ID_RULES: Record<CardKind, { prefix: string; pad: number; pattern: RegExp }> = {
  adr: { prefix: 'ADR-', pad: 3, pattern: /^ADR-(\d{3,})$/ },
  milestone: { prefix: 'MS-', pad: 2, pattern: /^MS-(\d{2,})$/ },
  task: { prefix: 'T-', pad: 3, pattern: /^T-(\d{3,})$/ },
}

/** frontmatter scalar fields (besides id/type) editable through the metadata API */
export const FIELD_SCHEMA: Record<CardKind, Record<string, 'string' | 'date' | 'status' | 'priority'>> = {
  adr: { title: 'string', status: 'status', date: 'date' },
  milestone: { title: 'string', status: 'status', due: 'date' },
  task: { title: 'string', status: 'status', priority: 'priority', assignee: 'string' },
}

export const MANAGED_SECTIONS: Record<CardKind, string[]> = {
  adr: ['Context', 'Decision', 'Consequences'],
  milestone: ['Goal'],
  task: ['Description'],
}

export type CardLinks = {
  implements: string[]
  milestone?: string
  depends: string[]
  supersedes: string[]
  relates: string[]
}

export type CardRecord = {
  id: string
  type: CardKind
  title: string
  status: CardStatus
  date?: string
  due?: string
  priority?: Priority
  assignee?: string
  links: CardLinks
}

export const REVIEW_VERDICTS = ['approve', 'changes', 'reject'] as const
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number]
export const REVIEW_STATUSES = ['open', 'addressed', 'dismissed'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** current: reviewed content is what is on disk; unrecorded: the review did not say which content it read */
export type ReviewTargetState = 'current' | 'stale' | 'unrecorded' | 'missing'

/** Fields of a review file. Values are only guaranteed valid when the review has no error diagnostics. */
export type ReviewRecord = {
  targets: string[]
  reviewer?: string
  date?: string
  verdict?: string
  status?: string
  targetRev: Record<string, string>
}

export function kindOfId(id: string): CardKind | undefined {
  return CARD_KINDS.find((k) => ID_RULES[k].pattern.test(id))
}

export function idNumber(id: string): number | undefined {
  for (const k of CARD_KINDS) {
    const m = ID_RULES[k].pattern.exec(id)
    if (m) return Number(m[1])
  }
  return undefined
}

export function formatId(kind: CardKind, n: number) {
  const { prefix, pad } = ID_RULES[kind]
  return prefix + String(n).padStart(pad, '0')
}

export function inferLinkKind(source: CardKind, target: CardKind): LinkKind {
  if (source === 'task' && target === 'milestone') return 'part-of'
  if (source !== 'adr' && target === 'adr') return 'implements'
  if (source === target && source !== 'adr') return 'depends'
  return 'relates'
}

export function shouldReverse(source: CardKind, target: CardKind) {
  return (source === 'adr' && target !== 'adr') || (source === 'milestone' && target === 'task')
}

export function isStatus(kind: CardKind, v: unknown): v is CardStatus {
  return typeof v === 'string' && (STATUSES[kind] as readonly string[]).includes(v)
}
