import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { CONFIG_FILE, DEFAULT_PATHS, type NoditConfig } from './config'
import { CARD_KINDS, SCHEMA_VERSION } from './domain'
import { lineDiff } from './diff'
import { sha1 } from './parse'
import { resolveInScope } from './scope'
import { ValidationError, type InitOps, type Writer } from './writer'
import {
  BLOCK_END,
  BLOCK_START_RE,
  GITIGNORE_LINES,
  renderAgentsBlock,
  renderArchitecture,
  renderClaudeBlock,
  renderSkill,
  skillPath,
  TEMPLATE_VERSION,
  type SkillKind,
} from './templates'

export { lineDiff }

export type InitAction = 'create' | 'append' | 'upgrade' | 'skip' | 'conflict'

export type InitItem = {
  itemId: string
  path: string
  label: string
  group: 'core' | 'ai'
  action: InitAction
  reason?: string
  /** sha1 of the file at plan time, `absent`, or `dir` for directories */
  revision: string
  diff: string
}

type Internal = InitItem & {
  mode?: 'create' | 'replace' | 'mkdir'
  text?: string
  managedKey?: string
  rendered?: string
}

export type InitPlan = { planId: string; ai: boolean; createdAt: number; items: Internal[] }

export type InitResult = { itemId: string; path: string; ok: boolean; error?: string }

export function publicPlan(plan: InitPlan) {
  return {
    planId: plan.planId,
    ai: plan.ai,
    items: plan.items.map(({ mode: _m, text: _t, managedKey: _k, rendered: _r, ...rest }) => rest),
  }
}

/** The single, complete Nodit block in a shared file, or why there is none. */
export function findBlock(text: string): { start: number; end: number } | 'none' | 'malformed' {
  const starts = [...text.matchAll(BLOCK_START_RE)]
  const ends = text.split(BLOCK_END).length - 1
  if (!starts.length && !ends) return 'none'
  if (starts.length !== 1 || ends !== 1) return 'malformed'
  const start = starts[0].index!
  const endAt = text.indexOf(BLOCK_END)
  if (endAt < start) return 'malformed'
  return { start, end: endAt + BLOCK_END.length }
}

function blockItem(path: string, label: string, buf: Buffer | null, rendered: string, baseline: string | undefined): Internal {
  const base = { itemId: path + '#nodit', path, label, group: 'ai' as const, managedKey: path + '#nodit', rendered }
  if (!buf) return { ...base, action: 'create', revision: 'absent', mode: 'create', text: rendered + '\n', diff: rendered }
  const text = buf.toString('utf8')
  const revision = sha1(buf)
  const found = findBlock(text)
  if (found === 'none') {
    const sep = text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
    return { ...base, action: 'append', revision, mode: 'replace', text: text + sep + rendered + '\n', diff: rendered }
  }
  if (found === 'malformed') {
    return { ...base, action: 'conflict', revision, reason: 'Nodit 區塊標記不完整或出現多份，請手動整理後重跑', diff: '' }
  }
  const current = text.slice(found.start, found.end)
  if (current === rendered) return { ...base, action: 'skip', revision, reason: '已是最新', diff: '' }
  const diff = lineDiff(current, rendered)
  if (baseline && sha1(current) === baseline) {
    return { ...base, action: 'upgrade', revision, mode: 'replace', text: text.slice(0, found.start) + rendered + text.slice(found.end), diff }
  }
  return {
    ...base,
    action: 'conflict',
    revision,
    reason: baseline ? '受管區塊被手動修改過，保留你的修改' : '找不到 Nodit 的寫入紀錄，無法確認區塊是否被修改過',
    diff,
  }
}

function fileItem(path: string, label: string, buf: Buffer | null, rendered: string, baseline: string | undefined): Internal {
  const base = { itemId: path, path, label, group: 'ai' as const, managedKey: path, rendered }
  if (!buf) return { ...base, action: 'create', revision: 'absent', mode: 'create', text: rendered, diff: rendered }
  const text = buf.toString('utf8')
  const revision = sha1(buf)
  if (text === rendered) return { ...base, action: 'skip', revision, reason: '已是最新', diff: '' }
  const diff = lineDiff(text, rendered)
  if (baseline && sha1(text) === baseline) return { ...base, action: 'upgrade', revision, mode: 'replace', text: rendered, diff }
  return { ...base, action: 'conflict', revision, reason: baseline ? '檔案被手動修改過，保留你的修改' : '檔案已存在，而且不是 Nodit 建立的', diff }
}

async function readAll(ops: Pick<InitOps, 'read'>, paths: string[]) {
  const out = new Map<string, Buffer | null>()
  for (const p of paths) {
    try {
      out.set(p, await ops.read(p))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EISDIR') out.set(p, Buffer.from(''))
      else throw err
    }
  }
  return out
}

/** Read-only access for planning: same scope checks as writes, no lock needed. */
export function scopedRead(root: string, allowed: string[]): Pick<InitOps, 'read'> {
  return {
    read: async (rel) => {
      const abs = await resolveInScope(root, rel, allowed)
      try {
        return await readFile(abs)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
      }
    },
  }
}

export function initPaths(config: NoditConfig, ai = true) {
  return [
    CONFIG_FILE,
    '.gitignore',
    config.paths.architecture,
    ...CARD_KINDS.map((k) => config.paths[k]),
    ...(ai ? ['AGENTS.md', 'CLAUDE.md', ...(['adr', 'milestone', 'task'] as SkillKind[]).map(skillPath)] : []),
  ]
}

/** Build a plan from what is on disk now. `ops.read` must be scoped to `initPaths(config)`. */
export async function planInit(ops: Pick<InitOps, 'read'>, config: NoditConfig, configExists: boolean, ai: boolean): Promise<InitPlan> {
  const files = await readAll(ops, initPaths(config, ai))
  const items: Internal[] = []
  const managed = config.managed

  for (const kind of CARD_KINDS) {
    const dir = config.paths[kind]
    const exists = files.get(dir) !== null
    items.push({
      itemId: dir,
      path: dir,
      label: `${kind} 資料夾`,
      group: 'core',
      action: exists ? 'skip' : 'create',
      reason: exists ? '已存在' : undefined,
      revision: 'dir',
      mode: exists ? undefined : 'mkdir',
      diff: '',
    })
  }

  const arch = files.get(config.paths.architecture) ?? null
  items.push({
    itemId: config.paths.architecture,
    path: config.paths.architecture,
    label: '架構文件',
    group: 'core',
    action: arch ? 'skip' : 'create',
    reason: arch ? '已存在，不會修改' : undefined,
    revision: arch ? sha1(arch) : 'absent',
    mode: arch ? undefined : 'create',
    text: arch ? undefined : renderArchitecture(),
    diff: arch ? '' : renderArchitecture(),
  })

  const gi = files.get('.gitignore') ?? null
  const giText = gi?.toString('utf8') ?? ''
  const missing = GITIGNORE_LINES.filter((l) => !giText.split(/\r?\n/).includes(l))
  items.push({
    itemId: '.gitignore',
    path: '.gitignore',
    label: '忽略 Nodit 的本地鎖檔',
    group: 'core',
    action: !missing.length ? 'skip' : gi ? 'append' : 'create',
    reason: !missing.length ? '已包含' : undefined,
    revision: gi ? sha1(gi) : 'absent',
    mode: !missing.length ? undefined : gi ? 'replace' : 'create',
    text: giText + (giText && !giText.endsWith('\n') ? '\n' : '') + missing.map((l) => l + '\n').join(''),
    diff: missing.map((l) => '+ ' + l).join('\n'),
  })

  if (ai) {
    items.push(blockItem('AGENTS.md', 'AGENTS.md（Codex 等工具）', files.get('AGENTS.md') ?? null, renderAgentsBlock(config), managed['AGENTS.md#nodit']?.hash))
    items.push(blockItem('CLAUDE.md', 'CLAUDE.md（Claude Code）', files.get('CLAUDE.md') ?? null, renderClaudeBlock(config), managed['CLAUDE.md#nodit']?.hash))
    for (const kind of ['adr', 'milestone', 'task'] as SkillKind[]) {
      const p = skillPath(kind)
      items.push(fileItem(p, `Claude skill：${p.split('/')[2]}`, files.get(p) ?? null, renderSkill(kind, config), managed[p]?.hash))
    }
  }

  const cfg = files.get(CONFIG_FILE) ?? null
  const baselinesCurrent = items.every(
    (i) => !i.managedKey || !i.rendered || i.action === 'conflict' || managed[i.managedKey]?.hash === sha1(i.rendered),
  )
  const cfgAction: InitAction = !configExists ? 'create' : baselinesCurrent ? 'skip' : 'upgrade'
  items.unshift({
    itemId: CONFIG_FILE,
    path: CONFIG_FILE,
    label: 'Nodit 設定與受管內容基準',
    group: 'core',
    action: cfgAction,
    reason: cfgAction === 'skip' ? '已是最新' : configExists ? '記錄受管內容的基準 hash' : undefined,
    revision: cfg ? sha1(cfg) : 'absent',
    diff: '',
  })

  return { planId: randomUUID(), ai, createdAt: Date.now(), items }
}

function freshConfig(): NoditConfig {
  return { schemaVersion: SCHEMA_VERSION, projectId: randomUUID(), paths: { ...DEFAULT_PATHS }, watch: { usePolling: false }, managed: {} }
}

/**
 * Apply selected items. Content first, config (baseline hashes) last, so an interrupted run is
 * recoverable: content that already equals the rendered template is recorded as Nodit-written.
 */
export async function applyInit(writer: Writer, plan: InitPlan, itemIds: string[]): Promise<InitResult[]> {
  const byId = new Map(plan.items.map((i) => [i.itemId, i]))
  for (const id of itemIds) {
    const item = byId.get(id)
    if (!item) throw new ValidationError([{ level: 'error', code: 'init-unknown-item', message: `不在這份 init 計畫裡：${id}` }])
    if (item.action === 'conflict') throw new ValidationError([{ level: 'error', code: 'init-conflict', message: `${item.path} 有衝突，不能套用` }])
  }
  const allowed = plan.items.map((i) => i.path)

  return writer.exclusive(allowed, async (ops) => {
    const results: InitResult[] = []
    const baselines: Record<string, { template: number; hash: string }> = {}
    const selected = new Set(itemIds)

    for (const item of plan.items) {
      if (item.itemId === CONFIG_FILE) continue
      if (item.action === 'skip' && item.managedKey && item.rendered) {
        baselines[item.managedKey] = { template: TEMPLATE_VERSION, hash: sha1(item.rendered) }
        continue
      }
      if (!selected.has(item.itemId) || !item.mode) continue
      const fail = (error: string) => results.push({ itemId: item.itemId, path: item.path, ok: false, error })
      try {
        if (item.mode === 'mkdir') {
          await ops.mkdir(item.path)
        } else {
          const current = await ops.read(item.path)
          const rev = current ? sha1(current) : 'absent'
          if (rev !== item.revision) {
            fail('預覽之後檔案被修改，已略過；請重新產生計畫')
            continue
          }
          if (item.mode === 'create') await ops.create(item.path, item.text!)
          else await ops.replace(item.path, item.text!)
        }
        if (item.managedKey && item.rendered) baselines[item.managedKey] = { template: TEMPLATE_VERSION, hash: sha1(item.rendered) }
        results.push({ itemId: item.itemId, path: item.path, ok: true })
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        fail(code === 'EEXIST' ? '預覽時不存在的檔案已被建立，已略過' : (err as Error).message)
      }
    }

    const cfgItem = byId.get(CONFIG_FILE)!
    const cfgBuf = await ops.read(CONFIG_FILE)
    const cfgRev = cfgBuf ? sha1(cfgBuf) : 'absent'
    if (cfgRev !== cfgItem.revision) {
      results.push({ itemId: CONFIG_FILE, path: CONFIG_FILE, ok: false, error: '預覽之後設定檔被修改，基準沒有更新；請重跑 init' })
      return results
    }
    let data: Record<string, unknown>
    try {
      data = cfgBuf ? JSON.parse(cfgBuf.toString('utf8')) : (freshConfig() as unknown as Record<string, unknown>)
    } catch {
      results.push({ itemId: CONFIG_FILE, path: CONFIG_FILE, ok: false, error: `${CONFIG_FILE} 不是有效的 JSON` })
      return results
    }
    const managed = { ...(data.managed as Record<string, unknown> | undefined), ...baselines }
    const next = JSON.stringify({ ...data, schemaVersion: data.schemaVersion ?? SCHEMA_VERSION, managed }, null, 2) + '\n'
    if (cfgBuf && next === cfgBuf.toString('utf8')) {
      results.push({ itemId: CONFIG_FILE, path: CONFIG_FILE, ok: true })
      return results
    }
    try {
      if (cfgBuf) await ops.replace(CONFIG_FILE, next)
      else await ops.create(CONFIG_FILE, next)
      results.push({ itemId: CONFIG_FILE, path: CONFIG_FILE, ok: true })
    } catch (err) {
      results.push({ itemId: CONFIG_FILE, path: CONFIG_FILE, ok: false, error: (err as Error).message })
    }
    return results
  })
}
