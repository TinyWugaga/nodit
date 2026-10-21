import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'

export class ScopeError extends Error {}

/**
 * Resolve a project-relative path for writing. The path must sit inside one of the allowed
 * relative prefixes, its nearest existing ancestor must resolve inside the project root, and an
 * existing target must not be a symlink.
 */
export async function resolveInScope(root: string, rel: string, allowed: string[]): Promise<string> {
  if (!rel || rel.includes('\0')) throw new ScopeError('路徑無效')
  const norm = path.posix.normalize(rel.replace(/\\/g, '/'))
  if (path.posix.isAbsolute(norm) || norm === '..' || norm.startsWith('../')) throw new ScopeError(`路徑超出專案範圍：${rel}`)
  if (!allowed.some((a) => norm === a || norm.startsWith(a.replace(/\/$/, '') + '/'))) {
    throw new ScopeError(`不允許寫入：${rel}`)
  }

  const realRoot = await realpath(root)
  const abs = path.join(realRoot, ...norm.split('/'))

  let probe = abs
  for (;;) {
    try {
      await lstat(probe)
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      const parent = path.dirname(probe)
      if (parent === probe) throw new ScopeError('找不到可用的父目錄')
      probe = parent
    }
  }
  if (probe === abs && (await lstat(abs)).isSymbolicLink()) throw new ScopeError(`目標是 symlink，拒絕寫入：${rel}`)
  let realProbe: string
  try {
    realProbe = await realpath(probe)
  } catch {
    throw new ScopeError(`無法解析路徑：${rel}`)
  }
  if (!inside(realRoot, realProbe)) throw new ScopeError(`路徑經由 symlink 跳出專案：${rel}`)
  return abs
}

function inside(realRoot: string, real: string) {
  return real === realRoot || real.startsWith(realRoot + path.sep)
}

/**
 * Resolve a project-relative path for reading. Symlinks are followed only while the final target
 * stays inside the project root. A missing file rejects with the original ENOENT.
 */
export async function resolveReadable(root: string, rel: string): Promise<string> {
  const realRoot = await realpath(root)
  const abs = path.join(realRoot, ...rel.split('/'))
  const real = await realpath(abs)
  if (!inside(realRoot, real)) throw new ScopeError(`路徑經由 symlink 跳出專案：${rel}`)
  return abs
}
