import { isMap, isScalar, isSeq, parseDocument, Scalar, stringify, type Node, type Pair } from 'yaml'
import { MANAGED_SECTIONS, type CardKind } from './domain'
import { splitDoc, type Eol } from './frontmatter'

export type FieldValue = string | string[] | null

export class EditError extends Error {}

type Splice = { start: number; end: number; text: string }

function fmtScalar(v: string, like?: Node | null) {
  const type = isScalar(like) && (like.type === 'QUOTE_DOUBLE' || like.type === 'QUOTE_SINGLE') ? like.type : undefined
  return stringify(v, { lineWidth: 0, defaultStringType: type ?? Scalar.PLAIN }).trimEnd()
}

function fmtFlowSeq(items: string[]) {
  return '[' + items.map((i) => fmtScalar(i)).join(', ') + ']'
}

function lineStart(text: string, i: number) {
  return text.lastIndexOf('\n', i - 1) + 1
}

function lineEndInclusive(text: string, i: number) {
  const nl = text.indexOf('\n', i)
  return nl === -1 ? text.length : nl + 1
}

/**
 * Set or remove top-level frontmatter keys by splicing only the affected value ranges,
 * so untouched keys, comments and quoting stay byte-identical.
 */
export function setFields(raw: string, patch: Record<string, FieldValue>): string {
  const split = splitDoc(raw)
  if (!split.fm) throw new EditError('文件沒有可編輯的 frontmatter')
  const { start, end } = split.fm
  const yamlText = raw.slice(start, end)
  const doc = parseDocument(yamlText)
  if (doc.errors.length) throw new EditError(`frontmatter 解析失敗：${doc.errors[0].message}`)
  if (doc.contents && !isMap(doc.contents)) throw new EditError('frontmatter 不是 key/value 結構')
  const items = (isMap(doc.contents) ? doc.contents.items : []) as Pair<Node, Node | null>[]

  const splices: Splice[] = []
  const appended: string[] = []

  for (const [key, value] of Object.entries(patch)) {
    const pair = items.find((p) => isScalar(p.key) && p.key.value === key)
    if (!pair) {
      if (value === null || (Array.isArray(value) && value.length === 0)) continue
      appended.push(`${key}: ${Array.isArray(value) ? fmtFlowSeq(value) : fmtScalar(value)}`)
      continue
    }
    const keyNode = pair.key as Node
    const valueNode = pair.value
    if (value === null) {
      const from = lineStart(yamlText, keyNode.range![0])
      const last = valueNode?.range ? valueNode.range[1] : keyNode.range![1]
      splices.push({ start: from, end: lineEndInclusive(yamlText, Math.max(last - 1, from)), text: '' })
      continue
    }
    const colon = yamlText.indexOf(':', keyNode.range![1]) + 1
    if (!valueNode?.range) {
      splices.push({ start: colon, end: colon, text: ' ' + (Array.isArray(value) ? fmtFlowSeq(value) : fmtScalar(value)) })
      continue
    }
    const vs = valueNode.range[0]
    let ve = valueNode.range[1]
    while (ve > vs && /\s/.test(yamlText[ve - 1])) ve--
    if (Array.isArray(value)) {
      if (isSeq(valueNode) && !valueNode.flow && value.length > 0) {
        const indent = yamlText.slice(lineStart(yamlText, vs), vs)
        const eol: Eol = yamlText.includes('\r\n') ? '\r\n' : '\n'
        const text = value.map((v, i) => (i === 0 ? '- ' : indent + '- ') + fmtScalar(v)).join(eol)
        splices.push({ start: vs, end: ve, text })
      } else {
        splices.push({ start: isSeq(valueNode) && !valueNode.flow ? colon : vs, end: ve, text: (isSeq(valueNode) && !valueNode.flow ? ' ' : '') + fmtFlowSeq(value) })
      }
      continue
    }
    splices.push({ start: vs, end: ve, text: fmtScalar(value, valueNode) })
  }

  let next = yamlText
  for (const s of splices.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, s.start) + s.text + next.slice(s.end)
  }
  if (appended.length) {
    const eol: Eol = split.eol
    if (next.length && !next.endsWith('\n')) next += eol
    next += appended.map((l) => l + eol).join('')
  }
  return raw.slice(0, start) + next + raw.slice(end)
}

export type NewDoc = {
  kind: CardKind
  fields: Record<string, string | string[] | undefined>
  sections?: Record<string, string>
}

/** Render a brand-new card document in the canonical layout. */
export function renderDoc({ kind, fields, sections = {} }: NewDoc, eol: Eol = '\n'): string {
  const lines = ['---']
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    if (Array.isArray(v)) {
      if (v.length) lines.push(`${k}: ${fmtFlowSeq(v)}`)
    } else lines.push(`${k}: ${fmtScalar(v)}`)
  }
  lines.push('---', '')
  for (const name of MANAGED_SECTIONS[kind]) {
    lines.push(`## ${name}`, '')
    const text = sections[name]?.trim()
    if (text) lines.push(text, '')
  }
  return lines.join(eol)
}
