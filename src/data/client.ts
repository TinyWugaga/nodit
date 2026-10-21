import type { CardKind, LinkKind } from '../../core/domain'
import type { ClientDoc, Diagnostic, Envelope, MutationResult, ProjectPayload } from '../../core/protocol'

export type Meta = { projectId: string; sessionId: string; rev: number }

export type SubscribeHandlers = {
  hello: (e: Envelope<object>) => void
  changed: (e: Envelope<{ changed: string[] }>) => void
  status: (s: 'open' | 'closed') => void
  compromised: (message: string) => void
}

export type LinkChange = { rel: LinkKind; to: string }

export type NewCardInput = {
  type: CardKind
  title: string
  fields?: Record<string, string>
  links?: LinkChange[]
}

export type Failure = { ok: false; reason: 'conflict' | 'invalid' | 'auth' | 'compromised' | 'error'; message: string; diagnostics?: Diagnostic[] }

export type CreateResult = { ok: true; envelope: Envelope<{ doc: ClientDoc }> } | Failure
export type DeleteResult = { ok: true; envelope: Envelope<object> } | Failure
export type LayoutResult =
  | { ok: true; revision: string }
  | { ok: false; reason: 'conflict'; layout: ProjectPayload['layout'] }
  | Failure

/** Transport-agnostic access to one project. HTTP today; IPC if Nodit is ever wrapped in Electron. */
export interface ProjectClient {
  /** increments every time the event stream (re)connects */
  readonly connGen: number
  getProject(): Promise<Envelope<ProjectPayload>>
  /** keys prefixed with `section:` are sent as managed section edits */
  patchDoc(docKey: string, baseRevision: string, patch: Record<string, string | null>): Promise<MutationResult>
  getRaw(docKey: string): Promise<{ revision: string; text: string }>
  putRaw(docKey: string, baseRevision: string, text: string): Promise<MutationResult>
  patchLinks(docKey: string, baseRevision: string, change: { add?: LinkChange[]; remove?: LinkChange[] }): Promise<MutationResult>
  deleteDoc(docKey: string, baseRevision: string): Promise<DeleteResult>
  createCard(input: NewCardInput): Promise<CreateResult>
  putLayout(baseRevision: string, data: Record<string, { x: number; y: number }>): Promise<LayoutResult>
  getArchitecture(): Promise<{ path: string; revision: string; markdown: string | null }>
  getInitPlan(ai: boolean): Promise<InitPlanView>
  applyInit(planId: string, itemIds: string[]): Promise<{ ok: true; results: InitResultView[] } | Failure>
  subscribe(handlers: SubscribeHandlers): () => void
}

export type InitItemView = {
  itemId: string
  path: string
  label: string
  group: 'core' | 'ai'
  action: 'create' | 'append' | 'upgrade' | 'skip' | 'conflict'
  reason?: string
  diff: string
}

export type InitPlanView = { planId: string; ai: boolean; items: InitItemView[] }

export type InitResultView = { itemId: string; path: string; ok: boolean; error?: string }
