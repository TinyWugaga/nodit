import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection as FlowConnection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { inferLinkKind, LINK_SCHEMA, shouldReverse, type CardKind, type LinkKind } from '../core/domain'
import type { ClientDoc, Diagnostic, Envelope, MutationResult, ProjectPayload } from '../core/protocol'
import type { LinkChange, Meta } from './data/client'
import { DraftManager, type DraftView } from './data/drafts'
import { HttpProjectClient, SECTION_PREFIX } from './data/httpClient'
import { ProjectSync } from './data/sync'
import { KIND_META, LINK_META } from './presentation'
import type { CardData, CardNode, LinkEdge } from './types'

export const LEGACY_STORAGE_KEY = 'nodit:project'

type Connection = 'connecting' | 'open' | 'closed'

type State = {
  theme: 'light' | 'dark'
  tool: 'select' | 'hand'
  query: string
  setTheme: (theme: 'light' | 'dark') => void
  setTool: (tool: 'select' | 'hand') => void
  setQuery: (query: string) => void

  connection: Connection
  loadError?: string
  compromised?: string
  toast?: { message: string; level: 'info' | 'error' }
  meta: Meta | null
  projectName: string
  initialized: boolean
  docs: ClientDoc[]
  projectDiagnostics: Diagnostic[]
  layout: Record<string, XYPosition>
  layoutRevision: string

  nodes: CardNode[]
  edges: LinkEdge[]
  onNodesChange: (changes: NodeChange<CardNode>[]) => void
  onEdgesChange: (changes: EdgeChange<LinkEdge>[]) => void
  onConnect: (c: FlowConnection) => void
  onNodeDragStop: () => void
  select: (id: string | null) => void

  /** `immediate` skips the debounce for discrete inputs (selects, dates, buttons) */
  editField: (docKey: string, field: string, value: string | null, immediate?: boolean) => void
  retryDraft: (docKey: string) => void
  discardDraft: (docKey: string) => void
  reapplyDraft: (docKey: string) => void
  draftOf: (docKey: string) => DraftView | undefined

  addLink: (sourceDocKey: string, rel: LinkKind, targetId: string) => Promise<boolean>
  removeEdge: (edgeId: string) => Promise<void>
  changeEdgeKind: (edgeId: string, kind: LinkKind) => Promise<void>
  reverseEdge: (edgeId: string) => Promise<void>
  createCard: (kind: CardKind, position: XYPosition, linkFrom?: string) => Promise<string | null>
  referencesTo: (docKey: string) => { docKey: string; code: string; title: string; changes: LinkChange[] }[]
  deleteCard: (docKey: string, clearReferences: boolean) => Promise<boolean>

  rawDocKey: string | null
  openRaw: (docKey: string) => void
  closeRaw: () => void
  saveRaw: (docKey: string, baseRevision: string, text: string) => Promise<MutationResult>

  deleteRequest: string | null
  requestDelete: (docKey: string | null) => void

  initOpen: boolean
  setInitOpen: (open: boolean) => void

  importLegacy: (text: string) => Promise<void>

  view: 'graph' | 'architecture'
  setView: (view: 'graph' | 'architecture') => void
  architecture: { path: string; revision: string }
  /** docKey to focus once the canvas is mounted (e.g. after clicking a card ref on the architecture page) */
  pendingFocus: string | null
  focusCard: (id: string) => void
  clearPendingFocus: () => void
}

const client = new HttpProjectClient()

const COLUMN_X: Record<CardKind, number> = { adr: 0, milestone: 460, task: 920 }

function sectionView(doc: ClientDoc, draft: DraftView | undefined, name: string) {
  const key = SECTION_PREFIX + name
  if (draft && key in draft.values) return draft.values[key] ?? ''
  const s = doc.sections[name]
  return s?.state === 'ok' ? s.text : ''
}

function toCardData(doc: ClientDoc, draft: DraftView | undefined): CardData | null {
  const c = doc.card
  if (!c) return null
  const v = draft?.values ?? {}
  const pick = (key: string, fallback: string | undefined) => (key in v ? (v[key] ?? '') : (fallback ?? ''))
  const base = {
    code: c.id,
    title: pick('title', c.title),
    docKey: doc.docKey,
    path: doc.path,
    revision: doc.revision,
    writable: doc.writable,
    legacy: doc.legacy,
    inferred: doc.inferred,
    diagnostics: doc.diagnostics,
    sectionStates: Object.fromEntries(Object.entries(doc.sections).map(([k, s]) => [k, s.state])),
    draft,
  }
  const sec = (name: string) => sectionView(doc, draft, name)
  if (c.type === 'adr') {
    return {
      ...base,
      kind: 'adr',
      status: pick('status', c.status) as never,
      date: pick('date', c.date),
      context: sec('Context'),
      decision: sec('Decision'),
      consequences: sec('Consequences'),
    }
  }
  if (c.type === 'milestone') {
    return { ...base, kind: 'milestone', status: pick('status', c.status) as never, dueDate: pick('due', c.due), goal: sec('Goal') }
  }
  return {
    ...base,
    kind: 'task',
    status: pick('status', c.status) as never,
    priority: (pick('priority', c.priority) || 'medium') as never,
    assignee: pick('assignee', c.assignee),
    description: sec('Description'),
  }
}

function pickHandles(a: XYPosition, b: XYPosition) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy) * 0.6) return dx >= 0 ? { sourceHandle: 'r', targetHandle: 'l' } : { sourceHandle: 'l', targetHandle: 'r' }
  return dy >= 0 ? { sourceHandle: 'b', targetHandle: 't' } : { sourceHandle: 't', targetHandle: 'b' }
}

/**
 * Position precedence: a local move not yet saved, then the canonical layout file, then where the
 * node already sits, then an automatic column slot.
 */
function buildNodes(
  prev: CardNode[],
  docs: ClientDoc[],
  layout: Record<string, XYPosition>,
  pending: Record<string, XYPosition>,
  drafts: DraftManager,
): CardNode[] {
  const prevById = new Map(prev.map((n) => [n.id, n]))
  const column: Record<CardKind, number> = { adr: 0, milestone: 0, task: 0 }
  const out: CardNode[] = []
  for (const doc of docs) {
    const data = toCardData(doc, drafts.view(doc.docKey))
    if (!data) continue
    const old = prevById.get(doc.docKey)
    const slot = column[data.kind]++
    const position = pending[data.code] ?? layout[data.code] ?? old?.position ?? { x: COLUMN_X[data.kind], y: slot * 210 }
    out.push({ ...(old ?? {}), id: doc.docKey, type: 'card', position, data })
  }
  return out
}

function buildEdges(prev: LinkEdge[], docs: ClientDoc[], nodes: CardNode[]): LinkEdge[] {
  const nodeById = new Map<string, CardNode>()
  for (const n of nodes) if (!nodeById.has(n.data.code)) nodeById.set(n.data.code, n)
  const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id))
  const byKey = new Map<string, LinkEdge>()
  const add = (src: CardNode, revision: string, targetId: string, kind: LinkKind) => {
    const tgt = nodeById.get(targetId)
    if (!tgt || tgt.id === src.id) return
    const key = kind === 'relates' ? `relates:${[src.data.code, targetId].sort().join('~')}` : `${src.data.code}:${kind}:${targetId}`
    const existing = byKey.get(key)
    if (existing) {
      existing.data!.storedAt.push({ docKey: src.id, revision, to: targetId })
      return
    }
    const id = kind === 'relates' ? key : `${src.data.code}:${kind}:${targetId}`
    byKey.set(key, {
      id,
      type: 'link',
      source: src.id,
      target: tgt.id,
      data: { kind, storedAt: [{ docKey: src.id, revision, to: targetId }] },
      selected: selected.has(id),
      ...pickHandles(src.position, tgt.position),
    })
  }
  for (const doc of docs) {
    const c = doc.card
    const src = c && nodeById.get(c.id)
    if (!c || !src || src.id !== doc.docKey) continue
    const r = doc.revision
    c.links.implements.forEach((t) => add(src, r, t, 'implements'))
    if (c.links.milestone) add(src, r, c.links.milestone, 'part-of')
    c.links.depends.forEach((t) => add(src, r, t, 'depends'))
    c.links.supersedes.forEach((t) => add(src, r, t, 'supersedes'))
    c.links.relates.forEach((t) => add(src, r, t, 'relates'))
  }
  return [...byKey.values()]
}

function canHold(kind: CardKind, rel: LinkKind) {
  return Boolean(LINK_SCHEMA[kind][rel])
}

export const useProject = create<State>()(
  persist(
    (set, get) => {
      /** positions moved locally (keyed by card id) that the layout file does not hold yet */
      const pendingLayout: Record<string, XYPosition> = {}

      const rebuild = () => {
        const { docs, layout, nodes, edges } = get()
        const nextNodes = buildNodes(nodes, docs, layout, pendingLayout, drafts)
        set({ nodes: nextNodes, edges: buildEdges(edges, docs, nextNodes) })
      }

      const toast = (message: string, level: 'info' | 'error' = 'error') => {
        set({ toast: { message, level } })
        setTimeout(() => {
          if (get().toast?.message === message) set({ toast: undefined })
        }, 4000)
      }

      /** Fold a canonical doc from a mutation response in, unless a newer snapshot already covers it. */
      const acceptDoc = (env: Envelope<{ doc: ClientDoc }>) => {
        const meta = get().meta
        if (!meta || env.sessionId !== meta.sessionId || env.rev <= meta.rev) return
        const docs = get().docs
        const exists = docs.some((d) => d.docKey === env.doc.docKey)
        set({ docs: exists ? docs.map((d) => (d.docKey === env.doc.docKey ? env.doc : d)) : [...docs, env.doc] })
      }

      const drafts = new DraftManager(
        (docKey, base, patch) => client.patchDoc(docKey, base, patch),
        (_docKey, result) => acceptDoc(result.envelope),
      )
      drafts.subscribe(rebuild)

      const apply = (snap: Envelope<ProjectPayload>) => {
        for (const d of snap.docs) drafts.markDiskChanged(d.docKey, d.revision)
        set({
          meta: { projectId: snap.projectId, sessionId: snap.sessionId, rev: snap.rev },
          projectName: snap.name,
          initialized: snap.initialized,
          docs: snap.docs,
          projectDiagnostics: snap.diagnostics,
          layout: snap.layout.data,
          layoutRevision: snap.layout.revision,
          architecture: snap.architecture,
          loadError: undefined,
        })
        rebuild()
      }

      const sync = new ProjectSync(client, {
        apply,
        connection: (connection) => set({ connection }),
        compromised: (compromised) => set({ compromised }),
        error: (err) => set({ loadError: err instanceof Error ? err.message : String(err) }),
      })
      queueMicrotask(() => sync.start())

      const docByKey = (docKey: string) => get().docs.find((d) => d.docKey === docKey)

      /**
       * Discrete (non-draft) link write on one document, with the draft following our own revision.
       * `base` defaults to the loaded revision; edge removal passes the revision the edge was read at.
       */
      const linkWrite = async (docKey: string, change: { add?: LinkChange[]; remove?: LinkChange[] }, base?: string) => {
        const doc = docByKey(docKey)
        if (!doc) return false
        if (!doc.writable) {
          toast(`${doc.card?.id ?? doc.path} 目前不可寫入`)
          return false
        }
        const baseRevision = base ?? doc.revision
        const result = await client.patchLinks(docKey, baseRevision, change)
        if (result.ok) {
          drafts.rebaseOwn(docKey, baseRevision, result.envelope.doc.revision)
          acceptDoc(result.envelope)
          rebuild()
          return true
        }
        if (result.reason === 'conflict') {
          toast(`${doc.card?.id} 剛被修改，連線沒有寫入；已重新載入，請再試一次`)
          void sync.fetch()
        } else toast(result.reason === 'invalid' ? result.diagnostics.map((d) => d.message).join('；') : result.message)
        return false
      }

      let layoutTimer: ReturnType<typeof setTimeout> | undefined
      const saveLayout = async (retry = true): Promise<void> => {
        const placed: Record<string, XYPosition> = {}
        for (const n of get().nodes) placed[n.data.code] = n.position
        // only local moves override the file; everything else keeps the newest canonical value
        const pending = { ...pendingLayout }
        const data = { ...placed, ...get().layout, ...pending }
        const result = await client.putLayout(get().layoutRevision, data)
        // a response older than the loaded snapshot must not roll the layout back
        const fresh = (meta: Meta) => {
          const current = get().meta
          return !current || (meta.sessionId === current.sessionId && meta.rev > current.rev)
        }
        if (result.ok) {
          for (const [code, p] of Object.entries(pending)) if (pendingLayout[code] === p) delete pendingLayout[code]
          if (fresh(result.meta)) set({ layout: data, layoutRevision: result.revision })
          // nodes drawn from the cleared overlay now fall back to the canonical layout
          rebuild()
          return
        }
        if (result.reason === 'conflict' && 'layout' in result && retry) {
          // positions only: take the newer file and re-apply our current positions on top
          if (fresh(result.meta)) set({ layout: result.layout.data, layoutRevision: result.layout.revision })
          return saveLayout(false)
        }
        toast(`版面座標沒有存檔：${'message' in result ? result.message : '衝突'}`)
      }

      return {
        theme: 'dark',
        tool: 'select',
        query: '',
        setTheme: (theme) => set({ theme }),
        setTool: (tool) => set({ tool }),
        setQuery: (query) => set({ query }),

        connection: 'connecting',
        meta: null,
        projectName: '',
        initialized: true,
        docs: [],
        projectDiagnostics: [],
        layout: {},
        layoutRevision: 'absent',

        nodes: [],
        edges: [],
        onNodesChange: (changes) => {
          const nodes = applyNodeChanges(
            changes.filter((c) => c.type !== 'remove' && c.type !== 'add'),
            get().nodes,
          )
          for (const c of changes) {
            if (c.type !== 'position' || !c.position) continue
            const code = nodes.find((n) => n.id === c.id)?.data.code
            if (code) pendingLayout[code] = nodes.find((n) => n.id === c.id)!.position
          }
          const moved = changes.some((c) => c.type === 'position')
          set({ nodes, edges: moved ? buildEdges(get().edges, get().docs, nodes) : get().edges })
        },
        onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes.filter((c) => c.type === 'select'), get().edges) }),
        onConnect: (c) => {
          let src = get().nodes.find((n) => n.id === c.source)
          let tgt = get().nodes.find((n) => n.id === c.target)
          if (!src || !tgt || src.id === tgt.id) return
          if (shouldReverse(src.data.kind, tgt.data.kind)) [src, tgt] = [tgt, src]
          const rel = inferLinkKind(src.data.kind, tgt.data.kind)
          void get().addLink(src.id, rel, tgt.data.code)
        },
        onNodeDragStop: () => {
          clearTimeout(layoutTimer)
          layoutTimer = setTimeout(() => void saveLayout(), 300)
        },
        select: (id) =>
          set({
            nodes: get().nodes.map((n) => ({ ...n, selected: n.id === id })),
            edges: get().edges.map((e) => ({ ...e, selected: e.id === id })),
          }),

        editField: (docKey, field, value, immediate) => {
          const doc = docByKey(docKey)
          if (!doc?.writable) return
          drafts.edit(docKey, drafts.baseOf(docKey) ?? doc.revision, field, value)
          if (immediate) void drafts.flush(docKey)
        },
        retryDraft: (docKey) => drafts.retry(docKey),
        discardDraft: (docKey) => drafts.discard(docKey),
        reapplyDraft: (docKey) => {
          const current = drafts.view(docKey)?.current ?? docByKey(docKey)
          if (current) drafts.reapply(docKey, current.revision)
        },
        draftOf: (docKey) => drafts.view(docKey),

        addLink: async (sourceDocKey, rel, targetId) => {
          const src = docByKey(sourceDocKey)
          if (!src?.card) return false
          if (!canHold(src.card.type, rel)) {
            toast(`${KIND_META[src.card.type].label} 不能有「${LINK_META[rel].label}」關聯`)
            return false
          }
          return linkWrite(sourceDocKey, { add: [{ rel, to: targetId }] })
        },

        removeEdge: async (edgeId) => {
          const edge = get().edges.find((e) => e.id === edgeId)
          if (!edge?.data) return
          // each stored copy is checked against its own revision; not a transaction, so report per file
          const failed: string[] = []
          for (const s of edge.data.storedAt) {
            if (!(await linkWrite(s.docKey, { remove: [{ rel: edge.data.kind, to: s.to }] }, s.revision))) {
              failed.push(docByKey(s.docKey)?.path ?? s.docKey)
            }
          }
          if (failed.length && failed.length < edge.data.storedAt.length) {
            toast(`連線只移除了一部分：${failed.join('、')} 沒有寫入，該端的紀錄仍保留`)
          }
        },

        changeEdgeKind: async (edgeId, kind) => {
          const edge = get().edges.find((e) => e.id === edgeId)
          if (!edge?.data || edge.data.kind === kind) return
          const src = docByKey(edge.source)
          const target = get().nodes.find((n) => n.id === edge.target)
          if (!src?.card || !target) return
          if (!canHold(src.card.type, kind)) {
            toast(`${KIND_META[src.card.type].label} 不能有「${LINK_META[kind].label}」關聯`)
            return
          }
          const own = edge.data.storedAt.filter((s) => s.docKey === edge.source)
          const others = edge.data.storedAt.filter((s) => s.docKey !== edge.source)
          const ok = await linkWrite(edge.source, {
            remove: own.map((s) => ({ rel: edge.data!.kind, to: s.to })),
            add: [{ rel: kind, to: target.data.code }],
          })
          if (!ok) return
          for (const s of others) await linkWrite(s.docKey, { remove: [{ rel: edge.data.kind, to: s.to }] }, s.revision)
        },

        reverseEdge: async (edgeId) => {
          const edge = get().edges.find((e) => e.id === edgeId)
          if (!edge?.data) return
          const tgt = docByKey(edge.target)
          const src = get().nodes.find((n) => n.id === edge.source)
          if (!tgt?.card || !src) return
          if (!canHold(tgt.card.type, edge.data.kind)) {
            toast(`反轉後 ${KIND_META[tgt.card.type].label} 不能有「${LINK_META[edge.data.kind].label}」關聯`)
            return
          }
          if (!(await linkWrite(edge.target, { add: [{ rel: edge.data.kind, to: src.data.code }] }))) return
          for (const s of edge.data.storedAt.filter((x) => x.docKey !== edge.target)) {
            await linkWrite(s.docKey, { remove: [{ rel: edge.data.kind, to: s.to }] }, s.revision)
          }
        },

        createCard: async (kind, position, linkFrom) => {
          const from = linkFrom ? docByKey(linkFrom) : undefined
          const links: LinkChange[] = []
          let backLink: { rel: LinkKind } | null = null
          if (from?.card) {
            if (shouldReverse(from.card.type, kind)) links.push({ rel: inferLinkKind(kind, from.card.type), to: from.card.id })
            else backLink = { rel: inferLinkKind(from.card.type, kind) }
          }
          const result = await client.createCard({ type: kind, title: `未命名 ${KIND_META[kind].label}`, links })
          if (!result.ok) {
            toast(result.message)
            return null
          }
          const doc = result.envelope.doc
          set({ layout: { ...get().layout, [doc.card!.id]: position } })
          acceptDoc(result.envelope)
          rebuild()
          set({ nodes: get().nodes.map((n) => (n.id === doc.docKey ? { ...n, position } : n)) })
          if (backLink && from) await get().addLink(from.docKey, backLink.rel, doc.card!.id)
          void saveLayout()
          get().select(doc.docKey)
          return doc.docKey
        },

        referencesTo: (docKey) => {
          const target = docByKey(docKey)?.card
          if (!target) return []
          const out: { docKey: string; code: string; title: string; changes: LinkChange[] }[] = []
          for (const d of get().docs) {
            const c = d.card
            if (!c || d.docKey === docKey) continue
            const changes: LinkChange[] = []
            if (c.links.implements.includes(target.id)) changes.push({ rel: 'implements', to: target.id })
            if (c.links.depends.includes(target.id)) changes.push({ rel: 'depends', to: target.id })
            if (c.links.supersedes.includes(target.id)) changes.push({ rel: 'supersedes', to: target.id })
            if (c.links.relates.includes(target.id)) changes.push({ rel: 'relates', to: target.id })
            if (c.links.milestone === target.id) changes.push({ rel: 'part-of', to: target.id })
            if (changes.length) out.push({ docKey: d.docKey, code: c.id, title: c.title, changes })
          }
          return out
        },

        deleteCard: async (docKey, clearReferences) => {
          const doc = docByKey(docKey)
          if (!doc) return false
          const refs = clearReferences ? get().referencesTo(docKey) : []
          drafts.discard(docKey)
          const result = await client.deleteDoc(docKey, doc.revision)
          if (!result.ok) {
            toast(result.reason === 'conflict' ? '檔案剛被修改，沒有刪除；請確認內容後再試' : result.message)
            if (result.reason === 'conflict') void sync.fetch()
            return false
          }
          set({ docs: get().docs.filter((d) => d.docKey !== docKey), deleteRequest: null })
          rebuild()
          let failed = 0
          for (const r of refs) if (!(await linkWrite(r.docKey, { remove: r.changes }))) failed++
          if (failed) toast(`已刪除，但有 ${failed} 份文件的引用沒有清除`)
          return true
        },

        rawDocKey: null,
        openRaw: (rawDocKey) => set({ rawDocKey }),
        closeRaw: () => set({ rawDocKey: null }),
        saveRaw: async (docKey, baseRevision, text) => {
          const result = await client.putRaw(docKey, baseRevision, text)
          if (result.ok) {
            drafts.discard(docKey)
            acceptDoc(result.envelope)
            rebuild()
          }
          return result
        },

        deleteRequest: null,
        requestDelete: (deleteRequest) => set({ deleteRequest }),

        view: 'graph',
        setView: (view) => set({ view }),
        architecture: { path: 'docs/ARCHITECTURE.md', revision: 'absent' },
        pendingFocus: null,
        focusCard: (id) => {
          const doc = get().docs.find((d) => d.card?.id === id)
          if (!doc) return
          get().select(doc.docKey)
          set({ view: 'graph', pendingFocus: doc.docKey })
        },
        clearPendingFocus: () => set({ pendingFocus: null }),

        initOpen: false,
        setInitOpen: (initOpen) => {
          set({ initOpen })
          if (!initOpen) void sync.fetch()
        },

        importLegacy: async (text) => {
          const result = await client.importLegacy(text)
          if (result.ok) {
            const r = result.report
            toast(
              r.status === 'already-complete'
                ? `這份檔案已經匯入完成（${r.total} 張卡片）`
                : `已匯入 ${r.created.length + r.adopted.length} / ${r.total} 張卡片${r.warnings.length ? `，${r.warnings.length} 則提醒見 ${r.jobPath}` : ''}`,
              'info',
            )
            void sync.fetch()
            return
          }
          const detail = result.conflicts?.length ? `：${result.conflicts.map((c) => c.id || c.path).join('、')}` : ''
          toast(`匯入失敗，${result.message}${detail}`)
        },
      }
    },
    {
      name: 'nodit:ui',
      version: 1,
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
)

export { client }
