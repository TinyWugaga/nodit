export type Eol = '\n' | '\r\n'

export type SplitDoc = {
  raw: string
  bom: boolean
  eol: Eol
  /** yaml content range inside raw (between the --- fences); null when absent */
  fm: { start: number; end: number } | null
  /** frontmatter opened but never closed */
  unterminated: boolean
  bodyStart: number
}

export function detectEol(raw: string): Eol {
  return raw.includes('\r\n') ? '\r\n' : '\n'
}

export function splitDoc(raw: string): SplitDoc {
  const bom = raw.charCodeAt(0) === 0xfeff
  const origin = bom ? 1 : 0
  const eol = detectEol(raw)
  const open = /^---[ \t]*\r?\n/.exec(raw.slice(origin))
  if (!open) return { raw, bom, eol, fm: null, unterminated: false, bodyStart: origin }

  const start = origin + open[0].length
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm
  close.lastIndex = start
  let m: RegExpExecArray | null
  while ((m = close.exec(raw))) {
    if (m.index >= start) break
  }
  if (!m) return { raw, bom, eol, fm: null, unterminated: true, bodyStart: origin }
  return { raw, bom, eol, fm: { start, end: m.index }, unterminated: false, bodyStart: m.index + m[0].length }
}
