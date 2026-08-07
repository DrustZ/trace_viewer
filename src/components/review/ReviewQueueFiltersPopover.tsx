import { useEffect, useState } from 'react'
import type { ReviewQueueFilters } from '../../api/reviews'
import { ReviewFilterPresets } from './ReviewFilterPresets'
import { activeReviewQueueFilterCount, patchReviewQueueFilters } from './reviewQueueState'

export interface ReviewQueueFiltersPopoverProps {
  filters: ReviewQueueFilters
  onSetFilters: (
    update: (previous: ReviewQueueFilters) => ReviewQueueFilters,
    navigation?: 'replace' | 'push',
  ) => void
  /** Render expanded on mount (used by tests; the button still toggles). */
  defaultOpen?: boolean
}

function selectClass(): string {
  return 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800'
}

/**
 * Every queue filter control lives in this popover so the sidebar itself is
 * just the full-height list. Each edit merges into the previous filters
 * (patchReviewQueueFilters), so no other URL parameter is ever dropped.
 */
export function ReviewQueueFiltersPopover({
  filters,
  onSetFilters,
  defaultOpen = false,
}: ReviewQueueFiltersPopoverProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState(filters.q ?? '')
  const activeCount = activeReviewQueueFilterCount(filters)

  useEffect(() => {
    setQuery(filters.q ?? '')
  }, [filters.q])

  const patch = (partial: Partial<ReviewQueueFilters>) => {
    onSetFilters((previous) => patchReviewQueueFilters(previous, partial))
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
          open
            ? 'border-slate-700 bg-slate-700 text-white'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
        }`}
        onClick={() => setOpen((previous) => !previous)}
      >
        Filters
        {activeCount > 0 ? (
          <span
            className={`rounded-full px-1.5 text-[11px] ${
              open ? 'bg-white text-slate-700' : 'bg-slate-900 text-white'
            }`}
          >
            {activeCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close filters"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <section
            role="dialog"
            aria-label="Review queue filters"
            className="absolute left-0 z-20 mt-1.5 w-80 space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false)
            }}
          >
            <div className="flex rounded-md border border-slate-300 p-0.5">
              {(['calibration', 'assisted'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() =>
                    patch({
                      mode,
                      runId: mode === 'calibration' ? undefined : filters.runId,
                    })
                  }
                  className={`flex-1 rounded px-2 py-1 text-xs ${
                    filters.mode === mode ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                patch({ q: query.trim() || undefined })
              }}
            >
              <input
                aria-label="Search reviews"
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
                value={query}
                placeholder="Trace, issue, language, tag…"
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-3 py-2 text-xs text-white"
              >
                Filter
              </button>
            </form>
            <div className="grid grid-cols-1 gap-2">
              <select
                aria-label="Review corpus"
                className={selectClass()}
                value={filters.corpusId ?? ''}
                onChange={(event) => patch({ corpusId: event.target.value || undefined })}
              >
                <option value="ace">ACE · all</option>
                <option value="production">Production</option>
                <option value="simulation">Simulation</option>
                <option value="">All data</option>
              </select>
              <select
                aria-label="Review state"
                className={selectClass()}
                value={filters.state ?? ''}
                onChange={(event) =>
                  patch({
                    state: (event.target.value || undefined) as ReviewQueueFilters['state'],
                  })
                }
              >
                <option value="">All states</option>
                <option value="unreviewed">Unreviewed</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
              </select>
              <select
                aria-label="Review priority"
                className={selectClass()}
                value={filters.priority ?? ''}
                onChange={(event) =>
                  patch({
                    priority: (event.target.value || undefined) as ReviewQueueFilters['priority'],
                  })
                }
              >
                <option value="">All priorities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="none">None</option>
              </select>
              <label className="text-xs font-medium text-slate-600">
                Annotator
                <input
                  aria-label="Annotator"
                  className={`${selectClass()} mt-1`}
                  value={filters.annotator}
                  onChange={(event) => patch({ annotator: event.target.value })}
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Rubric version
                <input
                  aria-label="Rubric version"
                  className={`${selectClass()} mt-1`}
                  value={filters.rubricVersion}
                  onChange={(event) => patch({ rubricVersion: event.target.value })}
                />
              </label>
              {filters.mode === 'assisted' ? (
                <input
                  aria-label="Run ID"
                  className={selectClass()}
                  value={filters.runId ?? ''}
                  placeholder="Run ID (optional)"
                  onChange={(event) => patch({ runId: event.target.value.trim() || undefined })}
                />
              ) : (
                <div className={`${selectClass()} text-xs text-violet-700`}>
                  Run/arm hidden in Calibration
                </div>
              )}
            </div>
            <ReviewFilterPresets
              filters={filters}
              onApply={(presetFilters) => onSetFilters(() => presetFilters)}
            />
            <p className="text-[11px] text-slate-500">
              The page URL is the current filter source of truth, so this queue can be bookmarked
              or shared.
            </p>
          </section>
        </>
      ) : null}
    </div>
  )
}
