import { RUBRIC_VERDICTS, type RubricDefinition, type RubricReview } from '@shared/reviews/types'
import { useState } from 'react'
import { csv, reviewInputClass } from './reviewFormShared'

export interface ReviewRubricSectionProps {
  definitions: readonly RubricDefinition[]
  reviews: readonly RubricReview[]
  locked: boolean
  hasDefinedRubric: boolean
  /** The dimension transcript clicks attach evidence to. */
  focusedDimensionId: string | null
  onFocusDimension: (dimensionId: string) => void
  onMutate: (dimensionId: string, apply: (review: RubricReview) => RubricReview) => void
  onAddDimension: (dimensionId: string) => void
}

export function ReviewRubricSection({
  definitions,
  reviews,
  locked,
  hasDefinedRubric,
  focusedDimensionId,
  onFocusDimension,
  onMutate,
  onAddDimension,
}: ReviewRubricSectionProps) {
  const [customDimension, setCustomDimension] = useState('')
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        pass / fail / skip + critique + evidence. Click a dimension card, then click transcript
        messages to attach evidence.
      </p>
      {definitions.map((definition) => {
        const review = reviews.find((candidate) => candidate.dimensionId === definition.dimensionId)
        if (!review) return null
        const focused = focusedDimensionId === definition.dimensionId
        return (
          <article
            key={definition.dimensionId}
            className={`rounded-lg border p-3 ${
              focused ? 'border-blue-400 bg-blue-50/40 ring-1 ring-blue-200' : 'border-slate-200'
            }`}
            onClick={() => onFocusDimension(definition.dimensionId)}
            onKeyDown={() => onFocusDimension(definition.dimensionId)}
            onFocus={() => onFocusDimension(definition.dimensionId)}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-medium text-slate-800">
                  {definition.label}
                  {focused ? (
                    <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                      evidence target
                    </span>
                  ) : null}
                </h4>
                {definition.description ? (
                  <p className="mt-1 text-xs text-slate-500">{definition.description}</p>
                ) : null}
              </div>
              <fieldset className="flex gap-1">
                <legend className="sr-only">{definition.label} verdict</legend>
                {RUBRIC_VERDICTS.map((verdict) => (
                  <button
                    key={verdict}
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      onMutate(definition.dimensionId, (item) => ({ ...item, verdict }))
                    }
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      review.verdict === verdict
                        ? verdict === 'pass'
                          ? 'bg-emerald-600 text-white'
                          : verdict === 'fail'
                            ? 'bg-red-600 text-white'
                            : 'bg-slate-600 text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {verdict}
                  </button>
                ))}
              </fieldset>
            </div>
            <textarea
              aria-label={`${definition.label} critique`}
              className={`${reviewInputClass()} mt-3 min-h-20 resize-y`}
              placeholder="Critique"
              value={review.critique}
              disabled={locked}
              onChange={(event) =>
                onMutate(definition.dimensionId, (item) => ({
                  ...item,
                  critique: event.target.value,
                }))
              }
            />
            <input
              aria-label={`${definition.label} evidence message ids`}
              className={`${reviewInputClass()} mt-2`}
              placeholder="Evidence message IDs (or click transcript messages)"
              value={review.evidenceMessageIds.join(', ')}
              disabled={locked}
              onChange={(event) =>
                onMutate(definition.dimensionId, (item) => ({
                  ...item,
                  evidenceMessageIds: csv(event.target.value),
                }))
              }
            />
          </article>
        )
      })}
      {!locked && !hasDefinedRubric ? (
        <div className="flex gap-2">
          <input
            className={reviewInputClass()}
            placeholder="Custom rubric dimension ID"
            value={customDimension}
            onChange={(event) => setCustomDimension(event.target.value)}
          />
          <button
            type="button"
            className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
            onClick={() => {
              const dimensionId = customDimension.trim()
              if (!dimensionId || reviews.some((item) => item.dimensionId === dimensionId)) return
              onAddDimension(dimensionId)
              setCustomDimension('')
            }}
          >
            Add
          </button>
        </div>
      ) : null}
      {!locked && hasDefinedRubric ? (
        <p className="text-xs text-slate-500">
          This trace has a fixed rubric. Custom dimensions are disabled so saved reviews match the
          scoring contract.
        </p>
      ) : null}
    </div>
  )
}
