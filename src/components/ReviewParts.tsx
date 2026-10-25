import { ClipboardCheck } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { ClientReview } from '../../core/protocol'
import { useReviewsFor } from '../hooks'
import { REVIEW_STATUS_LABEL, TARGET_STATE_LABEL, VERDICT_META } from '../presentation'
import { countFindings, isValidReview, summarizeForCard, targetState } from '../reviews'
import { useProject } from '../store'

/** Neutral "格式錯誤" for invalid reviews: their verdict may not be a known value. */
export function VerdictChip({ review }: { review: ClientReview }) {
  if (!isValidReview(review)) {
    return (
      <span className="verdict mono" data-tone="invalid">
        格式錯誤
      </span>
    )
  }
  const meta = VERDICT_META[review.review!.verdict!]
  return (
    <span className="verdict mono" data-tone={meta.tone}>
      {meta.label}
    </span>
  )
}

export function ReviewBadge({ cardId }: { cardId: string }) {
  const { open, worst, stale } = useProject(useShallow((s) => summarizeForCard(s.reviews, cardId)))
  if (!open) return null
  const tone = worst ? VERDICT_META[worst].tone : 'warn'
  return (
    <span
      className="review-badge mono"
      data-tone={tone}
      data-stale={stale || undefined}
      title={`${open} 份未處理的 review${stale ? '，有 review 評估後卡片已修改' : ''}`}
    >
      <ClipboardCheck size={11} />
      {open}
    </span>
  )
}

export function ReviewList({ cardId }: { cardId: string }) {
  const reviews = useReviewsFor(cardId)
  const setOpenReview = useProject((s) => s.setOpenReview)
  if (!reviews.length) return <p className="ins-empty">尚無 review。請 AI 評估這張卡片後，結果會出現在這裡。</p>
  return (
    <div className="review-list">
      {reviews.map((r) => {
        const valid = isValidReview(r)
        const state = targetState(r, cardId)
        const findings = countFindings(r.body)
        const status = valid ? r.review!.status! : undefined
        return (
          <button key={r.docKey} type="button" className="review-row" data-status={status} onClick={() => setOpenReview(r.docKey)}>
            <VerdictChip review={r} />
            <span className="review-row__who">
              <b>{r.review?.reviewer ?? '—'}</b>
              <span className="mono muted">{r.review?.date ?? ''}</span>
            </span>
            <span className="review-row__aside mono">
              {findings && (
                <span title="未處理 / 全部 findings">
                  {findings.open}/{findings.total}
                </span>
              )}
              {status && status !== 'open' && <span className="muted">{REVIEW_STATUS_LABEL[status]}</span>}
              {state && state !== 'current' && (
                <span className="review-state" data-state={state}>
                  {TARGET_STATE_LABEL[state]}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
