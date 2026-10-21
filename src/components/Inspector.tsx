import { AlertTriangle, ArrowLeftRight, ArrowRight, Crosshair, FileCode2, Link2, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { inferLinkKind, LINK_SCHEMA, shouldReverse, type LinkKind } from '../../core/domain'
import type { DraftView } from '../data/drafts'
import { SECTION_PREFIX } from '../data/httpClient'
import { CARD_W, useAddCard, useFocusNode } from '../hooks'
import { useMilestoneProgress } from '../nodes/CardNodeView'
import { KIND_META, LINK_META, PRIORITY_LABEL, STATUS_LABEL } from '../presentation'
import { useProject } from '../store'
import type { CardData, CardKind, CardNode, LinkEdge } from '../types'
import { Rule } from './Frame'
import { KindIcon } from './KindIcon'

function Section({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="ins-section">
      <div className="ins-section__head">
        <h4 className="label-caps">{label}</h4>
        <Rule />
        {aside}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label-caps">{label}</span>
      {children}
    </label>
  )
}

function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: Record<T, string>
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {(Object.keys(options) as T[]).map((k) => (
        <option key={k} value={k}>
          {options[k]}
        </option>
      ))}
    </select>
  )
}

function SectionText({ d, name, label, value, placeholder }: { d: CardData; name: string; label: string; value: string; placeholder: string }) {
  const { editField, openRaw } = useProject(useShallow((s) => ({ editField: s.editField, openRaw: s.openRaw })))
  const state = d.sectionStates[name] ?? 'missing'
  const duplicate = state === 'duplicate'
  return (
    <Section
      label={label}
      aside={
        duplicate ? (
          <button type="button" className="text-btn mono" onClick={() => openRaw(d.docKey)}>
            raw
          </button>
        ) : state === 'missing' && d.writable ? (
          <span className="mono muted">new</span>
        ) : null
      }
    >
      <textarea
        className="input input--area"
        rows={3}
        value={value}
        readOnly={!d.writable || duplicate}
        placeholder={duplicate ? `## ${name} 出現多次，請用 raw 編輯修正` : placeholder}
        onChange={(e) => editField(d.docKey, SECTION_PREFIX + name, e.target.value)}
      />
    </Section>
  )
}

function MilestoneMetrics({ id }: { id: string }) {
  const { total, done, blocked, pct } = useMilestoneProgress(id)
  return (
    <div className="metrics">
      <div>
        <b className="mono">{total}</b>
        <span className="label-caps">Tasks</span>
      </div>
      <div className="is-accent">
        <b className="mono">{pct}%</b>
        <span className="label-caps">{done} Done</span>
      </div>
      <div>
        <b className="mono">{blocked}</b>
        <span className="label-caps">Blocked</span>
      </div>
    </div>
  )
}

function CardFields({ node }: { node: CardNode }) {
  const editField = useProject((s) => s.editField)
  const d = node.data
  const ro = !d.writable
  const set = (field: string) => (value: string) => editField(d.docKey, field, value, true)
  const type = (field: string) => (value: string) => editField(d.docKey, field, value)

  if (d.kind === 'adr')
    return (
      <>
        <div className="field-row">
          <Field label="Status">
            <Select value={d.status} options={STATUS_LABEL.adr} onChange={set('status')} disabled={ro} />
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={d.date} disabled={ro} onChange={(e) => set('date')(e.target.value)} />
          </Field>
        </div>
        <SectionText d={d} name="Context" label="Context & Statement" value={d.context} placeholder="為什麼需要做這個決定？有哪些限制？" />
        <SectionText d={d} name="Decision" label="Decision" value={d.decision} placeholder="我們決定…" />
        <SectionText d={d} name="Consequences" label="Consequences" value={d.consequences} placeholder="代價、風險、後續工作" />
      </>
    )

  if (d.kind === 'milestone')
    return (
      <>
        <div className="field-row">
          <Field label="Status">
            <Select value={d.status} options={STATUS_LABEL.milestone} onChange={set('status')} disabled={ro} />
          </Field>
          <Field label="Due">
            <input className="input" type="date" value={d.dueDate} disabled={ro} onChange={(e) => set('due')(e.target.value)} />
          </Field>
        </div>
        <Section label="Progress">
          <MilestoneMetrics id={node.id} />
        </Section>
        <SectionText d={d} name="Goal" label="Goal · 完成條件" value={d.goal} placeholder="這個里程碑交付什麼？" />
      </>
    )

  return (
    <>
      <div className="field-row">
        <Field label="Status">
          <Select value={d.status} options={STATUS_LABEL.task} onChange={set('status')} disabled={ro} />
        </Field>
        <Field label="Priority">
          <Select value={d.priority} options={PRIORITY_LABEL} onChange={set('priority')} disabled={ro} />
        </Field>
      </div>
      <Field label="Assignee">
        <input className="input" value={d.assignee} placeholder="負責人" disabled={ro} onChange={(e) => type('assignee')(e.target.value)} />
      </Field>
      <SectionText d={d} name="Description" label="Description" value={d.description} placeholder="要做什麼、怎樣算完成" />
    </>
  )
}

/** Resolve where a link between `self` and `other` is stored and which relation it gets. */
function planLink(self: CardNode, other: CardNode): { source: CardNode; target: CardNode; rel: LinkKind; ok: boolean } {
  const [source, target] = shouldReverse(self.data.kind, other.data.kind) ? [other, self] : [self, other]
  const rel = inferLinkKind(source.data.kind, target.data.kind)
  return { source, target, rel, ok: Boolean(LINK_SCHEMA[source.data.kind][rel]) }
}

function Connections({ node }: { node: CardNode }) {
  const { nodes, edges, addLink, removeEdge } = useProject(
    useShallow((s) => ({ nodes: s.nodes, edges: s.edges, addLink: s.addLink, removeEdge: s.removeEdge })),
  )
  const focus = useFocusNode()
  const add = useAddCard()
  const [target, setTarget] = useState('')
  const links = edges.filter((e) => e.source === node.id || e.target === node.id)
  const linked = new Set(links.flatMap((e) => [e.source, e.target]))
  const candidates = nodes.filter((n) => n.id !== node.id && !linked.has(n.id))
  const other = nodes.find((n) => n.id === target)
  const plan = other ? planLink(node, other) : null

  const spawn = (kind: CardKind) => {
    const x = node.position.x + CARD_W + 120
    const stacked = nodes.filter((n) => Math.abs(n.position.x - x) < CARD_W && Math.abs(n.position.y - node.position.y) < 600).length
    void add(kind, node.id, { x, y: node.position.y + stacked * 190 }).then((id) => id && focus(id))
  }

  return (
    <Section label={`Linked Cards (${links.length})`}>
      <div className="link-list">
        {links.map((e) => {
          const outgoing = e.source === node.id
          const peer = nodes.find((n) => n.id === (outgoing ? e.target : e.source))
          if (!peer) return null
          const kind = e.data?.kind ?? 'relates'
          return (
            <div key={e.id} className="link-row-wrap">
              <button type="button" className={`link-row link-row--${peer.data.kind}`} onClick={() => focus(peer.id)}>
                <KindIcon kind={peer.data.kind} size={15} />
                <span className="link-row__code mono">{peer.data.code}</span>
                <span className="link-row__title">{peer.data.title || '未命名'}</span>
                <span className="link-row__rel mono" style={{ ['--c' as string]: `var(--link-${kind})` }}>
                  {outgoing ? LINK_META[kind].label : `← ${LINK_META[kind].label}`}
                </span>
              </button>
              <button type="button" className="icon-btn" title="移除這條連線" onClick={() => void removeEdge(e.id)}>
                <X size={14} />
              </button>
            </div>
          )
        })}
        {!links.length && <p className="ins-empty">尚無連線。從卡片邊緣拖曳，或在下方選擇要連結的卡片。</p>}
      </div>

      <div className="link-add">
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">連結到…</option>
          {candidates.map((n) => (
            <option key={n.id} value={n.id}>
              {n.data.code} {n.data.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={!plan?.ok}
          title={plan && !plan.ok ? '這兩種卡片之間沒有可用的關聯' : undefined}
          onClick={async () => {
            if (!plan) return
            if (await addLink(plan.source.id, plan.rel, plan.target.data.code)) setTarget('')
          }}
        >
          <Link2 size={14} />
          {plan ? `${plan.source.data.code} ${LINK_META[plan.rel].label} ${plan.target.data.code}` : '連結'}
        </button>
      </div>

      <div className="spawn">
        {(['adr', 'milestone', 'task'] as CardKind[]).map((k) => (
          <button key={k} type="button" className={`spawn__btn spawn__btn--${k}`} onClick={() => spawn(k)}>
            <Plus size={12} />
            {KIND_META[k].label}
          </button>
        ))}
      </div>
    </Section>
  )
}

const SYNC_LABEL: Record<DraftView['status'] | 'saved', string> = {
  saved: 'Saved',
  pending: 'Pending',
  saving: 'Saving',
  conflict: 'Conflict',
  invalid: 'Invalid',
  error: 'Error',
  auth: 'Read-only',
}

function SyncChip({ draft, writable }: { draft?: DraftView; writable: boolean }) {
  const state = draft?.status ?? 'saved'
  return (
    <span className="sync-chip mono" data-state={writable ? state : 'locked'}>
      <i />
      {writable ? SYNC_LABEL[state] : 'Locked'}
      {draft?.diskChanged && <em>· 磁碟有更新</em>}
    </span>
  )
}

const FIELD_LABEL: Record<string, string> = { title: 'Title', status: 'Status', date: 'Date', due: 'Due', priority: 'Priority', assignee: 'Assignee' }

function fieldLabel(key: string) {
  return key.startsWith(SECTION_PREFIX) ? `## ${key.slice(SECTION_PREFIX.length)}` : (FIELD_LABEL[key] ?? key)
}

function diskValue(draft: DraftView, key: string) {
  const doc = draft.current
  if (!doc) return '—'
  if (key.startsWith(SECTION_PREFIX)) {
    const s = doc.sections[key.slice(SECTION_PREFIX.length)]
    return s?.state === 'ok' ? s.text : '—'
  }
  return String((doc.card as Record<string, unknown> | undefined)?.[key] ?? '—')
}

function DraftBanner({ docKey, draft }: { docKey: string; draft: DraftView }) {
  const { retryDraft, discardDraft, reapplyDraft } = useProject(
    useShallow((s) => ({ retryDraft: s.retryDraft, discardDraft: s.discardDraft, reapplyDraft: s.reapplyDraft })),
  )
  if (draft.status === 'conflict') {
    return (
      <div className="ins-alert ins-alert--conflict">
        <p>
          <AlertTriangle size={14} />
          檔案在你編輯期間被修改。草稿沒有寫入，請選擇如何處理：
        </p>
        <table className="diff-table mono">
          <thead>
            <tr>
              <th>欄位</th>
              <th>磁碟</th>
              <th>草稿（會覆寫）</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(draft.values).map(([k, v]) => (
              <tr key={k}>
                <td>{fieldLabel(k)}</td>
                <td>{diskValue(draft, k)}</td>
                <td>{v ?? '（刪除）'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ins-alert__actions">
          <button type="button" className="btn" onClick={() => discardDraft(docKey)}>
            捨棄草稿，載入磁碟版本
          </button>
          <button type="button" className="btn btn--primary" disabled={!draft.current} onClick={() => reapplyDraft(docKey)}>
            以磁碟版本為基礎重新套用
          </button>
        </div>
      </div>
    )
  }
  if (draft.status === 'invalid' || draft.status === 'error' || draft.status === 'auth') {
    return (
      <div className="ins-alert">
        <p>
          <AlertTriangle size={14} />
          {draft.message ?? '寫入失敗'}；草稿已保留。
        </p>
        <div className="ins-alert__actions">
          <button type="button" className="btn" onClick={() => discardDraft(docKey)}>
            捨棄草稿
          </button>
          {draft.status !== 'auth' && (
            <button type="button" className="btn btn--primary" onClick={() => retryDraft(docKey)}>
              <RotateCcw size={14} />
              重試
            </button>
          )}
        </div>
      </div>
    )
  }
  return null
}

function Plate({
  tone,
  num,
  sub,
  status,
  onClose,
  children,
}: {
  tone: CardKind | 'link'
  num: string
  sub: ReactNode
  status?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  return (
    <header className={`ins-head ins-head--${tone}`}>
      <button type="button" className="icon-btn ins-head__close" aria-label="關閉" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="plate">
        <div className="plate__row">
          <span className="plate__wedge" />
          <div className="plate__num">{num}</div>
        </div>
        <div className="plate__bar">{children}</div>
      </div>
      <div className="plate__sub">
        {sub}
        {status}
      </div>
    </header>
  )
}

function PlateStatus({ kind, status }: { kind: CardKind; status: string }) {
  const label = (STATUS_LABEL[kind] as Record<string, string>)[status] ?? status
  return (
    <span className="plate__status mono" data-status={status}>
      <i />
      {label}
    </span>
  )
}

function NodeInspector({ node, onClose }: { node: CardNode; onClose: () => void }) {
  const { editField, openRaw, requestDelete } = useProject(
    useShallow((s) => ({ editField: s.editField, openRaw: s.openRaw, requestDelete: s.requestDelete })),
  )
  const focus = useFocusNode()
  const d = node.data
  const [isNew] = useState(() => /^未命名 /.test(d.title))
  const errors = d.diagnostics.filter((x) => x.level === 'error')
  const superseded = d.diagnostics.find((x) => x.code === 'supersede-status')

  return (
    <>
      <Plate
        tone={d.kind}
        num={d.code.split('-')[1] ?? d.code}
        onClose={onClose}
        sub={
          <>
            <span className="plate__tag label-caps">
              <KindIcon kind={d.kind} size={12} />
              {KIND_META[d.kind].label}
            </span>
            <SyncChip draft={d.draft} writable={d.writable} />
          </>
        }
        status={<PlateStatus kind={d.kind} status={d.status} />}
      >
        <textarea
          className="ins-title"
          rows={1}
          value={d.title}
          readOnly={!d.writable}
          placeholder={`未命名 ${KIND_META[d.kind].label}`}
          autoFocus={isNew && d.writable}
          onFocus={(e) => isNew && e.currentTarget.select()}
          onChange={(e) => editField(d.docKey, 'title', e.target.value.replace(/\n/g, ' '))}
        />
      </Plate>

      <div className="ins-body">
        {d.draft && <DraftBanner docKey={d.docKey} draft={d.draft} />}
        {!d.writable && (
          <div className="ins-alert">
            <p>
              <AlertTriangle size={14} />
              {d.legacy
                ? `舊格式文件，以唯讀顯示；${d.inferred.join('、')} 為推測值。用 raw 編輯補上 frontmatter 即可轉換。`
                : `這份文件有錯誤，暫停透過欄位寫入：${errors.map((x) => x.message).join('；')}`}
            </p>
            <div className="ins-alert__actions">
              <button type="button" className="btn btn--primary" onClick={() => openRaw(d.docKey)}>
                <FileCode2 size={14} />
                {d.legacy ? '轉換（raw 編輯）' : '用 raw 編輯修正'}
              </button>
            </div>
          </div>
        )}
        {superseded && d.writable && (
          <div className="ins-alert">
            <p>
              <AlertTriangle size={14} />
              {superseded.message}
            </p>
            <div className="ins-alert__actions">
              <button type="button" className="btn btn--primary" onClick={() => editField(d.docKey, 'status', 'superseded', true)}>
                標記為 superseded
              </button>
            </div>
          </div>
        )}
        <CardFields node={node} />
        <Connections node={node} />
      </div>

      <footer className="ins-foot">
        <div className="ins-foot__grid">
          <button type="button" className="btn btn--primary" onClick={() => focus(node.id)}>
            <Crosshair size={15} />
            Center on canvas
          </button>
          <button type="button" className="btn btn--danger" onClick={() => requestDelete(d.docKey)}>
            <Trash2 size={15} />
            Delete
          </button>
        </div>
        <div className="ins-foot__meta">
          <button type="button" className="text-btn mono" onClick={() => openRaw(d.docKey)}>
            <FileCode2 size={13} />
            raw
          </button>
          <span className="ins-path mono" title={d.path}>
            {d.path}
          </span>
          <span className="mono muted">rev {d.revision.slice(0, 8)}</span>
        </div>
      </footer>
    </>
  )
}

function EdgeInspector({ edge, onClose }: { edge: LinkEdge; onClose: () => void }) {
  const { nodes, changeEdgeKind, reverseEdge, removeEdge } = useProject(
    useShallow((s) => ({ nodes: s.nodes, changeEdgeKind: s.changeEdgeKind, reverseEdge: s.reverseEdge, removeEdge: s.removeEdge })),
  )
  const focus = useFocusNode()
  const src = nodes.find((n) => n.id === edge.source)
  const tgt = nodes.find((n) => n.id === edge.target)
  const kind = edge.data?.kind ?? 'relates'
  const stored = edge.data?.storedAt.map((s) => nodes.find((n) => n.id === s.docKey)?.data.path).filter(Boolean) ?? []

  const end = (n?: CardNode) =>
    n && (
      <button type="button" className={`link-row link-row--${n.data.kind}`} onClick={() => focus(n.id)}>
        <KindIcon kind={n.data.kind} size={15} />
        <span className="link-row__code mono">{n.data.code}</span>
        <span className="link-row__title">{n.data.title || '未命名'}</span>
      </button>
    )

  return (
    <>
      <Plate
        tone="link"
        num="LNK"
        onClose={onClose}
        sub={
          <>
            <span className="plate__tag label-caps" style={{ ['--c' as string]: `var(--link-${kind})` }}>
              Link
            </span>
            <span className="plate__meta mono">{LINK_META[kind].hint}</span>
          </>
        }
        status={
          <span className="plate__status mono" data-status="link" style={{ ['--c' as string]: `var(--link-${kind})` }}>
            <i />
            {LINK_META[kind].label}
          </span>
        }
      >
        <h2 className="ins-title ins-title--static">
          {src?.data.code} <ArrowRight size={18} /> {tgt?.data.code}
        </h2>
      </Plate>
      <div className="ins-body">
        <Section label="Endpoints">
          <div className="link-list">
            {end(src)}
            {end(tgt)}
          </div>
        </Section>
        <Section label="Relation">
          <div className="seg">
            {(Object.keys(LINK_META) as LinkKind[]).map((k) => {
              const allowed = src ? Boolean(LINK_SCHEMA[src.data.kind][k]) : false
              return (
                <button
                  key={k}
                  type="button"
                  className={`seg__opt${k === kind ? ' is-active' : ''}`}
                  style={{ ['--c' as string]: `var(--link-${k})` }}
                  disabled={!allowed}
                  title={allowed ? undefined : `${src ? KIND_META[src.data.kind].label : ''} 不能有這種關聯`}
                  onClick={() => void changeEdgeKind(edge.id, k)}
                >
                  <i />
                  <b className="mono">{LINK_META[k].label}</b>
                  <small>{LINK_META[k].hint}</small>
                </button>
              )
            })}
          </div>
          <p className="ins-empty">寫在：{stored.join('、')}</p>
        </Section>
      </div>
      <footer className="ins-foot">
        <div className="ins-foot__grid">
          <button type="button" className="btn" onClick={() => void reverseEdge(edge.id)}>
            <ArrowLeftRight size={15} />
            Reverse
          </button>
          <button type="button" className="btn btn--danger" onClick={() => void removeEdge(edge.id)}>
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      </footer>
    </>
  )
}

export function Inspector() {
  const { nodes, edges, select } = useProject(useShallow((s) => ({ nodes: s.nodes, edges: s.edges, select: s.select })))
  const selectedNodes = nodes.filter((n) => n.selected)
  const selectedEdges = edges.filter((e) => e.selected)
  const total = selectedNodes.length + selectedEdges.length
  if (!total) return null

  const close = () => select(null)
  let content: ReactNode
  if (total > 1) {
    content = (
      <>
        <Plate tone="link" num={String(total).padStart(2, '0')} onClose={close} sub={<span className="plate__tag label-caps">Selection</span>}>
          <h2 className="ins-title ins-title--static">
            {selectedNodes.length} cards · {selectedEdges.length} links
          </h2>
        </Plate>
        <div className="ins-body">
          <div className="link-list">
            {selectedNodes.map((n) => (
              <div key={n.id} className={`link-row link-row--${n.data.kind}`}>
                <KindIcon kind={n.data.kind} size={15} />
                <span className="link-row__code mono">{n.data.code}</span>
                <span className="link-row__title">{n.data.title || '未命名'}</span>
              </div>
            ))}
          </div>
        </div>
      </>
    )
  } else if (selectedNodes[0]) {
    content = <NodeInspector key={selectedNodes[0].id} node={selectedNodes[0]} onClose={close} />
  } else {
    content = <EdgeInspector key={selectedEdges[0].id} edge={selectedEdges[0]} onClose={close} />
  }

  return (
    <aside className="inspector" aria-label="Inspector">
      {content}
    </aside>
  )
}
