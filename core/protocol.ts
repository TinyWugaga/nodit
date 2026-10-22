import type { NoditConfig } from './config'
import type { CardKind, CardRecord } from './domain'

export type Diagnostic = {
  level: 'error' | 'warning'
  code: string
  message: string
  docKey?: string
  path?: string
}

export type SectionView = { state: 'ok'; text: string } | { state: 'missing' } | { state: 'duplicate'; count: number }

export type ClientDoc = {
  docKey: string
  path: string
  kind: CardKind
  revision: string
  card?: CardRecord
  sections: Record<string, SectionView>
  diagnostics: Diagnostic[]
  legacy: boolean
  /** card is the last valid content; the file on disk currently fails to parse */
  stale?: boolean
  inferred: string[]
  writable: boolean
}

export type Envelope<T> = { projectId: string; sessionId: string; rev: number } & T

/** Per-component setup state; AI entries are `ok` once init recorded a baseline for them. */
export type ComponentState = 'ok' | 'missing' | 'invalid'
export type ProjectStatus = { initialized: boolean; components: Record<string, ComponentState> }

export type ProjectPayload = {
  name: string
  /** absolute path of the open project; tells a tab that the server switched projects */
  root: string
  initialized: boolean
  config: NoditConfig
  status: ProjectStatus
  docs: ClientDoc[]
  layout: { revision: string; data: Record<string, { x: number; y: number }> }
  architecture: { path: string; revision: string }
  diagnostics: Diagnostic[]
}

export type FieldPatch = Record<string, string | null>

export type MutationResult =
  | { ok: true; envelope: Envelope<{ doc: ClientDoc }> }
  | { ok: false; reason: 'conflict'; envelope: Envelope<{ current: ClientDoc }> }
  | { ok: false; reason: 'invalid'; diagnostics: Diagnostic[] }
  | { ok: false; reason: 'auth' | 'compromised' | 'error'; message: string }
