import type {
  AutomaticRubricVerdict,
  JudgeDimensionReview,
  JudgeReviewDecision,
} from '@shared/reviews/types'

const DECISIONS: ReadonlyArray<{ value: JudgeReviewDecision; label: string; active: string }> = [
  { value: 'agree', label: 'Agree', active: 'bg-emerald-600 text-white border-emerald-600' },
  { value: 'disagree', label: 'Disagree', active: 'bg-red-600 text-white border-red-600' },
  { value: 'unsure', label: 'Unsure', active: 'bg-amber-500 text-white border-amber-500' },
]

const DISAGREE_PLACEHOLDER =
  'Where did the judge go wrong: cited nonexistent evidence? Misread policy? Missed a message?'

/**
 * How the Details accordion treats judge calibration: leading section when
 * the trace carries judge output, an explicit "judge was off" note when
 * automatic context exists without judge verdicts (silence would read as data
 * loss), and nothing while automatic context is still hidden (blind mode).
 */
export function judgeReviewMode(automatic?: {
  judgeVerdicts?: Record<string, unknown>
}): 'review' | 'off-note' | 'hidden' {
  if (automatic?.judgeVerdicts && Object.keys(automatic.judgeVerdicts).length > 0) return 'review'
  return automatic ? 'off-note' : 'hidden'
}

export function ReviewJudgeOffNote() {
  return (
    <p
      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500"
      data-testid="review-judge-off-note"
    >
      LLM judge was off for this run (launch batches with{' '}
      <code className="rounded bg-slate-100 px-1">--judge all</code> /{' '}
      <code className="rounded bg-slate-100 px-1">sample</code>). Judge verdicts are the primary
      object of human review — prefer annotating on judge-enabled batches.
    </p>
  )
}

function verdictBadge(verdict: string): string {
  if (verdict === 'pass') return 'bg-emerald-100 text-emerald-800'
  if (verdict === 'fail') return 'bg-red-100 text-red-800'
  return 'bg-slate-100 text-slate-600'
}

/**
 * Judge calibration is the primary job of human review: per judge dimension,
 * read the LLM judge's verdict and evidence, then record whether the judge
 * was right — with one line on where it went wrong when it wasn't.
 */
export function ReviewJudgeSection({
  judgeVerdicts,
  reviews,
  locked,
  onDecide,
  onNote,
}: {
  judgeVerdicts: Record<string, AutomaticRubricVerdict>
  reviews: Record<string, JudgeDimensionReview>
  locked: boolean
  onDecide: (dimension: string, decision: JudgeReviewDecision) => void
  onNote: (dimension: string, note: string) => void
}) {
  const dimensions = Object.entries(judgeVerdicts)
  return (
    <div className="space-y-3" data-testid="review-judge-section">
      <p className="text-xs text-slate-500">
        Calibrate the LLM judge: for each dimension, is its verdict right? Your labels feed the
        judge agreement statistics; the judge itself never gates the outcome.
      </p>
      {dimensions.map(([dimension, verdict]) => {
        const review = reviews[dimension]
        return (
          <div
            key={dimension}
            className="rounded-lg border border-slate-200 p-3"
            data-testid={`review-judge-${dimension}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <b className="font-mono text-xs text-slate-800">{dimension}</b>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${verdictBadge(verdict.verdict)}`}
              >
                judge: {verdict.verdict}
              </span>
              <div className="ml-auto flex gap-1">
                {DECISIONS.map((decision) => (
                  <button
                    key={decision.value}
                    type="button"
                    data-testid={`review-judge-${dimension}-${decision.value}`}
                    disabled={locked}
                    onClick={() => onDecide(dimension, decision.value)}
                    className={`rounded border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                      review?.decision === decision.value
                        ? decision.active
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {decision.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">
              {verdict.critique?.trim() || 'The judge recorded no evidence for this dimension.'}
            </p>
            <input
              type="text"
              data-testid={`review-judge-${dimension}-note`}
              disabled={locked}
              value={review?.note ?? ''}
              onChange={(event) => onNote(dimension, event.target.value)}
              placeholder={
                review?.decision === 'disagree' ? DISAGREE_PLACEHOLDER : 'Optional note'
              }
              className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400 disabled:bg-slate-50"
            />
          </div>
        )
      })}
    </div>
  )
}
