import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { SCHEMA_VERSION, type CardKind } from './domain'
import type { Diagnostic } from './protocol'

export const CONFIG_FILE = 'nodit.config.json'

export type NoditPaths = Record<CardKind, string> & { architecture: string; layout: string }

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
    text = await readFile(path.join(root, CONFIG_FILE), 'utf8')
  } catch {
    return { config: base, exists: false, diagnostics }
  }

  let data: Partial<NoditConfig>
  try {
    data = JSON.parse(text)
  } catch (err) {
    diagnostics.push({ level: 'error', code: 'config-invalid', message: `${CONFIG_FILE} 不是有效的 JSON：${(err as Error).message}` })
    return { config: base, exists: true, diagnostics }
  }

  if (data.schemaVersion !== undefined && data.schemaVersion > SCHEMA_VERSION) {
    diagnostics.push({ level: 'error', code: 'config-version', message: `schemaVersion ${data.schemaVersion} 比目前支援的 ${SCHEMA_VERSION} 新` })
  }
  const paths = { ...DEFAULT_PATHS }
  for (const [k, v] of Object.entries(data.paths ?? {})) {
    if (!(k in paths)) continue
    if (safeRelative(v)) paths[k as keyof NoditPaths] = path.posix.normalize(v.replace(/\\/g, '/'))
    else diagnostics.push({ level: 'error', code: 'config-path', message: `paths.${k} 必須是專案內的相對路徑` })
  }

  return {
    config: {
      schemaVersion: data.schemaVersion ?? SCHEMA_VERSION,
      projectId: typeof data.projectId === 'string' && data.projectId ? data.projectId : fallbackId,
      paths,
      watch: { usePolling: Boolean(data.watch?.usePolling) },
      managed: data.managed && typeof data.managed === 'object' ? data.managed : {},
    },
    exists: true,
    diagnostics,
  }
}
