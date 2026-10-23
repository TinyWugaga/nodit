import { execFile } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

// semver.org's grammar without build metadata: npm drops `+build`, so two tags could publish the same version
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/

export class ReleaseError extends Error {}

export type Release = { version: string; distTag: string }

function core(version: string) {
  const m = SEMVER.exec(version)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Validates a pushed tag against package.json and the version npm currently serves as `latest`. */
export function checkRelease(tag: string, pkgVersion: string, latest: string | null): Release {
  if (!tag.startsWith('v')) throw new ReleaseError(`tag ${tag} 不是 v<版本號> 格式`)
  const version = tag.slice(1)
  const m = SEMVER.exec(version)
  if (!m) throw new ReleaseError(`tag ${tag} 不是合法的版本號（例：v1.2.3、v1.2.3-beta.1）`)
  if (version !== pkgVersion) throw new ReleaseError(`tag ${tag} 和 package.json 的 version ${pkgVersion} 不一致`)

  const pre = m[4]
  if (pre) {
    const id = pre.split('.')[0]
    return { version, distTag: /^[a-zA-Z]/.test(id) ? id.toLowerCase() : 'next' }
  }

  const base = latest && core(latest)
  if (base) {
    const next = core(version)!
    const cmp = next.map((n, i) => n - base[i]).find((d) => d !== 0) ?? 0
    if (cmp <= 0) throw new ReleaseError(`${version} 沒有比 npm 上的 latest ${latest} 新`)
  }
  return { version, distTag: 'latest' }
}

async function latestOnNpm(name: string) {
  try {
    const { stdout } = await promisify(execFile)('npm', ['view', name, 'dist-tags.latest'])
    return stdout.trim() || null
  } catch (err) {
    if (/E404/.test(String((err as { stderr?: string }).stderr))) return null
    throw err
  }
}

async function main() {
  const tag = process.argv[2] ?? ''
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string }
  const release = checkRelease(tag, pkg.version, await latestOnNpm(pkg.name))
  console.log(`${pkg.name}@${release.version} → dist-tag ${release.distTag}`)
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${release.version}\ndist-tag=${release.distTag}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof ReleaseError ? `::error::${err.message}` : err)
    process.exit(1)
  })
}
