import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'chokidar'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { CONFIG_FILE, loadConfig, type NoditConfig } from '../core/config'
import { CARD_KINDS } from '../core/domain'
import { sha1, toClientDoc, type ParsedDoc } from '../core/parse'
import type { Diagnostic, Envelope, ProjectPayload } from '../core/protocol'
import { crossValidate, readLayout, scanDocs, TMP_MARK, type LayoutFile } from '../core/scan'

export type ChangeEvent = Envelope<{ changed: string[] }>

/**
 * Canonical in-memory snapshot of one project. `rev` only increases after the snapshot is fully
 * updated, so GET /api/project and SSE events always describe the same state.
 */
export class ProjectService extends EventEmitter {
  readonly sessionId = randomUUID()
  rev = 0
  config!: NoditConfig
  configExists = false
  private configDiagnostics: Diagnostic[] = []
  private docs = new Map<string, ParsedDoc>()
  private projectDiagnostics: Diagnostic[] = []
  private layout: LayoutFile = { revision: 'absent', data: {} }
  private layoutDiagnostics: Diagnostic[] = []
  architectureRevision = 'absent'
  private scanChain: Promise<unknown> = Promise.resolve()
  private watcher?: FSWatcher
  private timer?: NodeJS.Timeout

  constructor(readonly root: string) {
    super()
  }

  get projectId() {
    return this.config.projectId
  }

  envelope<T extends object>(payload: T): Envelope<T> {
    return { projectId: this.projectId, sessionId: this.sessionId, rev: this.rev, ...payload }
  }

  getDoc(docKey: string) {
    return this.docs.get(docKey)
  }

  snapshot(): Envelope<ProjectPayload> {
    return this.envelope({
      name: path.basename(this.root),
      initialized: this.configExists,
      docs: [...this.docs.values()].map(toClientDoc),
      layout: this.layout,
      architecture: { path: this.config.paths.architecture, revision: this.architectureRevision },
      diagnostics: [...this.configDiagnostics, ...this.layoutDiagnostics, ...this.projectDiagnostics],
    })
  }

  async start() {
    await this.rescan()
    const paths = [...CARD_KINDS.map((k) => this.config.paths[k]), this.config.paths.layout, this.config.paths.architecture, CONFIG_FILE].map((p) =>
      path.join(this.root, p),
    )
    this.watcher = watch(paths, {
      ignoreInitial: true,
      usePolling: this.config.watch.usePolling,
      ignored: (p) => path.basename(p).includes(TMP_MARK),
    })
    this.watcher.on('all', () => this.scheduleRescan())
  }

  async stop() {
    clearTimeout(this.timer)
    await this.watcher?.close()
  }

  private scheduleRescan() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.rescan(), 80)
  }

  /** Sequential full rescan; publishes a new rev only when content actually changed. */
  rescan(): Promise<string[]> {
    const job = this.scanChain.then(async () => {
      const { config, exists, diagnostics } = await loadConfig(this.root)
      const configChanged = JSON.stringify(config) !== JSON.stringify(this.config) || exists !== this.configExists
      const changedExtra: string[] = []
      const scanned = await scanDocs(this.root, config)
      const { docs, diagnostics: cross } = crossValidate(scanned)
      const { layout, diagnostics: layoutDiag } = await readLayout(this.root, config.paths.layout)
      const architectureRevision = await fileRevision(path.join(this.root, ...config.paths.architecture.split('/')))
      const architectureChanged = architectureRevision !== this.architectureRevision
      if (architectureChanged) changedExtra.push('architecture')

      const next = new Map(docs.map((d) => [d.docKey, d]))
      const changed: string[] = []
      for (const [k, d] of next) if (this.docs.get(k)?.revision !== d.revision || this.docDiagChanged(k, d)) changed.push(k)
      for (const k of this.docs.keys()) if (!next.has(k)) changed.push(k)
      const layoutChanged = layout.revision !== this.layout.revision

      this.config = config
      this.configExists = exists
      this.configDiagnostics = diagnostics
      this.docs = next
      this.projectDiagnostics = cross
      this.layout = layout
      this.layoutDiagnostics = layoutDiag
      this.architectureRevision = architectureRevision

      if (changed.length || layoutChanged || configChanged || architectureChanged || this.rev === 0) {
        this.rev++
        this.emit('change', this.envelope({ changed: [...changed, ...changedExtra] }) satisfies ChangeEvent)
      }
      return changed
    })
    this.scanChain = job.catch((err) => this.emit('error', err))
    return job
  }

  private docDiagChanged(k: string, d: ParsedDoc) {
    const prev = this.docs.get(k)
    return !!prev && JSON.stringify(prev.diagnostics) !== JSON.stringify(d.diagnostics)
  }

  /** Apply a document the writer just persisted, then publish. Runs on the scan chain. */
  applyWritten(doc: ParsedDoc): Promise<ParsedDoc> {
    return this.mutateDocs((all) => [...all.filter((d) => d.docKey !== doc.docKey), doc], [doc.docKey]).then(
      () => this.docs.get(doc.docKey)!,
    )
  }

  applyDeleted(docKey: string): Promise<void> {
    return this.mutateDocs((all) => all.filter((d) => d.docKey !== docKey), [docKey])
  }

  applyLayout(layout: LayoutFile): Promise<void> {
    const job = this.scanChain.then(() => {
      this.layout = layout
      this.layoutDiagnostics = []
      this.rev++
      this.emit('change', this.envelope({ changed: [] }) satisfies ChangeEvent)
    })
    this.scanChain = job.catch((err) => this.emit('error', err))
    return job
  }

  private mutateDocs(update: (all: ParsedDoc[]) => ParsedDoc[], changed: string[]): Promise<void> {
    const job = this.scanChain.then(() => {
      const all = update([...this.docs.values()]).sort((a, b) => a.path.localeCompare(b.path))
      const { docs, diagnostics } = crossValidate(all.map(stripCross))
      const before = this.docs
      this.docs = new Map(docs.map((d) => [d.docKey, d]))
      this.projectDiagnostics = diagnostics
      for (const [k, d] of this.docs) {
        if (!changed.includes(k) && JSON.stringify(before.get(k)?.diagnostics) !== JSON.stringify(d.diagnostics)) changed.push(k)
      }
      this.rev++
      this.emit('change', this.envelope({ changed }) satisfies ChangeEvent)
    })
    this.scanChain = job.catch((err) => this.emit('error', err))
    return job
  }
}

export const CROSS_CODES = ['id-duplicate', 'link-dangling', 'supersede-status']

async function fileRevision(abs: string) {
  try {
    return sha1(await readFile(abs))
  } catch {
    return 'absent'
  }
}

function stripCross(d: ParsedDoc): ParsedDoc {
  const diagnostics = d.diagnostics.filter((x) => !CROSS_CODES.includes(x.code))
  return { ...d, diagnostics, writable: !d.legacy && !diagnostics.some((x) => x.level === 'error') }
}
