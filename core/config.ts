import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { SCHEMA_VERSION, type CardKind } from './domain'
import type { Diagnostic } from './protocol'
import { resolveReadable, ScopeError } from './scope'

export const CONFIG_FILE = 'nodit.config.json'

export type NoditPaths = Record<CardKind, string> & { architecture: string; layout: string; review: string }

export type NoditConfig = {
  schemaVersion: number
  projectId: string
  paths: NoditPaths
  watch: { usePolling: boolean }
  managed: Record<string, { template: number; hash: string }>
}

export const DEFAULT_PATHS: NoditPaths = {
  adr: 'docs/decisions',
  milestone: 'docs/milestones',
  task: 'docs/tasks',
  architecture: 'docs/ARCHITECTURE.md',
  layout: '.nodit/layout.json',
  review: 'docs/reviews',
}

/** Unusable config file: callers that already hold a valid config keep it instead of the fallback. */
export const CONFIG_INVALID = 'config-invalid'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function safeRelative(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.includes('\0')) return false
  const norm = path.posix.normalize(p.replace(/\\/g, '/'))
  return !path.posix.isAbsolute(norm) && norm !== '..' && !norm.startsWith('../')
}

export async function loadConfig(root: string): Promise<{ config: NoditConfig; exists: boolean; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = []
  const fallbackId = createHash('sha1').update(await realpath(root)).digest('hex').slice(0, 16)
  const base: NoditConfig = {
    schemaVersion: SCHEMA_VERSION,
    projectId: fallbackId,
    paths: { ...DEFAULT_PATHS },
    watch: { usePolling: false },
    managed: {},
  }

  let text: string
  try {
    text = await readFile(await resolveReadable(root, CONFIG_FILE), 'utf8')
  } catch (err) {
    // only a missing file means "not initialized"; unreadable is unusable, never "use defaults"
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { config: base, exists: false, diagnostics }
    const reason = err instanceof ScopeError ? err.message : `無法讀取：${(err as Error).message}`
    diagnostics.push({ level: 'error', code: CONFIG_INVALID, message: `${CONFIG_FILE}：${reason}` })
    return { config: base, exists: true, diagnostics }
  }

  const invalid = (message: string) => {
    diagnostics.push({ level: 'error', code: CONFIG_INVALID, message: `${CONFIG_FILE} ${message}` })
    return { config: base, exists: true, diagnostics }
  }
  let data: Partial<NoditConfig>
  try {
    data = JSON.parse(text)
  } catch (err) {
    return invalid(`不是有效的 JSON：${(err as Error).message}`)
  }
  if (!isPlainObject(data)) return invalid('頂層必須是 JSON 物件')
  if (data.schemaVersion !== undefined && (typeof data.schemaVersion !== 'number' || !Number.isInteger(data.schemaVersion))) {
    return invalid('的 schemaVersion 必須是整數')
  }
  for (const key of ['paths', 'watch', 'managed'] as const) {
    if (data[key] !== undefined && !isPlainObject(data[key])) return invalid(`的 ${key} 必須是物件`)
  }

  if (data.schemaVersion !== undefined && data.schemaVersion > SCHEMA_VERSION) {
    return invalid(`的 schemaVersion ${data.schemaVersion} 比目前支援的 ${SCHEMA_VERSION} 新`)
  }
  // a bad path rejects the whole file: silently using the default would write cards elsewhere
  const paths = { ...DEFAULT_PATHS }
  for (const [k, v] of Object.entries(data.paths ?? {})) {
    if (!(k in paths)) continue
    if (!safeRelative(v)) return invalid(`的 paths.${k} 必須是專案內的相對路徑`)
    paths[k as keyof NoditPaths] = path.posix.normalize(v.replace(/\\/g, '/'))
  }

  return {
    config: {
      schemaVersion: data.schemaVersion ?? SCHEMA_VERSION,
      projectId: typeof data.projectId === 'string' && data.projectId ? data.projectId : fallbackId,
      paths,
      watch: { usePolling: Boolean(data.watch?.usePolling) },
      managed: data.managed ?? {},
    },
    exists: true,
    diagnostics,
  }
}
