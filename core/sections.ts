import type { Eol } from './frontmatter'

export type Heading = { level: number; name: string; start: number; lineEnd: number }

export type SectionState =
  | { state: 'ok'; text: string; contentStart: number; contentEnd: number }
  | { state: 'missing' }
  | { state: 'duplicate'; count: number }

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/

/** ATX headings outside fenced code blocks; offsets are relative to `text` plus `offset`. */
export function findHeadings(text: string, offset = 0): Heading[] {
  const out: Heading[] = []
  let fence: string | null = null
  let pos = 0
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos)
    const lineEnd = nl === -1 ? text.length : nl + 1
    const line = text.slice(pos, nl === -1 ? text.length : nl).replace(/\r$/, '')
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null
    } else if (f) {
      fence = f[1]
    } else {
      const h = ATX.exec(line)
      if (h) {
        const name = (h[2] ?? '').replace(/[ \t]+#+$/, '').trim()
        out.push({ level: h[1].length, name, start: offset + pos, lineEnd: offset + lineEnd })
      }
    }
    if (nl === -1) break
    pos = lineEnd
  }
  return out
}

/** Level-2 managed sections: content runs until the next heading of level <= 2. */
export function readSections(raw: string, bodyStart: number, names: string[]): Record<string, SectionState> {
  const body = raw.slice(bodyStart)
  const headings = findHeadings(body, bodyStart)
  const result: Record<string, SectionState> = {}
  for (const name of names) {
    const hits = headings.filter((h) => h.level === 2 && h.name.toLowerCase() === name.toLowerCase())
    if (hits.length === 0) {
      result[name] = { state: 'missing' }
      continue
    }
    if (hits.length > 1) {
      result[name] = { state: 'duplicate', count: hits.length }
      continue
    }
    const h = hits[0]
    const next = headings.find((x) => x.start > h.start && x.level <= 2)
    const contentStart = h.lineEnd
    const contentEnd = next ? next.start : raw.length
    result[name] = { state: 'ok', text: raw.slice(contentStart, contentEnd).trim(), contentStart, contentEnd }
  }
  return result
}

/** Replace a section's content, keeping the surrounding blank-line shape of the original. */
export function replaceSection(raw: string, s: { contentStart: number; contentEnd: number }, text: string, eol: Eol) {
  const old = raw.slice(s.contentStart, s.contentEnd)
  const value = text.replace(/\r?\n/g, eol).trim()
  if (value === old.trim()) return raw
  const atEnd = s.contentEnd >= raw.length
  const hasText = old.trim() !== ''
  const lead = hasText ? /^\s*/.exec(old)![0] : eol
  const trail = hasText ? /\s*$/.exec(old)![0] : atEnd ? eol : eol + eol
  const next = value ? lead + value + trail : atEnd ? eol : eol + eol
  return raw.slice(0, s.contentStart) + next + raw.slice(s.contentEnd)
}
