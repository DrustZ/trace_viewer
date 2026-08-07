import { REVIEW_PRIORITIES, type ReviewPriority, type ReviewStatus } from '@shared/reviews/types'
import { useId, useState } from 'react'
import { reviewInputClass } from './reviewFormShared'

export interface ReviewStatusSectionProps {
  reviewStatus: ReviewStatus
  priority: ReviewPriority
  rootCauseTags: readonly string[]
  /** Historical tags aggregated from the loaded review queue. */
  tagSuggestions: readonly string[]
  locked: boolean
  onStatus: (status: ReviewStatus) => void
  onPriority: (priority: ReviewPriority) => void
  onTags: (tags: string[]) => void
}

const VISIBLE_SUGGESTIONS = 8

/**
 * Manual overrides that left the first screen: reviewStatus (submit sets
 * `reviewed` automatically), priority (defaults to none), and root-cause tags
 * with datalist + chip completion from historical queue tags.
 */
export function ReviewStatusSection({
  reviewStatus,
  priority,
  rootCauseTags,
  tagSuggestions,
  locked,
  onStatus,
  onPriority,
  onTags,
}: ReviewStatusSectionProps) {
  const [draftTag, setDraftTag] = useState('')
  const datalistId = useId()

  const addTag = (raw: string) => {
    const tag = raw.trim()
    if (!tag || rootCauseTags.includes(tag)) return
    onTags([...rootCauseTags, tag])
    setDraftTag('')
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600">
          Review status
          <select
            className={`${reviewInputClass()} mt-1`}
            value={reviewStatus}
            disabled={locked}
            onChange={(event) => onStatus(event.target.value as ReviewStatus)}
          >
            <option value="in_review">in review</option>
            <option value="reviewed">reviewed</option>
            <option value="skipped">skipped</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Priority
          <select
            className={`${reviewInputClass()} mt-1`}
            value={priority}
            disabled={locked}
            onChange={(event) => onPriority(event.target.value as ReviewPriority)}
          >
            {REVIEW_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="text-xs font-medium text-slate-600">
        Root-cause tags
        {rootCauseTags.length > 0 ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {rootCauseTags.map((tag) => (
              <li
                key={tag}
                className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-700"
              >
                {tag}
                {!locked ? (
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    className="text-slate-500 hover:text-red-600"
                    onClick={() => onTags(rootCauseTags.filter((item) => item !== tag))}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {!locked ? (
          <>
            <input
              aria-label="Add root-cause tag"
              className={`${reviewInputClass()} mt-1.5`}
              list={datalistId}
              placeholder="Type a tag and press Enter…"
              value={draftTag}
              onChange={(event) => setDraftTag(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault()
                  addTag(draftTag)
                }
              }}
              onBlur={() => addTag(draftTag)}
            />
            <datalist id={datalistId}>
              {tagSuggestions.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
            {tagSuggestions.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tagSuggestions.slice(0, VISIBLE_SUGGESTIONS).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-600 hover:bg-slate-50"
                    onClick={() => addTag(tag)}
                  >
                    + {tag}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
