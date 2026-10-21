import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { acquireOwner, CompromisedError, type Owner } from '../core/owner'
import { CARD_KINDS } from '../core/domain'
import { applyInit, initPaths, planInit, publicPlan, scopedRead, type InitPlan } from '../core/init'
import { revisionOf, toClientDoc, type ParsedDoc } from '../core/parse'
import type { FieldPatch } from '../core/protocol'
import { resolveInScope, ScopeError } from '../core/scope'
import { ConflictError, ValidationError, Writer, type DocPatch, type LinkChange, type NewCard } from '../core/writer'
import { EventHub } from './events'
import { ProjectService } from './project'

export type ServerOptions = {
  root: string
  port: number
  devOrigins?: string[]
  distDir?: string
}

export type RunningServer = {
  server: Server
  port: number
  owner: Owner
  project: ProjectService
  close: () => Promise<void>
}

const MAX_BODY = 1024 * 1024
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

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'request body too large')
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new HttpError(400, 'invalid JSON')
  }
}

function sameToken(a: string | undefined, b: string) {
  if (!a) return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function start(opts: ServerOptions): Promise<RunningServer> {
  const root = path.resolve(opts.root)
  const project = new ProjectService(root)
  const owner = await acquireOwner(root, 'server', project.sessionId)
  try {
    await project.start()
  } catch (err) {
    await owner.release()
    throw err
  }
  const writer = new Writer(root, () => project.config, owner)
  const hub = new EventHub(project)
  const plans = new Map<string, InitPlan>()
  owner.onCompromised((err) => hub.broadcast('writer-compromised', project.envelope({ message: err.message })))

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
      if (method !== 'GET') {
        if (!origin) throw new HttpError(403, 'origin required for writes')
        const token = req.headers['x-nodit-token']
        if (!sameToken(Array.isArray(token) ? token[0] : token, owner.token)) throw new HttpError(401, 'invalid token')
      }
      return api(method, url, req, res)
    }
    if (method !== 'GET') throw new HttpError(405, 'method not allowed')
    return serveStatic(url.pathname, res)
  }

  async function api(method: string, url: URL, req: IncomingMessage, res: ServerResponse) {
    const p = url.pathname
    if (method === 'GET' && p === '/api/health') return json(res, 200, project.envelope({ ownerId: owner.info.ownerId }))
    if (method === 'GET' && p === '/api/project') return json(res, 200, project.snapshot())
    if (method === 'GET' && p === '/api/events') return hub.attach(res)

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

    if (method === 'POST' && p === '/api/cards') {
      const body = (await readBody(req)) as Partial<NewCard>
      if (typeof body.type !== 'string' || typeof body.title !== 'string') throw new HttpError(400, 'type and title are required')
      return mutation(res, null, async () => {
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
        await project.applyLayout(layout)
        return json(res, 200, project.envelope({ revision: layout.revision }))
      } catch (err) {
        if (err instanceof ConflictError) {
          await project.rescan()
          return json(res, 409, project.envelope({ layout: project.snapshot().layout }))
        }
        throw err
      }
    }

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
      return mutation(res, doc.docKey, async () => {
        await writer.deleteDoc(doc, base)
        await project.applyDeleted(doc.docKey)
        return json(res, 200, project.envelope({ deleted: doc.docKey }))
      })
    }

    if (method === 'PUT' && sub === '/raw') {
      if (typeof body.text !== 'string') throw new HttpError(400, 'text is required')
      return mutation(res, doc.docKey, () => written(res, writer.writeRaw(doc, base, body.text as string), doc.docKey))
    }

    if (!doc.writable) return json(res, 422, project.envelope({ diagnostics: doc.diagnostics.filter((d) => d.level === 'error') }))

    if (method === 'PATCH' && sub === '') {
      const patch: DocPatch = { fields: body.fields as FieldPatch | undefined, sections: body.sections as Record<string, string> | undefined }
      if (!patch.fields && !patch.sections) throw new HttpError(400, 'fields or sections are required')
      return mutation(res, doc.docKey, () => written(res, writer.updateDoc(doc, base, patch), doc.docKey))
    }

    if (method === 'PATCH' && sub === '/links') {
      const change = { add: body.add as LinkChange[] | undefined, remove: body.remove as LinkChange[] | undefined }
      return mutation(res, doc.docKey, () => written(res, writer.patchLinks(doc, base, change), doc.docKey))
    }

    throw new HttpError(405, 'method not allowed')
  }

  async function written(res: ServerResponse, job: Promise<{ doc: ParsedDoc; changed: boolean }>, docKey: string) {
    const result = await job
    const canonical = result.changed ? await project.applyWritten(result.doc) : (project.getDoc(docKey) ?? result.doc)
    return json(res, 200, project.envelope({ doc: toClientDoc(canonical) }))
  }

  /** Shared error mapping for every write: 409 with the current doc, 422 with diagnostics. */
  async function mutation(res: ServerResponse, docKey: string | null, run: () => Promise<void>) {
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

  async function serveStatic(pathname: string, res: ServerResponse) {
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
      const html = buf.toString('utf8').replace('</head>', `<meta name="nodit-token" content="${owner.token}" />\n</head>`)
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
      return res.end(html)
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream' })
    res.end(buf)
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.end()
      if (err instanceof HttpError) return json(res, err.status, { error: err.message })
      if (err instanceof CompromisedError) return json(res, 503, { error: err.message, code: 'compromised' })
      if (err instanceof ScopeError) return json(res, 403, { error: err.message })
      console.error(err)
      json(res, 500, { error: 'internal error' })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, '127.0.0.1', () => resolve())
  })
  port = (server.address() as { port: number }).port
  await owner.setPort(port)

  return {
    server,
    port,
    owner,
    project,
    close: async () => {
      hub.close()
      await new Promise<void>((r) => server.close(() => r()))
      await project.stop()
      await owner.release()
    },
  }
}
