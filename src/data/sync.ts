import type { Envelope, ProjectPayload } from '../../core/protocol'
import type { Meta, ProjectClient } from './client'

export function metaOf(e: Meta): Meta {
  return { projectId: e.projectId, sessionId: e.sessionId, rev: e.rev }
}

/** A snapshot is applied only if it belongs to the confirmed session and is newer than what we have. */
export function shouldApply(current: Meta | null, expectedSession: string | null, incoming: Meta) {
  if (expectedSession && incoming.sessionId !== expectedSession) return false
  if (!current) return true
  if (current.sessionId !== incoming.sessionId) return true
  return incoming.rev > current.rev
}

export function needsRefetch(current: Meta | null, announced: Meta) {
  return !current || current.sessionId !== announced.sessionId || announced.rev > current.rev
}

/**
 * Keeps the local snapshot converged with the server: the stream's `hello` confirms the current
 * session and closes the gap between the initial GET and the subscription.
 */
export class ProjectSync {
  meta: Meta | null = null
  expectedSession: string | null = null
  private unsubscribe?: () => void

  constructor(
    private client: ProjectClient,
    private handlers: {
      apply: (snapshot: Envelope<ProjectPayload>) => void
      connection: (s: 'open' | 'closed') => void
      compromised: (message: string) => void
      error: (err: unknown) => void
    },
  ) {}

  start() {
    void this.fetch()
    this.unsubscribe = this.client.subscribe({
      hello: (e) => {
        this.expectedSession = e.sessionId
        if (needsRefetch(this.meta, e)) void this.fetch()
      },
      changed: (e) => {
        if (this.expectedSession && e.sessionId !== this.expectedSession) return
        if (needsRefetch(this.meta, e)) void this.fetch()
      },
      status: this.handlers.connection,
      compromised: this.handlers.compromised,
    })
  }

  stop() {
    this.unsubscribe?.()
  }

  async fetch() {
    const gen = this.client.connGen
    try {
      const snap = await this.client.getProject()
      // a response from an older connection is never applied; that connection's hello refetches
      if (gen !== this.client.connGen) return
      if (!shouldApply(this.meta, this.expectedSession, snap)) return
      this.meta = metaOf(snap)
      this.handlers.apply(snap)
    } catch (err) {
      this.handlers.error(err)
    }
  }
}
