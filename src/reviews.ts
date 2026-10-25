import { Lexer, type Token, type Tokens } from 'marked'
import { REVIEW_VERDICTS, type ReviewTargetState } from '../core/domain'
import type { ClientReview } from '../core/protocol'

export type FindingCount = { open: number; total: number }

function countTasks(tokens: Token[], acc: FindingCount) {
  for (const t of tokens) {
    if (t.type === 'list') {
      for (const item of (t as Tokens.List).items) {
        if (item.task) {
          acc.total++
          if (!item.checked) acc.open++
        }
        countTasks(item.tokens, acc)
      }
    }
  }
}

/**
 * Checklist items under `## Findings`, nested lists included. Parsed as markdown so checklists
 * inside code fences are not counted. `null` when the review has no Findings section.
 */
export function countFindings(body: string): FindingCount | null {
  const tokens = new Lexer({ gfm: true }).lex(body)
  const start = tokens.findIndex((t) => t.type === 'heading' && (t as Tokens.Heading).depth === 2 && (t as Tokens.Heading).text.trim() === 'Findings')
  if (start < 0) return null
  const end = tokens.findIndex((t, i) => i > start && t.type === 'heading' && (t as Tokens.Heading).depth <= 2)
  const acc = { open: 0, total: 0 }
  countTasks(tokens.slice(start + 1, end < 0 ? undefined : end), acc)
  return acc
}

export const isValidReview = (r: ClientReview) => Boolean(r.review) && !r.diagnostics.some((d) => d.level === 'error')

export function reviewsFor(reviews: ClientReview[], cardId: string) {
  return reviews.filter((r) => r.review?.targets.includes(cardId))
}

export function targetState(r: ClientReview, cardId: string): ReviewTargetState | undefined {
  return r.targets.find((t) => t.id === cardId)?.state
}

const SEVERITY = [...REVIEW_VERDICTS]

export type CardReviewSummary = { open: number; worst?: (typeof REVIEW_VERDICTS)[number]; stale: boolean }

/**
 * What a card's badge shows: only valid, open reviews count, and staleness only looks at this
 * card's own target so an unchanged sibling target is not marked stale.
 */
export function summarizeForCard(reviews: ClientReview[], cardId: string): CardReviewSummary {
  const open = reviewsFor(reviews, cardId).filter((r) => isValidReview(r) && r.review!.status === 'open')
  let worst: CardReviewSummary['worst']
  for (const r of open) {
    const v = r.review!.verdict as CardReviewSummary['worst']
    if (v && (!worst || SEVERITY.indexOf(v) > SEVERITY.indexOf(worst))) worst = v
  }
  return { open: open.length, worst, stale: open.some((r) => targetState(r, cardId) === 'stale') }
}
