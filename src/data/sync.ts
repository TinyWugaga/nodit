import type { Envelope, ProjectPayload } from '../../core/protocol'
import type { Meta, ProjectClient, SwitchTarget } from './client'

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
 * session and closes the gap between the initial GET and the subscription. A tab stays bound to
 * the project root it loaded; once the server serves another root, it stops and reports `switched`.
 */
export class ProjectSync {
  meta: Meta | null = null
  expectedSession: string | null = null
  root: string | null = null
  /** this tab is switching itself; foreign snapshots and switch notices wait for `adopt` */
  private switching = false
  private heldNotice: SwitchTarget | null = null
  private stopped = false
  private unsubscribe?: () => void

  constructor(
    private client: ProjectClient,
    private handlers: {
      apply: (snapshot: Envelope<ProjectPayload>) => void
      connection: (s: 'open' | 'closed') => void
      compromised: (message: string) => void
      switched: (to: { name: string }) => void
      error: (err: unknown) => void
    },
  ) {}

  start() {
    void this.fetch()
    this.unsubscribe = this.client.subscribe({
      hello: (e) => {
        if (this.switching) return
        this.expectedSession = e.sessionId
        if (needsRefetch(this.meta, e)) void this.fetch()
      },
      changed: (e) => {
        if (this.expectedSession && e.sessionId !== this.expectedSession) return
        if (needsRefetch(this.meta, e)) void this.fetch()
      },
      switched: (e) => {
        if (this.switching) this.heldNotice = e.to
        else if (e.to.sessionId !== this.client.sessionId) this.lose(e.to)
      },
      status: this.handlers.connection,
      compromised: this.handlers.compromised,
    })
  }

  stop() {
    this.stopped = true
    this.unsubscribe?.()
  }

  /** The server now serves another project than this tab shows: stop syncing, never apply it. */
  private lose(to: { name: string }) {
    if (this.stopped) return
    this.stop()
    this.handlers.switched(to)
  }

  beginSwitch() {
    this.switching = true
    this.heldNotice = null
  }

  /** Our own switch succeeded (the client already carries the new token and session). */
  adopt(snap: Envelope<ProjectPayload>) {
    this.switching = false
    this.meta = null
    this.expectedSession = snap.sessionId
    this.bind(snap)
    const notice = this.heldNotice
    this.heldNotice = null
    // someone else switched again right after us
    if (notice && notice.sessionId !== snap.sessionId) this.lose(notice)
    else void this.fetch()
  }

  endSwitch() {
    this.switching = false
    const notice = this.heldNotice
    this.heldNotice = null
    if (notice && notice.sessionId !== this.client.sessionId) this.lose(notice)
  }

  private bind(snap: Envelope<ProjectPayload>) {
    this.root = snap.root
    this.meta = metaOf(snap)
    this.client.sessionId = snap.sessionId
    this.handlers.apply(snap)
  }

  async fetch() {
    const gen = this.client.connGen
    try {
      const snap = await this.client.getProject()
      // a response from an older connection is never applied; that connection's hello refetches
      if (gen !== this.client.connGen || this.stopped || this.switching) return
      if (this.root && snap.root !== this.root) return this.lose({ name: snap.name })
      if (!shouldApply(this.meta, this.expectedSession, snap)) return
      this.bind(snap)
    } catch (err) {
      this.handlers.error(err)
    }
  }
}
