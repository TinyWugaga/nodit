import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify } from 'yaml'
import { findHeadings } from '../core/sections'

// Mirrors the project's own docs/ into examples/nodit in Nodit's card format.
// docs/decisions and docs/reviews under the example are generated: hand edits there are overwritten.
export const EXAMPLE = 'examples/nodit'
const SOURCES = { adr: 'docs/decisions', review: 'docs/reviews' }
const REVIEWER = 'claude'
const LAYOUT = '.nodit/layout.json'
const LAYOUT_STEP = 210

const ADR_STATUS: Record<string, string> = { Accepted: 'accepted', Proposed: 'proposed', Deprecated: 'deprecated', Superseded: 'superseded' }
const ADR_SECTIONS: Record<string, string> = { 決策: 'Decision', 影響: 'Consequences', 後果: 'Consequences' }

export class SyncError extends Error {}

const adrId = (num: string) => `ADR-${String(Number(num)).padStart(3, '0')}`
const scalar = (v: string) => stringify(v).trimEnd()

function frontmatter(fields: [string, string | string[] | undefined][]) {
  const lines = fields
    .filter(([, v]) => v !== undefined && v.length > 0)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
  return `---\n${lines.join('\n')}\n---\n`
}

function demote(text: string) {
  let out = text
  for (const h of findHeadings(text).reverse()) if (h.level < 6) out = `${out.slice(0, h.start)}#${out.slice(h.start)}`
  return out
}

/** Splits markdown into the text before the first `## ` heading and the `## ` sections after it. */
function sections(body: string) {
  const starts = findHeadings(body).filter((h) => h.level === 2).map((h) => h.start)
  const head = body.slice(0, starts[0] ?? body.length)
  return { head, sections: starts.map((s, i) => body.slice(s, starts[i + 1])) }
}

export function convertAdr(name: string, src: string) {
  const m = /^# (\d{4}) — (.+)\n/.exec(src)
  if (!m) throw new SyncError(`${name}：第一行不是「# NNNN — 標題」`)
  const id = adrId(m[1])
  const { head, sections: rest } = sections(src.slice(m[0].length))

  const status = /^- 狀態：(\w+)/m.exec(head)?.[1]
  if (!status || !ADR_STATUS[status]) throw new SyncError(`${name}：找不到可辨識的「- 狀態：」`)
  const date = /^- 日期：(\d{4}-\d{2}-\d{2})/m.exec(head)?.[1]
  if (!date) throw new SyncError(`${name}：找不到「- 日期：YYYY-MM-DD」`)
  const relates = [...head.matchAll(/^- (?:取代|延伸|補完)：(.+)$/gm)]
    .flatMap((r) => [...r[1].matchAll(/\b(\d{4})\b/g)].map((n) => adrId(n[1])))
    .filter((r, i, all) => r !== id && all.indexOf(r) === i)

  // The Inspector shows only the managed sections, each running to the next `##`; other sections are
  // demoted so they stay visible inside the managed section before them.
  let body = rest
    .map((s) => {
      const heading = /^## (.+)\n\n?/.exec(s)!
      if (heading[1] === '背景') return s.slice(heading[0].length)
      const mapped = ADR_SECTIONS[heading[1]]
      return mapped ? s.replace(/^## .+/, `## ${mapped}`) : demote(s)
    })
    .join('')
  if (!/^## Consequences$/m.test(body)) body = `${body.trimEnd()}\n\n## Consequences\n`

  const fm = frontmatter([
    ['id', id],
    ['type', 'adr'],
    ['title', scalar(m[2].trim())],
    ['status', ADR_STATUS[status]],
    ['date', date],
    ['relates', relates],
  ])
  return { id, rel: `${SOURCES.adr}/${id}-${name.replace(/^\d{4}-/, '')}`, content: `${fm}\n## Context\n${head}${body}` }
}

export function convertReview(name: string, src: string) {
  const m = /^(\d{4}-\d{2}-\d{2})-(\d{4})-/.exec(name)
  if (!m) throw new SyncError(`${name}：檔名不是「YYYY-MM-DD-NNNN-…」`)
  const [, date, num] = m
  const target = adrId(num)
  const { head, sections: rest } = sections(src.replace(/^# .+\n/, ''))
  const intro = head.trim()

  const findings = rest.find((s) => s.startsWith('## Findings\n')) ?? ''
  const verdict = /\*\*P[01]\b/.test(findings) ? 'changes' : 'approve'
  const status = /^\s*- \[ \]/m.test(findings) ? 'open' : 'addressed'

  const body = rest
    .map((s) => (intro && s.startsWith('## Summary\n') ? s.replace(/^## Summary\n\n?/, `## Summary\n\n${intro}\n\n`) : s))
    .join('')
  const fm = frontmatter([
    ['type', 'review'],
    ['target', [target]],
    ['reviewer', REVIEWER],
    ['date', date],
    ['verdict', verdict],
    ['status', status],
  ])
  const suffix = createHash('sha1').update(name).digest('hex').slice(0, 6)
  return { rel: `${SOURCES.review}/${date}-${target}-${REVIEWER}-${suffix}.md`, content: `${fm}\n${body}` }
}

async function markdownIn(dir: string) {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

/** Every file the example should contain under the generated paths, keyed by path relative to the example root. */
export async function buildExample(root: string) {
  const out = new Map<string, string>()
  const ids: string[] = []
  for (const name of await markdownIn(join(root, SOURCES.adr))) {
    const adr = convertAdr(name, await readFile(join(root, SOURCES.adr, name), 'utf8'))
    out.set(adr.rel, adr.content)
    ids.push(adr.id)
  }
  for (const name of await markdownIn(join(root, SOURCES.review))) {
    const review = convertReview(name, await readFile(join(root, SOURCES.review, name), 'utf8'))
    out.set(review.rel, review.content)
  }

  const layoutPath = join(root, EXAMPLE, LAYOUT)
  const layout = JSON.parse(await readFile(layoutPath, 'utf8').catch(() => '{}')) as Record<string, { x: number; y: number }>
  for (const [i, id] of ids.entries()) layout[id] ??= { x: 0, y: i * LAYOUT_STEP }
  out.set(LAYOUT, `${JSON.stringify(layout, null, 2)}\n`)
  return out
}

/** Brings the example in line with docs/. With `check`, only reports the paths that differ. */
export async function syncExample(root: string, { check = false } = {}) {
  const want = await buildExample(root)
  const changed: string[] = []
  for (const [rel, content] of want) {
    const path = join(root, EXAMPLE, rel)
    if ((await readFile(path, 'utf8').catch(() => null)) === content) continue
    changed.push(rel)
    if (check) continue
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  for (const dir of Object.values(SOURCES)) {
    for (const name of await markdownIn(join(root, EXAMPLE, dir))) {
      const rel = `${dir}/${name}`
      if (want.has(rel)) continue
      changed.push(rel)
      if (!check) await rm(join(root, EXAMPLE, rel))
    }
  }
  return changed
}

async function main() {
  const check = process.argv.includes('--check')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const changed = await syncExample(root, { check })
  if (check && changed.length) {
    console.error(`${EXAMPLE} 與 docs/ 不同步，執行 npm run sync:example：\n${changed.map((p) => `  ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log(changed.length ? changed.map((p) => `${check ? '' : 'updated '}${p}`).join('\n') : `${EXAMPLE} 已同步`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof SyncError ? err.message : err)
    process.exit(1)
  })
}
