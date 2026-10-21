import type { Envelope, MutationResult, ProjectPayload } from '../../core/protocol'
import type { CreateResult, DeleteResult, Failure, InitPlanView, InitResultView, LayoutResult, LinkChange, NewCardInput, ProjectClient, SubscribeHandlers } from './client'

type Raw = { status: number; body: any; error?: string }

export const SECTION_PREFIX = 'section:'

export class HttpProjectClient implements ProjectClient {
  connGen = 0
  private token = document.querySelector<HTMLMetaElement>('meta[name="nodit-token"]')?.content ?? ''

  private async send(method: string, url: string, body?: unknown): Promise<Raw> {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Nodit-Token': this.token },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: res.status, body: await res.json().catch(() => ({})) }
    } catch (err) {
      return { status: 0, body: {}, error: `無法連線到 Nodit server：${(err as Error).message}` }
    }
  }

  private failure(r: Raw): Failure {
    if (r.status === 0) return { ok: false, reason: 'error', message: r.error ?? '連線失敗' }
    const body = r.body
    if (r.status === 409) return { ok: false, reason: 'conflict', message: '文件已在磁碟上被修改' }
    if (r.status === 422) {
      return { ok: false, reason: 'invalid', message: body.diagnostics?.map((d: { message: string }) => d.message).join('；') ?? '驗證失敗', diagnostics: body.diagnostics }
    }
    if (r.status === 401 || r.status === 403) return { ok: false, reason: 'auth', message: 'Server 已重新啟動或權杖失效，重新整理頁面後才能寫入' }
    if (r.status === 503) return { ok: false, reason: 'compromised', message: body.error ?? '寫入鎖已失效' }
    return { ok: false, reason: 'error', message: body.error ?? `HTTP ${r.status}` }
  }

  private mutation(r: Raw): MutationResult {
    if (r.status === 200) return { ok: true, envelope: r.body }
    if (r.status === 409) return { ok: false, reason: 'conflict', envelope: r.body }
    const f = this.failure(r)
    if (f.reason === 'invalid') return { ok: false, reason: 'invalid', diagnostics: f.diagnostics ?? [] }
    return { ok: false, reason: f.reason as 'auth' | 'compromised' | 'error', message: f.message }
  }

  async getProject(): Promise<Envelope<ProjectPayload>> {
    const res = await fetch('/api/project', { cache: 'no-store' })
    if (!res.ok) throw new Error(`無法載入專案（HTTP ${res.status}）`)
    return res.json()
  }

  async patchDoc(docKey: string, baseRevision: string, patch: Record<string, string | null>) {
    const fields: Record<string, string | null> = {}
    const sections: Record<string, string> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (k.startsWith(SECTION_PREFIX)) sections[k.slice(SECTION_PREFIX.length)] = v ?? ''
      else fields[k] = v
    }
    return this.mutation(
      await this.send('PATCH', `/api/docs/${docKey}`, {
        baseRevision,
        fields: Object.keys(fields).length ? fields : undefined,
        sections: Object.keys(sections).length ? sections : undefined,
      }),
    )
  }

  async getRaw(docKey: string) {
    const res = await fetch(`/api/docs/${docKey}/raw`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`讀取原始內容失敗（HTTP ${res.status}）`)
    return res.json()
  }

  async putRaw(docKey: string, baseRevision: string, text: string) {
    return this.mutation(await this.send('PUT', `/api/docs/${docKey}/raw`, { baseRevision, text }))
  }

  async patchLinks(docKey: string, baseRevision: string, change: { add?: LinkChange[]; remove?: LinkChange[] }) {
    return this.mutation(await this.send('PATCH', `/api/docs/${docKey}/links`, { baseRevision, ...change }))
  }

  async deleteDoc(docKey: string, baseRevision: string): Promise<DeleteResult> {
    const r = await this.send('DELETE', `/api/docs/${docKey}`, { baseRevision })
    return r.status === 200 ? { ok: true, envelope: r.body } : this.failure(r)
  }

  async createCard(input: NewCardInput): Promise<CreateResult> {
    const r = await this.send('POST', '/api/cards', input)
    return r.status === 201 ? { ok: true, envelope: r.body } : this.failure(r)
  }

  async putLayout(baseRevision: string, data: Record<string, { x: number; y: number }>): Promise<LayoutResult> {
    const r = await this.send('PUT', '/api/layout', { baseRevision, data })
    if (r.status === 200) return { ok: true, revision: r.body.revision }
    if (r.status === 409) return { ok: false, reason: 'conflict', layout: r.body.layout }
    return this.failure(r)
  }

  async getArchitecture(): Promise<{ path: string; revision: string; markdown: string | null }> {
    const res = await fetch('/api/architecture', { cache: 'no-store' })
    if (!res.ok) throw new Error(`無法讀取架構文件（HTTP ${res.status}）`)
    return res.json()
  }

  async getInitPlan(ai: boolean): Promise<InitPlanView> {
    const res = await fetch(`/api/init/plan?ai=${ai}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`無法產生 init 計畫（HTTP ${res.status}）`)
    return res.json()
  }

  async applyInit(planId: string, itemIds: string[]): Promise<{ ok: true; results: InitResultView[] } | Failure> {
    const r = await this.send('POST', '/api/init/apply', { planId, itemIds })
    if (r.status === 200) return { ok: true, results: r.body.results }
    if (r.status === 410) return { ok: false, reason: 'conflict', message: '計畫已過期，請重新產生' }
    return this.failure(r)
  }

  /** EventSource gives up for good after a non-200 response (e.g. the proxy while the server is down), so reconnect manually. */
  subscribe(h: SubscribeHandlers) {
    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 500
    let stopped = false

    const connect = () => {
      es = new EventSource('/api/events')
      es.onopen = () => {
        delay = 500
        this.connGen++
        h.status('open')
      }
      es.onerror = () => {
        h.status('closed')
        if (es?.readyState === EventSource.CLOSED && !stopped) {
          es.close()
          timer = setTimeout(connect, delay)
          delay = Math.min(delay * 2, 8000)
        }
      }
      es.addEventListener('hello', (e) => h.hello(JSON.parse((e as MessageEvent).data)))
      es.addEventListener('snapshot-changed', (e) => h.changed(JSON.parse((e as MessageEvent).data)))
      es.addEventListener('writer-compromised', (e) => h.compromised(JSON.parse((e as MessageEvent).data).message))
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(timer)
      es?.close()
    }
  }
}
