import { AlertTriangle, ClipboardCheck, X } from 'lucide-react'
import DOMPurify from 'dompurify'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { renderMarkdown } from '../architecture/render'
import { REVIEW_STATUS_LABEL, TARGET_STATE_LABEL } from '../presentation'
import { countFindings, isValidReview } from '../reviews'
import { useProject } from '../store'
import { Frame } from './Frame'
import { VerdictChip } from './ReviewParts'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ReviewViewer() {
  const { openReview, reviews, docs, setOpenReview, setReviewStatus, focusCard } = useProject(
    useShallow((s) => ({
      openReview: s.openReview,
      reviews: s.reviews,
      docs: s.docs,
      setOpenReview: s.setOpenReview,
      setReviewStatus: s.setReviewStatus,
      focusCard: s.focusCard,
    })),
  )
  const review = reviews.find((r) => r.docKey === openReview)
  const known = useMemo(() => new Set(docs.flatMap((d) => (d.card ? [d.card.id] : []))), [docs])
  const html = useMemo(() => (review?.body.trim() ? renderMarkdown(review.body, known, DOMPurify).html : ''), [review?.body, known])
  const panel = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)

  // remember what had focus so closing returns there; focus the heading on open
  useLayoutEffect(() => {
    if (!openReview) return
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    heading.current?.focus()
    return () => {
      if (opener.current?.isConnected) opener.current.focus()
    }
  }, [openReview])

  useEffect(() => setBusy(false), [openReview])

  // the file vanished while open: the heading is replaced, so keep focus inside the dialog
  const gone = Boolean(openReview) && !review
  useEffect(() => {
    if (gone) heading.current?.focus()
  }, [gone])

  if (!openReview) return null
  const close = () => setOpenReview(null)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const onBodyClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const card = a.getAttribute('data-card')
    const href = a.getAttribute('href') ?? ''
    if (card) {
      close()
      focusCard(card)
    } else if (/^https?:/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
  }

  const setStatus = async (status: string) => {
    setBusy(true)
    await setReviewStatus(openReview, status)
    setBusy(false)
  }

  const valid = review ? isValidReview(review) : false
  const meta = review?.review
  const findings = review ? countFindings(review.body) : null
  const errors = review?.diagnostics.filter((d) => d.level === 'error') ?? []
  const titleOf = (id: string) => docs.find((d) => d.card?.id === id)?.card?.title
  const others = (meta?.targets.length ?? 0) > 1 ? `同時套用到 ${meta!.targets.join('、')}` : null

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && close()}>
      <div ref={panel} className="modal__panel modal__panel--wide review-viewer" role="dialog" aria-modal="true" aria-labelledby="review-viewer-title" onKeyDown={onKeyDown}>
        <Frame />
        <header className="modal__head">
          <span className="sec-head__tag label-caps">
            <ClipboardCheck size={12} /> Review
          </span>
          <span className="mono muted" title={review?.path}>
            {review?.path ?? '—'}
          </span>
          <button type="button" className="icon-btn" aria-label="關閉" onClick={close}>
            <X size={16} />
          </button>
        </header>

        {!review ? (
          <>
            <h2 id="review-viewer-title" ref={heading} tabIndex={-1} className="review-viewer__title">
              這份 review 已被移除或改名
            </h2>
            <p className="modal__text">檔案已不在 reviews 資料夾，或換了檔名。改名後的 review 會以新項目出現在卡片上。</p>
            <footer className="modal__foot">
              <span />
              <button type="button" className="btn" onClick={close}>
                關閉
              </button>
            </footer>
          </>
        ) : (
          <>
            <div className="review-viewer__meta">
              <h2 id="review-viewer-title" ref={heading} tabIndex={-1} className="review-viewer__title">
                {meta?.reviewer ?? '未知 reviewer'} 的 review
              </h2>
              <VerdictChip review={review} />
              {valid && <span className="mono muted">{REVIEW_STATUS_LABEL[meta!.status!]}</span>}
              <span className="mono muted">{meta?.date ?? '—'}</span>
              {findings && (
                <span className="mono muted">
                  Findings {findings.open}/{findings.total} 未處理
                </span>
              )}
            </div>

            {errors.length > 0 && (
              <div className="ins-alert">
                <p>
                  <AlertTriangle size={14} />
                  格式錯誤，唯讀：{errors.map((d) => d.message).join('；')}
                </p>
              </div>
            )}

            <ul className="review-targets">
              {review.targets.map((t) => (
                <li key={t.id} data-state={t.state}>
                  <button
                    type="button"
                    className="text-btn mono"
                    disabled={t.state === 'missing'}
                    onClick={() => {
                      close()
                      focusCard(t.id)
                    }}
                  >
                    {t.id}
                  </button>
                  <span className="review-targets__title">{titleOf(t.id) ?? ''}</span>
                  <span className="review-state mono" data-state={t.state}>
                    {TARGET_STATE_LABEL[t.state]}
                  </span>
                </li>
              ))}
            </ul>

            <div className="review-viewer__body">
              {html ? <div className="prose" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} /> : <p className="ins-empty">沒有正文</p>}
            </div>

            <footer className="modal__foot">
              <span className="mono muted">{!valid ? '修正格式錯誤後才能變更狀態' : others}</span>
              {meta?.status === 'open' || !valid ? (
                <>
                  <button type="button" className="btn" disabled={!valid || busy} onClick={() => void setStatus('dismissed')}>
                    略過整份 review
                  </button>
                  <button type="button" className="btn btn--primary" disabled={!valid || busy} onClick={() => void setStatus('addressed')}>
                    將整份 review 標記為已處理
                  </button>
                </>
              ) : (
                <button type="button" className="btn" disabled={busy} onClick={() => void setStatus('open')}>
                  重新開啟整份 review
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
