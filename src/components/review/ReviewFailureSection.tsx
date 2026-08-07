import {
  type AutomaticFailureSummary,
  FAILURE_DECISIONS,
  type FailureDecision,
  type FailureReview,
} from '@shared/reviews/types'
import { reviewInputClass } from './reviewFormShared'

export interface ReviewFailureSectionProps {
  failures: readonly AutomaticFailureSummary[]
  reviews: readonly FailureReview[]
  locked: boolean
  /** The card C/X act on; hover or focus moves it, no extra click needed. */
  focusedFailureId: string | null
  onFocusFailure: (failureId: string) => void
  onDecide: (failureId: string, decision: FailureDecision) => void
  onNote: (failureId: string, note: string) => void
}

export function ReviewFailureSection({
  failures,
  reviews,
  locked,
  focusedFailureId,
  onFocusFailure,
  onDecide,
  onNote,
}: ReviewFailureSectionProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Hover or focus a finding, then press <kbd className="font-mono">C</kbd> to confirm or{' '}
        <kbd className="font-mono">X</kbd> to reject.
      </p>
      {failures.map((failure) => {
        const review = reviews.find((item) => item.failureId === failure.id)
        const focused = focusedFailureId === failure.id
        return (
          <article
            key={failure.id}
            data-focused={focused || undefined}
            className={`rounded-lg border p-3 ${
              focused ? 'border-blue-400 bg-blue-50/40 ring-1 ring-blue-200' : 'border-slate-200'
            }`}
            onMouseEnter={() => onFocusFailure(failure.id)}
            onFocus={() => onFocusFailure(failure.id)}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">
                {failure.code} <span className="text-xs text-slate-500">· {failure.origin}</span>
              </p>
              {focused ? (
                <span
                  aria-keyshortcuts="C X"
                  className="rounded bg-blue-100 px-2 py-1 font-mono text-[11px] font-medium text-blue-700"
                >
                  C / X
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-600">{failure.message}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {FAILURE_DECISIONS.map((decision) => (
                <button
                  key={decision}
                  type="button"
                  disabled={locked}
                  className={`rounded px-2 py-1 text-xs ${
                    review?.decision === decision
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                  onClick={() => onDecide(failure.id, decision)}
                >
                  {decision.replace('_', ' ')}
                </button>
              ))}
            </div>
            {review ? (
              <input
                className={`${reviewInputClass()} mt-2`}
                placeholder="Decision note"
                value={review.note}
                disabled={locked}
                onChange={(event) => onNote(failure.id, event.target.value)}
              />
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
