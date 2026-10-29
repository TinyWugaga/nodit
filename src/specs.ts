import type { SpecAdrState } from '../core/domain'
import type { ClientDoc, SpecAdr } from '../core/protocol'
import { SPEC_ADR_PRIORITY } from './presentation'
import { countChecklist } from './reviews'

/** Done/total of the `Acceptance Criteria` checklist; `null` without a section or a checklist. */
export function criteriaCount(criteria: string): { done: number; total: number } | null {
  const c = criteria.trim() ? countChecklist(criteria) : null
  return c && { done: c.total - c.open, total: c.total }
}

/** The one ADR state a spec card shows, or `undefined` when every ADR is current or there is none. */
export function worstAdrState(states: SpecAdr[]): SpecAdrState | undefined {
  return SPEC_ADR_PRIORITY.find((s) => states.some((x) => x.state === s))
}

/**
 * Inspector hint for an approved spec whose directly implementing tasks are all done. Only
 * `task implements spec` counts: no relates, nothing inferred through milestones.
 */
export function specCompletionHint(docs: ClientDoc[], specId: string, status: string, criteria: string): string | null {
  if (status !== 'approved') return null
  const tasks = docs.filter((d) => d.card?.type === 'task' && d.card.links.implements.includes(specId))
  if (!tasks.length || tasks.some((d) => d.card!.status !== 'done')) return null
  const c = criteriaCount(criteria)
  if (!c) return '相關 Task 已完成；尚無驗收紀錄'
  if (c.done === c.total) return `相關 Task 已完成；驗收條件 ${c.done}/${c.total}。可考慮標記 implemented`
  return `相關 Task 已完成；驗收條件 ${c.done}/${c.total}`
}

/**
 * For a task implementing an ADR that has approved specs, list them when the task implements none
 * of those specs. Information only: Nodit cannot tell whether a spec's scope covers the task.
 */
export function taskSpecHints(docs: ClientDoc[], implementsIds: string[]): { adr: string; specs: string[] }[] {
  const out: { adr: string; specs: string[] }[] = []
  for (const adr of implementsIds) {
    const specs = docs
      .filter((d) => d.card?.type === 'spec' && d.card.status === 'approved' && d.card.links.implements.includes(adr))
      .map((d) => d.card!.id)
      .sort()
    if (specs.length && !specs.some((s) => implementsIds.includes(s))) out.push({ adr, specs })
  }
  return out
}
