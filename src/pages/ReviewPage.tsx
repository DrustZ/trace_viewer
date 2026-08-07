import {
  type ReviewQueueItem,
  type ReviewQueueResponse,
  type ReviewRecord,
  type ReviewSubject,
  reviewSubjectKey,
} from '@shared/reviews/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchReviewQueue, type ReviewQueueFilters } from '../api/reviews'
import { CalibrationStatsPanel } from '../components/review/CalibrationStatsPanel'
import { type ReviewNavigationGuard, ReviewPanel } from '../components/review/ReviewPanel'
import { ReviewQueue } from '../components/review/ReviewQueue'
import { rootCauseTagSuggestions } from '../components/review/reviewPayloadOps'
import {
  calibrationFiltersForQueue,
  reviewQueueCursorTarget,
  reviewQueueFiltersFromSearchParams,
  reviewQueueFiltersToSearchParams,
  reviewQueuePageWindow,
} from '../components/review/reviewQueueState'

/**
 * The workspace is a plain cursor over the loaded queue page: Next/Prev move
 * inside the in-memory list immediately, and only a page boundary (or a
 * vanished current row) refetches the current filters and clamps.
 */
export function ReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => reviewQueueFiltersFromSearchParams(searchParams), [searchParams])
  const scopeKey = useMemo(() => {
    const scope = reviewQueueFiltersToSearchParams(filters)
    scope.delete('offset')
    return scope.toString()
  }, [filters])
  const [selected, setSelected] = useState<ReviewSubject | null>(null)
  const [queueItems, setQueueItems] = useState<readonly ReviewQueueItem[]>([])
  const [queuePage, setQueuePage] = useState<ReviewQueueResponse | null>(null)
  const [queueNotice, setQueueNotice] = useState<string | null>(null)
  const navigationGuard = useRef<ReviewNavigationGuard | null>(null)
  const moving = useRef(false)
  // Freezes the panel while a move persists the draft / fetches the adjacent
  // page — keystrokes typed in that window would be silently discarded by the
  // post-navigation remount otherwise.
  const [movePending, setMovePending] = useState(false)
  const observedScopeKey = useRef(scopeKey)

  // Changing anything but the page offset re-scopes the queue; the previous
  // selection no longer belongs to it.
  useEffect(() => {
    if (observedScopeKey.current === scopeKey) return
    observedScopeKey.current = scopeKey
    setSelected(null)
    setQueueNotice(null)
  }, [scopeKey])

  const updateFilters = useCallback(
    (next: ReviewQueueFilters, navigation: 'replace' | 'push' = 'replace') => {
      // Persist the open draft in the background; autosave already covers the
      // common case, so filter changes never block on the network.
      const guard = navigationGuard.current
      if (guard) {
        void guard().then((saved) => {
          if (!saved) {
            setQueueNotice(
              'The previous draft could not be saved before the queue changed; reopen its trace to retry.',
            )
          }
        })
      }
      setSearchParams(reviewQueueFiltersToSearchParams(next), {
        replace: navigation === 'replace',
      })
    },
    [setSearchParams],
  )

  const registerNavigationGuard = useCallback((guard: ReviewNavigationGuard | null) => {
    navigationGuard.current = guard
  }, [])

  const receiveQueuePage = useCallback((page: ReviewQueueResponse) => {
    setQueueItems(page.items)
    setQueuePage(page)
  }, [])

  const select = useCallback((subject: ReviewSubject) => {
    setSelected(subject)
    setQueueNotice(null)
  }, [])

  const move = useCallback(
    async (delta: 1 | -1, persistCurrent: ReviewNavigationGuard) => {
      if (moving.current) return
      moving.current = true
      setMovePending(true)
      try {
        if (!(await persistCurrent())) {
          setQueueNotice('Navigation cancelled because the current draft could not be saved.')
          return
        }
        // Instant path: the target is already on the loaded page.
        const local = reviewQueueCursorTarget(queueItems, selected?.traceUid, delta)
        if (local.subject) {
          setSelected(local.subject)
          setQueueNotice(null)
          return
        }
        if (local.reason === 'empty') {
          setQueueNotice('No traces match this queue.')
          return
        }
        // Page boundary: hop to the adjacent page, or refetch this page and
        // clamp when the totals shifted underneath us.
        const window = queuePage
          ? reviewQueuePageWindow(
              queuePage.total,
              queuePage.limit,
              queuePage.offset,
              queuePage.items.length,
            )
          : null
        const nextOffset =
          delta === 1
            ? window?.hasNext
              ? window.nextOffset
              : undefined
            : window?.hasPrevious
              ? window.previousOffset
              : undefined
        if (nextOffset === undefined) {
          const fresh = await fetchReviewQueue(filters)
          setQueueItems(fresh.items)
          setQueuePage(fresh)
          const retry = reviewQueueCursorTarget(fresh.items, selected?.traceUid, delta)
          if (retry.subject) {
            setSelected(retry.subject)
            setQueueNotice(null)
            return
          }
          setQueueNotice(
            delta === 1
              ? 'You reached the end of the current filtered queue.'
              : 'You reached the start of the current filtered queue.',
          )
          return
        }
        const fresh = await fetchReviewQueue({ ...filters, offset: nextOffset })
        setQueueItems(fresh.items)
        setQueuePage(fresh)
        const target = delta === 1 ? fresh.items[0] : fresh.items[fresh.items.length - 1]
        if (!target) {
          setQueueNotice('The adjacent queue page is empty; adjust the filters to continue.')
          return
        }
        setSelected(target.subject)
        setQueueNotice(null)
        setSearchParams(reviewQueueFiltersToSearchParams({ ...filters, offset: fresh.offset }), {
          replace: false,
        })
      } catch (error) {
        setQueueNotice(
          `Could not refresh the review queue: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      } finally {
        moving.current = false
        setMovePending(false)
      }
    },
    [filters, queueItems, queuePage, selected?.traceUid, setSearchParams],
  )

  const next = useCallback(
    (persistCurrent: ReviewNavigationGuard) => move(1, persistCurrent),
    [move],
  )
  const prev = useCallback(
    (persistCurrent: ReviewNavigationGuard) => move(-1, persistCurrent),
    [move],
  )

  const submitted = useCallback((_record: ReviewRecord) => {
    setQueueNotice('Submitted and locked. Review the reveal, then press Alt/Option + ↓ for next.')
  }, [])

  const tagSuggestions = useMemo(() => rootCauseTagSuggestions(queueItems), [queueItems])

  return (
    <main className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto mb-4 flex max-w-[1600px] items-center gap-3">
        <h1 className="text-base font-semibold text-slate-900">Human review workspace</h1>
      </div>
      <div className="mx-auto grid max-w-[1600px] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <ReviewQueue
            filters={filters}
            selectedTraceUid={selected?.traceUid}
            onFiltersChange={updateFilters}
            onPageDataChange={receiveQueuePage}
            onSelect={select}
          />
          <CalibrationStatsPanel filters={calibrationFiltersForQueue(filters)} />
        </div>
        <div className="space-y-3">
          {queueNotice ? (
            <p
              aria-live="polite"
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800"
            >
              {queueNotice}
            </p>
          ) : null}
          {selected ? (
            <ReviewPanel
              key={reviewSubjectKey(selected)}
              subject={selected}
              onSubmitted={submitted}
              onNext={next}
              onPrev={prev}
              onNavigationGuardChange={registerNavigationGuard}
              suspended={movePending}
              rootCauseTagSuggestions={tagSuggestions}
            />
          ) : (
            <section className="flex min-h-96 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
              Select a trace to start human review.
            </section>
          )}
        </div>
      </div>
    </main>
  )
}
