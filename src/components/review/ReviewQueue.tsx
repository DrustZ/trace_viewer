import type { ReviewQueueItem, ReviewQueueResponse, ReviewSubject } from '@shared/reviews/types'
import { useCallback, useEffect, useState } from 'react'
import { type ReviewQueueFilters, useReviewQueue } from '../../api/reviews'
import { ReviewQueueFiltersPopover } from './ReviewQueueFiltersPopover'
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
  onFiltersChange?: (filters: ReviewQueueFilters, navigation?: 'replace' | 'push') => void
  onItemsChange?: (items: readonly ReviewQueueItem[]) => void
  onPageDataChange?: (page: ReviewQueueResponse) => void
  onSelect?: (subject: ReviewSubject, item: ReviewQueueItem) => void
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

/** Everything beyond state/priority/disagreement moves into the row tooltip. */
export function reviewQueueItemTooltip(item: ReviewQueueItem): string | undefined {
  const parts = [
    item.rootCauseTags.length > 0 ? `tags: ${item.rootCauseTags.join(', ')}` : undefined,
    item.automatic?.outcome ? `outcome: ${item.automatic.outcome}` : undefined,
    item.automatic?.detectorAnalysis?.status === 'unavailable'
      ? 'detectors unavailable'
      : undefined,
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : undefined
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
  const queue = useReviewQueue(filters)

  const setFilters = useCallback(
    (
      update: (previous: ReviewQueueFilters) => ReviewQueueFilters,
      navigation: 'replace' | 'push' = 'replace',
    ): void => {
      const next = update(filters)
      if (controlledFilters === undefined) setUncontrolledFilters(next)
      onFiltersChange?.(next, navigation)
    },
    [controlledFilters, filters, onFiltersChange],
  )

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
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white ${className}`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 p-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Review queue</h2>
          <p className="text-xs text-slate-500">
            {queue.data ? `${queue.data.total} traces · ${filters.mode}` : 'Loading…'}
          </p>
        </div>
        <ReviewQueueFiltersPopover filters={filters} onSetFilters={setFilters} />
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
      <ol
        aria-busy={queue.isFetching}
        className="max-h-[calc(100vh-13rem)] min-h-0 flex-1 divide-y divide-slate-100 overflow-auto"
      >
        {queue.data?.items.map((item) => (
          <li key={`${item.subject.traceUid}:${item.subject.mode}`}>
            <button
              type="button"
              aria-pressed={selectedTraceUid === item.subject.traceUid}
              title={reviewQueueItemTooltip(item)}
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
              {item.priority !== 'none' || item.hasDisagreement ? (
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
                </div>
              ) : null}
            </button>
          </li>
        ))}
      </ol>
      {queue.data ? (
        <ReviewQueuePagination
          page={queue.data}
          disabled={queue.isFetching}
          onPrevious={(offset) => setFilters((previous) => ({ ...previous, offset }), 'push')}
          onNext={(offset) => setFilters((previous) => ({ ...previous, offset }), 'push')}
        />
      ) : null}
    </section>
  )
}
