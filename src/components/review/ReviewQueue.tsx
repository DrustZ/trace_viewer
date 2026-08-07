import type { ReviewQueueItem, ReviewQueueResponse, ReviewSubject } from '@shared/reviews/types'
import { useCallback, useEffect, useState } from 'react'
import { type ReviewQueueFilters, useReviewQueue } from '../../api/reviews'
import { ReviewFilterPresets } from './ReviewFilterPresets'
import {
  DEFAULT_REVIEW_QUEUE_FILTERS,
  normalizedReviewQueueOffset,
  reviewQueuePageWindow,
} from './reviewQueueState'

export interface ReviewQueueProps {
  initialFilters?: Partial<ReviewQueueFilters>
  filters?: ReviewQueueFilters
  selectedTraceUid?: string
  className?: string
  onFiltersChange?: (filters: ReviewQueueFilters) => void
  onItemsChange?: (items: readonly ReviewQueueItem[]) => void
  onPageDataChange?: (page: ReviewQueueResponse) => void
  onSelect?: (subject: ReviewSubject, item: ReviewQueueItem) => void
}

function selectClass(): string {
  return 'rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800'
}

export function ReviewQueuePagination({
  page,
  disabled = false,
  onPrevious,
  onNext,
}: {
  page: ReviewQueueResponse
  disabled?: boolean
  onPrevious: (offset: number) => void
  onNext: (offset: number) => void
}) {
  const window = reviewQueuePageWindow(page.total, page.limit, page.offset, page.items.length)
  const range = window.start === 0 ? '0' : `${window.start}–${window.end}`
  return (
    <nav
      aria-label="Review queue pages"
      className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-2"
    >
      <p aria-live="polite" className="text-xs text-slate-500">
        Showing {range} of {window.total}
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          aria-label="Previous review page"
          disabled={disabled || !window.hasPrevious}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 disabled:opacity-40"
          onClick={() => onPrevious(window.previousOffset)}
        >
          Previous
        </button>
        <button
          type="button"
          aria-label="Next review page"
          disabled={disabled || !window.hasNext}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 disabled:opacity-40"
          onClick={() => onNext(window.nextOffset)}
        >
          Next
        </button>
      </div>
    </nav>
  )
}

export function ReviewQueue({
  initialFilters,
  filters: controlledFilters,
  selectedTraceUid,
  className = '',
  onFiltersChange,
  onItemsChange,
  onPageDataChange,
  onSelect,
}: ReviewQueueProps) {
  const [uncontrolledFilters, setUncontrolledFilters] = useState<ReviewQueueFilters>({
    ...DEFAULT_REVIEW_QUEUE_FILTERS,
    ...initialFilters,
  })
  const filters = controlledFilters ?? uncontrolledFilters
  const [query, setQuery] = useState(filters.q ?? '')
  const queue = useReviewQueue(filters)

  const setFilters = useCallback(
    (update: (previous: ReviewQueueFilters) => ReviewQueueFilters): void => {
      const next = update(filters)
      if (controlledFilters === undefined) setUncontrolledFilters(next)
      onFiltersChange?.(next)
    },
    [controlledFilters, filters, onFiltersChange],
  )

  useEffect(() => {
    setQuery(filters.q ?? '')
  }, [filters.q])

  useEffect(() => {
    const page = queue.data
    if (!page) return
    const requestedOffset = filters.offset ?? 0
    if (page.offset !== requestedOffset) return
    const normalizedOffset = normalizedReviewQueueOffset(page.total, page.limit, requestedOffset)
    if (normalizedOffset !== requestedOffset) {
      setFilters((previous) => ({ ...previous, offset: normalizedOffset }))
      return
    }
    onItemsChange?.(page.items)
    onPageDataChange?.(page)
  }, [filters.offset, onItemsChange, onPageDataChange, queue.data, setFilters])

  return (
    <section className={`overflow-hidden rounded-xl border border-slate-200 bg-white ${className}`}>
      <header className="space-y-3 border-b border-slate-200 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Review queue</h2>
            <p className="text-xs text-slate-500">
              {queue.data ? `${queue.data.total} traces` : 'Loading…'}
            </p>
          </div>
          <div className="flex rounded-md border border-slate-300 p-0.5">
            {(['calibration', 'assisted'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() =>
                  setFilters((previous) => ({
                    ...previous,
                    mode,
                    runId: mode === 'calibration' ? undefined : previous.runId,
                    offset: 0,
                  }))
                }
                className={`rounded px-2 py-1 text-xs ${
                  filters.mode === mode ? 'bg-slate-900 text-white' : 'text-slate-600'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            setFilters((previous) => ({ ...previous, q: query.trim() || undefined, offset: 0 }))
          }}
        >
          <input
            aria-label="Search reviews"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
            value={query}
            placeholder="Trace, issue, language, tag…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-xs text-white">
            Filter
          </button>
        </form>
        <div className="grid grid-cols-3 gap-2">
          <select
            aria-label="Review corpus"
            className={selectClass()}
            value={filters.corpusId ?? ''}
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                corpusId: event.target.value || undefined,
                offset: 0,
              }))
            }
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
              setFilters((previous) => ({
                ...previous,
                state: (event.target.value || undefined) as ReviewQueueFilters['state'],
                offset: 0,
              }))
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
              setFilters((previous) => ({
                ...previous,
                priority: (event.target.value || undefined) as ReviewQueueFilters['priority'],
                offset: 0,
              }))
            }
          >
            <option value="">All priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="none">None</option>
          </select>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            aria-label="Annotator"
            className={selectClass()}
            value={filters.annotator}
            onChange={(event) =>
              setFilters((previous) => ({ ...previous, annotator: event.target.value, offset: 0 }))
            }
          />
          <input
            aria-label="Rubric version"
            className={selectClass()}
            value={filters.rubricVersion}
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                rubricVersion: event.target.value,
                offset: 0,
              }))
            }
          />
          {filters.mode === 'assisted' ? (
            <input
              aria-label="Run ID"
              className={selectClass()}
              value={filters.runId ?? ''}
              placeholder="Run ID (optional)"
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  runId: event.target.value.trim() || undefined,
                  offset: 0,
                }))
              }
            />
          ) : (
            <div className={`${selectClass()} text-xs text-violet-700`}>
              Run/arm hidden in Calibration
            </div>
          )}
        </div>
        <ReviewFilterPresets
          filters={filters}
          onApply={(presetFilters) => setFilters(() => presetFilters)}
        />
        <p className="text-[11px] text-slate-500">
          The page URL is the current filter source of truth, so this queue can be bookmarked or
          shared.
        </p>
      </header>

      {queue.error ? (
        <p className="p-4 text-sm text-red-600">
          Failed to load queue:{' '}
          {queue.error instanceof Error ? queue.error.message : String(queue.error)}
        </p>
      ) : null}
      {!queue.isLoading && queue.data?.items.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">No traces match this queue.</p>
      ) : null}
      <ol className="max-h-[calc(100vh-18rem)] divide-y divide-slate-100 overflow-auto">
        {queue.data?.items.map((item) => (
          <li key={`${item.subject.traceUid}:${item.subject.mode}`}>
            <button
              type="button"
              onClick={() => onSelect?.(item.subject, item)}
              className={`w-full p-3 text-left hover:bg-slate-50 ${
                selectedTraceUid === item.subject.traceUid ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-800">
                  {item.trace.title ?? item.trace.sourceTraceId}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
                    item.state === 'submitted'
                      ? 'bg-emerald-100 text-emerald-700'
                      : item.state === 'draft'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {item.state}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">
                {[item.trace.issue, item.trace.language, item.trace.instanceId]
                  .filter(Boolean)
                  .join(' · ') || item.subject.runId}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                {item.priority !== 'none' ? (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                    {item.priority}
                  </span>
                ) : null}
                {item.hasDisagreement ? (
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-700">
                    disagreement
                  </span>
                ) : null}
                {item.rootCauseTags.map((tag) => (
                  <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                    {tag}
                  </span>
                ))}
                {item.automatic?.outcome ? (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                    {item.automatic.outcome}
                  </span>
                ) : null}
                {item.automatic?.detectorAnalysis?.status === 'unavailable' ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                    detectors unavailable
                  </span>
                ) : null}
              </div>
            </button>
          </li>
        ))}
      </ol>
      {queue.data ? (
        <ReviewQueuePagination
          page={queue.data}
          disabled={queue.isFetching}
          onPrevious={(offset) => setFilters((previous) => ({ ...previous, offset }))}
          onNext={(offset) => setFilters((previous) => ({ ...previous, offset }))}
        />
      ) : null}
    </section>
  )
}
