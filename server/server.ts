import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { acquireOwner, CompromisedError, LockBusyError, type Owner } from '../core/owner'
import { CARD_KINDS } from '../core/domain'
import { ImportError, runImport } from '../core/import'
import { applyInit, initPaths, planInit, publicPlan, scopedRead, type InitPlan } from '../core/init'
import { revisionOf, toClientDoc, type ParsedDoc } from '../core/parse'
import type { FieldPatch } from '../core/protocol'
import { resolveInScope, ScopeError } from '../core/scope'
import { ConflictError, ValidationError, Writer, type DocPatch, type LinkChange, type NewCard } from '../core/writer'
import { CSP } from './csp'
import { EventHub } from './events'
import { ProjectService } from './project'

export type ServerOptions = {
  root: string
  port: number
  devOrigins?: string[]
  distDir?: string
  /** switching and browsing stay inside this directory; defaults to the home directory */
  browseRoot?: string
  /** recently opened projects; omitted means the list is neither read nor written */
  recentFile?: string
}

export type RunningServer = {
  server: Server
  port: number
  owner: Owner
  project: ProjectService
  close: () => Promise<void>
}

/** Everything one open project needs. A switch builds a new one and swaps it in whole. */
type ProjectContext = {
  root: string
  project: ProjectService
  owner: Owner
  writer: Writer
  hub: EventHub
  plans: Map<string, InitPlan>
  /** set once a switch starts; new writes are refused from then on */
  closing: boolean
  inflight: number
  drained: (() => void)[]
}

export type RecentProject = { path: string; name: string; openedAt: string }

const MAX_BODY = 1024 * 1024
const MAX_RECENT = 10
const MAX_ENTRIES = 500
/** GET routes that still need the token: they reveal paths outside the open project */
const GUARDED_GETS = new Set(['/api/fs/list', '/api/projects/recent'])
const MAX_IMPORT_BODY = 16 * 1024 * 1024
const PLAN_TTL = 10 * 60_000
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message)
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, 'request body too large')
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new HttpError(400, 'invalid JSON')
  }
}

function header(req: IncomingMessage, name: string) {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

function sameToken(a: string | undefined, b: string) {
  if (!a) return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function inside(parent: string, child: string) {
  return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)
}

/** Lock first, then scan; on any failure everything acquired here is released again. */
async function openContext(root: string): Promise<ProjectContext> {
  const project = new ProjectService(root)
  const owner = await acquireOwner(root, 'server', project.sessionId)
  try {
    await project.start()
  } catch (err) {
    await project.stop()
    await owner.release()
    throw err
  }
  const writer = new Writer(root, () => project.config, owner, () => project.configProblems())
  const hub = new EventHub(project)
  owner.onCompromised((err) => hub.broadcast('writer-compromised', project.envelope({ message: err.message })))
  return { root, project, owner, writer, hub, plans: new Map(), closing: false, inflight: 0, drained: [] }
}

async function closeContext(ctx: ProjectContext) {
  ctx.hub.close()
  await ctx.project.stop()
  await ctx.owner.release()
}

/** Refuse new writes, then wait for the ones already running (they hold the old lock until done). */
function drain(ctx: ProjectContext) {
  ctx.closing = true
  return ctx.inflight ? new Promise<void>((resolve) => ctx.drained.push(resolve)) : Promise.resolve()
}

function leave(ctx: ProjectContext) {
  if (--ctx.inflight === 0) for (const fn of ctx.drained.splice(0)) fn()
}

async function readRecent(file: string | undefined): Promise<RecentProject[]> {
  if (!file) return []
  try {
    const data = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(data) ? data.filter((r) => typeof r?.path === 'string' && typeof r?.name === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

/** Best effort: a broken or unwritable recent list must never block opening a project. */
async function recordRecent(file: string | undefined, root: string) {
  if (!file) return
  try {
    const items = (await readRecent(file)).filter((r) => r.path !== root)
    items.unshift({ path: root, name: path.basename(root), openedAt: new Date().toISOString() })
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
    await writeFile(tmp, JSON.stringify(items.slice(0, MAX_RECENT), null, 2))
    await rename(tmp, file)
  } catch (err) {
    console.error('[nodit] recent list not updated:', (err as Error).message)
  }
}

export async function start(opts: ServerOptions): Promise<RunningServer> {
  const browseRoot = path.resolve(opts.browseRoot ?? os.homedir())
  let current = await openContext(path.resolve(opts.root))
  let switching: Promise<unknown> | null = null

  let port = opts.port
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  const allowedOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(opts.devOrigins ?? [])])

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!allowedHosts().has(req.headers.host ?? '')) throw new HttpError(421, 'unexpected Host header')
    const origin = req.headers.origin
    if (origin && !allowedOrigins().has(origin)) throw new HttpError(403, 'origin not allowed')

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    const method = req.method ?? 'GET'

    if (url.pathname.startsWith('/api/')) {
      // one context per request: a switch mid-request never mixes two projects
      const ctx = current
      if (method !== 'GET' || GUARDED_GETS.has(url.pathname)) {
        if (method !== 'GET' && !origin) throw new HttpError(403, 'origin required for writes')
        if (!sameToken(header(req, 'x-nodit-token'), ctx.owner.token)) throw new HttpError(401, 'invalid token')
      }
      if (method === 'GET') return api(ctx, method, url, req, res)
      // the token alone is not enough: a tab must also be looking at this very session
      if (header(req, 'x-nodit-session') !== ctx.project.sessionId) {
        throw new HttpError(412, '專案已切換或 server 已重新啟動，重新載入頁面後才能寫入', { code: 'session-mismatch' })
      }
      if (method === 'POST' && url.pathname === '/api/project/switch') return switchProject(ctx, req, res)
      if (ctx.closing) throw new HttpError(503, '專案切換中，已暫停寫入', { code: 'switching' })
      ctx.inflight++
      try {
        return await api(ctx, method, url, req, res)
      } finally {
        leave(ctx)
      }
    }
    if (method !== 'GET') throw new HttpError(405, 'method not allowed')
    return serveStatic(current, url.pathname, res)
  }

  /** Validate a user-supplied directory: lexically inside the browse root, and still inside once symlinks resolve. */
  async function resolveBrowsable(input: string): Promise<string> {
    const raw = input.trim()
    if (!raw || raw.includes('\0')) throw new HttpError(400, '路徑無效')
    const expanded = raw === '~' || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(1)) : raw
    if (!path.isAbsolute(expanded)) throw new HttpError(400, '請輸入絕對路徑')
    const abs = path.resolve(expanded)
    const realRoot = await realpath(browseRoot)
    if (!inside(browseRoot, abs) && !inside(realRoot, abs)) throw new HttpError(403, `路徑不在可瀏覽的範圍內（${browseRoot}）`)
    let real: string
    try {
      real = await realpath(abs)
    } catch {
      throw new HttpError(404, `找不到路徑：${abs}`)
    }
    if (!inside(realRoot, real)) throw new HttpError(403, '路徑經由 symlink 跳出可瀏覽的範圍')
    if (!(await stat(real)).isDirectory()) throw new HttpError(400, `不是資料夾：${abs}`)
    return real
  }

  async function listDir(input: string | null) {
    const realRoot = await realpath(browseRoot)
    const dir = input ? await resolveBrowsable(input) : realRoot
    const entries: { name: string; path: string; project: boolean }[] = []
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || (!e.isDirectory() && !e.isSymbolicLink())) continue
      const abs = path.join(dir, e.name)
      // a symlinked entry is listed only when it resolves to a directory inside the root
      const real = await realpath(abs).catch(() => null)
      if (!real || !inside(realRoot, real) || !(await stat(real).then((x) => x.isDirectory(), () => false))) continue
      const marks = await Promise.all(['nodit.config.json', 'docs', '.git'].map((m) => stat(path.join(real, m)).then(() => true, () => false)))
      entries.push({ name: e.name, path: abs, project: marks.some(Boolean) })
      if (entries.length >= MAX_ENTRIES) break
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    return { root: realRoot, path: dir, parent: dir === realRoot ? null : path.dirname(dir), entries }
  }

  /**
   * Prepare the new project completely before touching the old one: validate → lock + scan →
   * pause old writes and wait → swap → release the old lock and watcher. Any failure up to the
   * swap leaves the old project exactly as it was.
   */
  async function switchProject(ctx: ProjectContext, req: IncomingMessage, res: ServerResponse) {
    const body = (await readBody(req)) as { path?: unknown }
    if (typeof body.path !== 'string') throw new HttpError(400, 'path is required')
    if (switching || ctx.closing) throw new HttpError(409, '另一個切換正在進行', { code: 'switch-busy' })
    const job = (async () => {
      const target = await resolveBrowsable(body.path as string)
      if (target === (await realpath(ctx.root))) return ctx
      const next = await openContext(target)
      try {
        await next.owner.setPort(port)
      } catch (err) {
        await closeContext(next)
        throw err
      }
      await drain(ctx)
      current = next
      ctx.hub.broadcast('project-switched', ctx.project.envelope({ to: next.project.envelope({ name: path.basename(target) }) }))
      await closeContext(ctx).catch((err) => console.error('[nodit] releasing the previous project failed:', err))
      await recordRecent(opts.recentFile, target)
      return next
    })()
    switching = job
    try {
      const next = await job
      return json(res, 200, { ...next.project.snapshot(), token: next.owner.token })
    } finally {
      switching = null
    }
  }

  async function api(ctx: ProjectContext, method: string, url: URL, req: IncomingMessage, res: ServerResponse) {
    const { root, project, owner, writer, plans } = ctx
    const p = url.pathname
    if (method === 'GET' && p === '/api/health') return json(res, 200, project.envelope({ ownerId: owner.info.ownerId, root }))
    if (method === 'GET' && p === '/api/fs/list') return json(res, 200, await listDir(url.searchParams.get('path')))
    if (method === 'GET' && p === '/api/projects/recent') {
      const items = await readRecent(opts.recentFile)
      return json(res, 200, { current: await realpath(root), browseRoot, items })
    }
    if (method === 'GET' && p === '/api/project') return json(res, 200, project.snapshot())
    if (method === 'GET' && p === '/api/events') return ctx.hub.attach(res)

    if (method === 'GET' && p === '/api/architecture') {
      const rel = project.config.paths.architecture
      const abs = await resolveInScope(root, rel, [rel])
      let buf: Buffer | null = null
      try {
        buf = await readFile(abs)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      return json(res, 200, project.envelope({ path: rel, revision: buf ? revisionOf(buf) : 'absent', markdown: buf ? buf.toString('utf8') : null }))
    }

    if (method === 'GET' && p === '/api/init/plan') {
      const ai = url.searchParams.get('ai') !== 'false'
      const plan = await planInit(scopedRead(root, initPaths(project.config)), project.config, project.configExists, ai)
      for (const [id, old] of plans) if (Date.now() - old.createdAt > PLAN_TTL) plans.delete(id)
      plans.set(plan.planId, plan)
      return json(res, 200, project.envelope(publicPlan(plan)))
    }

    if (method === 'POST' && p === '/api/init/apply') {
      const body = (await readBody(req)) as { planId?: unknown; itemIds?: unknown }
      const plan = typeof body.planId === 'string' ? plans.get(body.planId) : undefined
      if (!plan || Date.now() - plan.createdAt > PLAN_TTL) throw new HttpError(410, 'init plan expired; request a new one')
      if (!Array.isArray(body.itemIds) || !body.itemIds.every((x) => typeof x === 'string')) throw new HttpError(400, 'itemIds is required')
      try {
        const results = await applyInit(writer, plan, body.itemIds as string[])
        plans.delete(plan.planId)
        await project.rescan()
        return json(res, 200, project.envelope({ results }))
      } catch (err) {
        if (err instanceof ValidationError) return json(res, 422, project.envelope({ diagnostics: err.diagnostics }))
        throw err
      }
    }

    if (method === 'POST' && p === '/api/import') {
      const body = (await readBody(req, MAX_IMPORT_BODY)) as { text?: unknown }
      if (typeof body.text !== 'string') throw new HttpError(400, 'text is required')
      try {
        const report = await runImport(root, writer, project.config, project.configExists, body.text)
        return json(res, 200, project.envelope({ report }))
      } catch (err) {
        if (!(err instanceof ImportError)) throw err
        const status = err.code === 'invalid-input' || err.code === 'not-initialized' ? 422 : 409
        return json(res, status, project.envelope({ error: err.message, code: err.code, conflicts: err.conflicts }))
      } finally {
        await project.rescan()
      }
    }

    if (method === 'POST' && p === '/api/cards') {
      const body = (await readBody(req)) as Partial<NewCard>
      if (typeof body.type !== 'string' || typeof body.title !== 'string') throw new HttpError(400, 'type and title are required')
      return mutation(project, res, null, async () => {
        const created = await writer.createCard(body as NewCard)
        const doc = await project.applyWritten(created)
        return json(res, 201, project.envelope({ doc: toClientDoc(doc) }))
      })
    }

    if (method === 'PUT' && p === '/api/layout') {
      const body = (await readBody(req)) as { baseRevision?: unknown; data?: unknown }
      if (typeof body.baseRevision !== 'string' || !body.data || typeof body.data !== 'object') {
        throw new HttpError(400, 'baseRevision and data are required')
      }
      try {
        const layout = await writer.writeLayout(body.baseRevision, body.data as Record<string, { x: number; y: number }>)
        const rev = await project.applyLayout(layout)
        return json(res, 200, { ...project.envelope({ revision: layout.revision }), rev })
      } catch (err) {
        if (err instanceof ConflictError) {
          await project.rescan()
          return json(res, 409, project.envelope({ layout: project.snapshot().layout }))
        }
        throw err
      }
    }

    const rv = /^\/api\/reviews\/([a-f0-9]{12})$/.exec(p)
    if (rv) return patchReview(project, writer, rv[1], method, req, res)

    const m = /^\/api\/docs\/([a-f0-9]{12})(\/raw|\/links)?$/.exec(p)
    if (!m) throw new HttpError(404, 'not found')
    const doc = project.getDoc(m[1])
    if (!doc) throw new HttpError(404, 'unknown document')
    const sub = m[2] ?? ''

    if (method === 'GET' && sub === '/raw') {
      const abs = await resolveInScope(root, doc.path, CARD_KINDS.map((k) => project.config.paths[k]))
      const buf = await readFile(abs)
      return json(res, 200, project.envelope({ revision: revisionOf(buf), text: buf.toString('utf8') }))
    }

    const body = (await readBody(req)) as Record<string, unknown>
    if (typeof body.baseRevision !== 'string') throw new HttpError(400, 'baseRevision is required')
    const base = body.baseRevision

    if (method === 'DELETE' && sub === '') {
      return mutation(project, res, doc.docKey, async () => {
        await writer.deleteDoc(doc, base)
        await project.applyDeleted(doc.docKey)
        return json(res, 200, project.envelope({ deleted: doc.docKey }))
      })
    }

    if (method === 'PUT' && sub === '/raw') {
      if (typeof body.text !== 'string') throw new HttpError(400, 'text is required')
      return mutation(project, res, doc.docKey, () => written(project, res, writer.writeRaw(doc, base, body.text as string), doc.docKey))
    }

    if (!doc.writable) return json(res, 422, project.envelope({ diagnostics: doc.diagnostics.filter((d) => d.level === 'error') }))

    if (method === 'PATCH' && sub === '') {
      const patch: DocPatch = { fields: body.fields as FieldPatch | undefined, sections: body.sections as Record<string, string> | undefined }
      if (!patch.fields && !patch.sections) throw new HttpError(400, 'fields or sections are required')
      return mutation(project, res, doc.docKey, () => written(project, res, writer.updateDoc(doc, base, patch), doc.docKey))
    }

    if (method === 'PATCH' && sub === '/links') {
      const change = { add: body.add as LinkChange[] | undefined, remove: body.remove as LinkChange[] | undefined }
      return mutation(project, res, doc.docKey, () => written(project, res, writer.patchLinks(doc, base, change), doc.docKey))
    }

    throw new HttpError(405, 'method not allowed')
  }

  async function written(project: ProjectService, res: ServerResponse, job: Promise<{ doc: ParsedDoc; changed: boolean }>, docKey: string) {
    const result = await job
    const canonical = result.changed ? await project.applyWritten(result.doc) : (project.getDoc(docKey) ?? result.doc)
    return json(res, 200, project.envelope({ doc: toClientDoc(canonical) }))
  }

  /**
   * PATCH a review's status. Success and conflict both answer with the review as linked in the
   * snapshot; a 409 without `current` means the derived state is unavailable and the client refetches.
   */
  async function patchReview(project: ProjectService, writer: Writer, key: string, method: string, req: IncomingMessage, res: ServerResponse) {
    if (method !== 'PATCH') throw new HttpError(405, 'method not allowed')
    const review = project.getReview(key)
    if (!review) throw new HttpError(404, 'unknown review')
    const body = (await readBody(req)) as Record<string, unknown>
    if (typeof body.baseRevision !== 'string' || typeof body.status !== 'string') throw new HttpError(400, 'baseRevision and status are required')
    if (!review.writable) return json(res, 422, project.envelope({ diagnostics: review.diagnostics.filter((d) => d.level === 'error') }))
    try {
      const result = await writer.updateReviewStatus(review, body.baseRevision, body.status)
      const canonical = result.changed ? await project.applyReviewWritten(result.review) : project.getReview(key)
      return json(res, 200, project.envelope({ review: canonical ?? null }))
    } catch (err) {
      if (err instanceof ConflictError) {
        const fresh = await project.rescan().then(
          () => true,
          () => false,
        )
        return json(res, 409, project.envelope(fresh ? { current: project.getReview(key) ?? null } : {}))
      }
      if (err instanceof ValidationError) return json(res, 422, project.envelope({ diagnostics: err.diagnostics }))
      throw err
    }
  }

  /** Shared error mapping for every write: 409 with the current doc, 422 with diagnostics. */
  async function mutation(project: ProjectService, res: ServerResponse, docKey: string | null, run: () => Promise<void>) {
    try {
      await run()
    } catch (err) {
      if (err instanceof ConflictError) {
        await project.rescan()
        const current = docKey ? project.getDoc(docKey) : undefined
        return json(res, 409, project.envelope({ current: current ? toClientDoc(current) : null }))
      }
      if (err instanceof ValidationError) return json(res, 422, project.envelope({ diagnostics: err.diagnostics }))
      throw err
    }
  }

  async function serveStatic(ctx: ProjectContext, pathname: string, res: ServerResponse) {
    if (!opts.distDir) throw new HttpError(404, 'not found')
    const rel = path.posix.normalize(decodeURIComponent(pathname)).replace(/^\/+/, '')
    if (rel.startsWith('..')) throw new HttpError(404, 'not found')
    const file = path.join(opts.distDir, rel || 'index.html')
    let buf: Buffer
    let target = file
    try {
      buf = await readFile(file)
    } catch {
      target = path.join(opts.distDir, 'index.html')
      buf = await readFile(target)
    }
    if (target.endsWith('index.html')) {
      const html = buf.toString('utf8').replace('</head>', `<meta name="nodit-token" content="${ctx.owner.token}" />\n</head>`)
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP })
      return res.end(html)
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream' })
    res.end(buf)
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.end()
      if (err instanceof HttpError) return json(res, err.status, { error: err.message, ...(err.body as object | undefined) })
      if (err instanceof LockBusyError) return json(res, 409, { error: err.message, code: 'busy' })
      if (err instanceof CompromisedError) return json(res, 503, { error: err.message, code: 'compromised' })
      if (err instanceof ScopeError) return json(res, 403, { error: err.message })
      if (err instanceof ValidationError) return json(res, 422, { diagnostics: err.diagnostics })
      console.error(err)
      json(res, 500, { error: 'internal error' })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, '127.0.0.1', () => resolve())
  })
  port = (server.address() as { port: number }).port
  await current.owner.setPort(port)
  await recordRecent(opts.recentFile, await realpath(current.root))

  return {
    server,
    port,
    get owner() {
      return current.owner
    },
    get project() {
      return current.project
    },
    close: async () => {
      await switching?.catch(() => {})
      current.hub.close()
      await new Promise<void>((r) => server.close(() => r()))
      await current.project.stop()
      await current.owner.release()
    },
  }
}
