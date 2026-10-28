import type { ParsedDoc } from './parse'

/**
 * invalid: the ID cannot be resolved to one trustworthy file — several files share it, or the only
 * file currently fails to parse and is shown from its retained last valid card. Existing diagnostics
 * (`id-duplicate`, `card-stale`) explain why, so callers do not add their own.
 */
export type TargetResolution = { state: 'ok'; doc: ParsedDoc } | { state: 'invalid' } | { state: 'missing' }

/** Index cards by ID once; the returned lookup never picks one candidate out of several. */
export function cardResolver(docs: ParsedDoc[]): (id: string) => TargetResolution {
  const byId = new Map<string, ParsedDoc[]>()
  for (const d of docs) if (d.card) byId.set(d.card.id, [...(byId.get(d.card.id) ?? []), d])
  return (id) => {
    const list = byId.get(id)
    if (!list) return { state: 'missing' }
    if (list.length > 1 || list[0].stale) return { state: 'invalid' }
    return { state: 'ok', doc: list[0] }
  }
}
