import type { AutomaticReviewContext } from '@shared/reviews/types'

export interface ReviewAutomaticSectionProps {
  automatic: AutomaticReviewContext
}

export function ReviewAutomaticSection({ automatic }: ReviewAutomaticSectionProps) {
  return (
    <div className="space-y-2">
      {automatic.detectorAnalysis?.status === 'unavailable' ? (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
        >
          Canonical production detector analysis is unavailable ({automatic.detectorAnalysis.reason}
          ). Assisted draft decisions and submission are blocked until the local analysis succeeds.
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {automatic.model ? (
          <>
            <dt className="text-slate-500">Model</dt>
            <dd className="text-right text-slate-800">{automatic.model}</dd>
          </>
        ) : null}
        {automatic.arm ? (
          <>
            <dt className="text-slate-500">A/B arm</dt>
            <dd className="text-right text-slate-800">{automatic.arm}</dd>
          </>
        ) : null}
        {automatic.outcome ? (
          <>
            <dt className="text-slate-500">Outcome</dt>
            <dd className="text-right text-slate-800">{automatic.outcome}</dd>
          </>
        ) : null}
      </dl>
      {automatic.judgeVerdicts ? (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(automatic.judgeVerdicts).map(([dimension, verdict]) => (
            <span
              key={dimension}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
            >
              {dimension}: {verdict.verdict}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
