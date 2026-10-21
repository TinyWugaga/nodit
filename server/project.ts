import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'chokidar'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { CONFIG_FILE, CONFIG_INVALID, loadConfig, type NoditConfig } from '../core/config'
import { CARD_KINDS } from '../core/domain'
import { sha1, toClientDoc, type ParsedDoc } from '../core/parse'
import type { ComponentState, Diagnostic, Envelope, ProjectPayload, ProjectStatus } from '../core/protocol'
import { crossValidate, readLayout, scanDocs, TMP_MARK, type LayoutFile } from '../core/scan'
import { resolveReadable } from '../core/scope'
import { BLOCK_START_RE, skillPath } from '../core/templates'

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
  /** false while the only config ever seen is unusable; card folders are then unknown */
  configAccepted = false
  private configDiagnostics: Diagnostic[] = []
  private docs = new Map<string, ParsedDoc>()
  private projectDiagnostics: Diagnostic[] = []
  private layout: LayoutFile = { revision: 'absent', data: {} }
  private layoutDiagnostics: Diagnostic[] = []
  architectureRevision = 'absent'
  private status: ProjectStatus = { initialized: false, components: {} }
  private scanDiagnostics: Diagnostic[] = []
  private scanChain: Promise<unknown> = Promise.resolve()
  private watcher?: FSWatcher
  private watched: string[] = []
  private timer?: NodeJS.Timeout
  private catchUp?: NodeJS.Timeout

  constructor(readonly root: string) {
    super()
    this.on('error', (err) => console.error('[nodit] rescan failed:', err))
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
      config: this.config,
      status: this.status,
      docs: [...this.docs.values()].map(toClientDoc),
      layout: this.layout,
      architecture: { path: this.config.paths.architecture, revision: this.architectureRevision },
      diagnostics: [...this.scanDiagnostics, ...this.configDiagnostics, ...this.layoutDiagnostics, ...this.projectDiagnostics],
    })
  }

  async start() {
    await this.rescan()
    this.watched = this.watchPaths(this.config)
    this.watcher = watch(this.watched, {
      ignoreInitial: true,
      usePolling: this.config.watch.usePolling,
      ignored: (p) => path.basename(p).includes(TMP_MARK),
    })
    this.watcher.on('all', () => this.scheduleRescan())
    // e.g. EACCES on a watched folder: report through the next scan instead of crashing the process
    this.watcher.on('error', () => this.scheduleRescan())
    // edits made before the watcher is ready emit nothing; one more scan closes that gap
    await new Promise<void>((resolve) => this.watcher!.once('ready', () => resolve()))
    await this.rescan()
  }

  private watchPaths(config: NoditConfig) {
    return [...CARD_KINDS.map((k) => config.paths[k]), config.paths.layout, config.paths.architecture, CONFIG_FILE, ...AI_PATHS].map((p) =>
      path.join(this.root, p),
    )
  }

  /** Follow path changes in an accepted config; usePolling only takes effect on restart. */
  private updateWatch() {
    if (!this.watcher) return
    const next = this.watchPaths(this.config)
    const removed = this.watched.filter((p) => !next.includes(p))
    const added = next.filter((p) => !this.watched.includes(p))
    if (removed.length) this.watcher.unwatch(removed)
    if (added.length) {
      this.watcher.add(added)
      // files created while chokidar indexes the new paths count as initial and emit nothing
      clearTimeout(this.catchUp)
      this.catchUp = setTimeout(() => this.scheduleRescan(), 500)
    }
    this.watched = next
  }

  async stop() {
    clearTimeout(this.timer)
    clearTimeout(this.catchUp)
    await this.watcher?.close()
  }

  private scheduleRescan() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.rescan().catch(() => {}), 80)
  }

  /**
   * Sequential full rescan; publishes a new rev only when content actually changed. A failed scan
   * keeps the previous snapshot and publishes a `scan-failed` diagnostic instead.
   */
  rescan(): Promise<string[]> {
    const job = this.scanChain.then(() =>
      this.scanOnce().catch((err) => {
        const message = `掃描失敗，顯示的是上一次成功的內容：${(err as Error).message}`
        if (this.scanDiagnostics[0]?.message !== message) {
          this.scanDiagnostics = [{ level: 'error', code: 'scan-failed', message }]
          this.rev++
          this.emit('change', this.envelope({ changed: [] }) satisfies ChangeEvent)
        }
        throw err
      }),
    )
    this.scanChain = job.catch((err) => this.emit('error', err))
    return job
  }

  private async scanOnce(): Promise<string[]> {
    const loaded = await loadConfig(this.root)
    const { diagnostics } = loaded
    // an unreadable config keeps the last accepted one instead of falling back to defaults
    const keep = this.config && diagnostics.some((d) => d.code === CONFIG_INVALID)
    const config = keep ? this.config : loaded.config
    const exists = keep ? this.configExists : loaded.exists
    const configChanged = JSON.stringify(config) !== JSON.stringify(this.config) || exists !== this.configExists
    const changedExtra: string[] = []
    const scanned = (await scanDocs(this.root, config)).map((d) => this.retainCard(d))
    const { docs, diagnostics: cross } = crossValidate(scanned)
    const { layout, diagnostics: layoutDiag } = await readLayout(this.root, config.paths.layout)
    const architectureRevision = await fileRevision(this.root, config.paths.architecture)
    const architectureChanged = architectureRevision !== this.architectureRevision
    if (architectureChanged) changedExtra.push('architecture')
    const configInvalid = diagnostics.some((d) => d.code === CONFIG_INVALID)
    const status = await this.readStatus(config, exists, configInvalid, architectureRevision)
    const statusChanged = JSON.stringify(status) !== JSON.stringify(this.status)

    const next = new Map(docs.map((d) => [d.docKey, d]))
    const changed: string[] = []
    for (const [k, d] of next) if (this.docs.get(k)?.revision !== d.revision || this.docDiagChanged(k, d)) changed.push(k)
    for (const k of this.docs.keys()) if (!next.has(k)) changed.push(k)
    const layoutChanged = layout.revision !== this.layout.revision

    this.config = config
    this.configExists = exists
    if (!configInvalid) this.configAccepted = true
    this.configDiagnostics = diagnostics
    this.docs = next
    this.projectDiagnostics = cross
    this.layout = layout
    this.layoutDiagnostics = layoutDiag
    this.architectureRevision = architectureRevision
    this.status = status
    const recovered = this.scanDiagnostics.length > 0
    this.scanDiagnostics = []
    if (configChanged) this.updateWatch()

    if (changed.length || layoutChanged || configChanged || architectureChanged || statusChanged || recovered || this.rev === 0) {
      this.rev++
      this.emit('change', this.envelope({ changed: [...changed, ...changedExtra] }) satisfies ChangeEvent)
    }
    return changed
  }

  private async readStatus(config: NoditConfig, exists: boolean, invalid: boolean, architectureRevision: string): Promise<ProjectStatus> {
    const components: Record<string, ComponentState> = { config: invalid ? 'invalid' : exists ? 'ok' : 'missing' }
    for (const kind of CARD_KINDS) {
      const dir = await stat(path.join(this.root, ...config.paths[kind].split('/'))).catch(() => null)
      components[kind] = dir?.isDirectory() ? 'ok' : 'missing'
    }
    components.architecture = architectureRevision === 'absent' ? 'missing' : 'ok'
    // installed = recorded by init and still present on disk (block markers for the shared files)
    for (const file of AI_PATHS) {
      const key = file.endsWith('.md') && !file.includes('/') ? `${file}#nodit` : file
      const text = config.managed[key] ? await resolveReadable(this.root, file).then((abs) => readFile(abs, 'utf8')).catch(() => null) : null
      components[key] = text !== null && (key === file || new RegExp(BLOCK_START_RE.source).test(text)) ? 'ok' : 'missing'
    }
    return { initialized: exists && !invalid, components }
  }

  /**
   * A document that stops parsing keeps its last valid card (marked stale) so it does not vanish
   * from the graph; its own diagnostics still describe the current file and it stays read-only.
   */
  private retainCard(d: ParsedDoc): ParsedDoc {
    const prev = this.docs.get(d.docKey)
    if (d.card || !prev?.card || !d.diagnostics.some((x) => x.level === 'error')) return d
    return {
      ...d,
      card: prev.card,
      sections: prev.sections,
      sectionStates: prev.sectionStates,
      stale: true,
      diagnostics: [
        ...d.diagnostics,
        { level: 'warning', code: 'card-stale', message: '目前檔案無效，顯示最後一次有效的內容', docKey: d.docKey, path: d.path },
      ],
    }
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

  /** Resolves with the rev that carries this layout, so the response can be ordered against snapshots. */
  applyLayout(layout: LayoutFile): Promise<number> {
    const job = this.scanChain.then(() => {
      this.layout = layout
      this.layoutDiagnostics = []
      this.rev++
      this.emit('change', this.envelope({ changed: [] }) satisfies ChangeEvent)
      return this.rev
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

const AI_PATHS = ['AGENTS.md', 'CLAUDE.md', ...(['adr', 'milestone', 'task'] as const).map(skillPath)]

export const CROSS_CODES = ['id-duplicate', 'link-dangling', 'supersede-status']

async function fileRevision(root: string, rel: string) {
  try {
    return sha1(await readFile(await resolveReadable(root, rel)))
  } catch {
    return 'absent'
  }
}

function stripCross(d: ParsedDoc): ParsedDoc {
  const diagnostics = d.diagnostics.filter((x) => !CROSS_CODES.includes(x.code))
  return { ...d, diagnostics, writable: !d.legacy && !diagnostics.some((x) => x.level === 'error') }
}
