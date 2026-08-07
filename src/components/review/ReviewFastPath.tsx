import type { ReviewVerdict } from '@shared/reviews/types'
import { reviewInputClass } from './reviewFormShared'

export interface ReviewFastPathProps {
  verdict: ReviewVerdict
  note: string
  locked: boolean
  dirty: boolean
  saving: boolean
  submitting: boolean
  errorText?: string | null
  /** Locked assisted reviews may start the next revision. */
  canStartRevision: boolean
  nextRevision: number
  onVerdict: (verdict: ReviewVerdict) => void
  onNote: (note: string) => void
  onSave: () => void
  onSubmit: () => void
  onStartRevision: () => void
  onPrev?: () => void
  onNext?: () => void
}

const FAST_VERDICTS: ReadonlyArray<{
  value: ReviewVerdict
  label: string
  keys: string
  active: string
}> = [
  { value: 'pass', label: 'Pass', keys: 'P', active: 'border-emerald-600 bg-emerald-600 text-white' },
  { value: 'fail', label: 'Fail', keys: 'F', active: 'border-red-600 bg-red-600 text-white' },
  { value: 'unsure', label: 'Unsure', keys: 'U', active: 'border-slate-700 bg-slate-700 text-white' },
]

/**
 * The default review screen: one question (overall verdict), one note, and
 * navigation. Everything else lives in the collapsed Details accordion.
 */
export function ReviewFastPath({
  verdict,
  note,
  locked,
  dirty,
  saving,
  submitting,
  errorText,
  canStartRevision,
  nextRevision,
  onVerdict,
  onNote,
  onSave,
  onSubmit,
  onStartRevision,
  onPrev,
  onNext,
}: ReviewFastPathProps) {
  return (
    <section aria-label="Review fast path" className="space-y-3">
      <div role="group" aria-label="Overall verdict" className="grid grid-cols-3 gap-2">
        {FAST_VERDICTS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={locked}
            aria-pressed={verdict === option.value}
            aria-keyshortcuts={option.keys}
            onClick={() => onVerdict(option.value)}
            className={`rounded-lg border px-3 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
              verdict === option.value
                ? option.active
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {option.label}
            <span className="ml-1.5 hidden font-mono text-[11px] font-normal opacity-70 sm:inline">
              {option.keys}
            </span>
          </button>
        ))}
      </div>

      <label className="block text-xs font-medium text-slate-600">
        Overall note
        <textarea
          className={`${reviewInputClass()} mt-1 min-h-16 resize-y`}
          placeholder="Why? One or two sentences is enough. ⌘/Ctrl Enter submits."
          value={note}
          disabled={locked}
          onChange={(event) => onNote(event.target.value)}
        />
      </label>

      {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}

      <footer className="flex flex-wrap items-center justify-between gap-2">
        <span aria-live="polite" className="text-xs text-slate-500">
          {locked ? 'Locked' : saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Draft saved'}
        </span>
        <div className="flex flex-wrap gap-2">
          {onPrev ? (
            <button
              type="button"
              aria-keyshortcuts="Alt+ArrowUp"
              title="Previous queue item (Alt/Option ↑)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
              onClick={onPrev}
            >
              ← Prev
            </button>
          ) : null}
          {onNext ? (
            <button
              type="button"
              aria-keyshortcuts="Alt+ArrowDown"
              title="Next queue item (Alt/Option ↓)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
              onClick={onNext}
            >
              Next →
            </button>
          ) : null}
          {canStartRevision ? (
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
              onClick={onStartRevision}
            >
              Start revision {nextRevision}
            </button>
          ) : null}
          {!locked ? (
            <>
              <button
                type="button"
                aria-keyshortcuts="Control+S Meta+S"
                disabled={saving}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
                onClick={onSave}
              >
                Save draft
              </button>
              <button
                type="button"
                aria-keyshortcuts="Control+Enter Meta+Enter"
                disabled={submitting}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={onSubmit}
              >
                {submitting ? 'Submitting…' : 'Submit & lock'}
              </button>
            </>
          ) : null}
        </div>
      </footer>
    </section>
  )
}
