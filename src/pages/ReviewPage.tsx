import {
  type ReviewQueueItem,
  type ReviewQueueResponse,
  type ReviewRecord,
  type ReviewSubject,
  reviewSubjectKey,
} from '@shared/reviews/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchReviewQueue, type ReviewQueueFilters } from '../api/reviews'
import { CalibrationStatsPanel } from '../components/review/CalibrationStatsPanel'
import { ReviewPanel } from '../components/review/ReviewPanel'
import { ReviewQueue } from '../components/review/ReviewQueue'
import {
  calibrationFiltersForQueue,
  reviewQueueFiltersFromSearchParams,
  reviewQueueFiltersToSearchParams,
  reviewQueuePageWindow,
} from '../components/review/reviewQueueState'

export function ReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => reviewQueueFiltersFromSearchParams(searchParams), [searchParams])
  const filtersKey = useMemo(() => reviewQueueFiltersToSearchParams(filters).toString(), [filters])
  const [selected, setSelected] = useState<ReviewSubject | null>(null)
  const [selectedFiltersKey, setSelectedFiltersKey] = useState<string | null>(null)
  const [queueItems, setQueueItems] = useState<readonly ReviewQueueItem[]>([])
  const [queuePage, setQueuePage] = useState<ReviewQueueResponse | null>(null)
  const [queueNotice, setQueueNotice] = useState<string | null>(null)
  const selectedPosition = useRef<{ traceUid: string; offset: number; index: number } | null>(null)
  const expectedFiltersKey = useRef<string | null>(null)
  const observedFiltersKey = useRef(filtersKey)
  const activeFiltersKey = useRef(filtersKey)
  activeFiltersKey.current = filtersKey
  const navigationGuard = useRef<(() => Promise<boolean>) | null>(null)
  const filterNavigationGeneration = useRef(0)
  const externalNavigationGeneration = useRef(0)
  const advancing = useRef(false)
  const advanceGeneration = useRef(0)
  const visibleSelected = selectedFiltersKey === filtersKey ? selected : null

  const clearWorkspace = useCallback(() => {
    advanceGeneration.current += 1
    externalNavigationGeneration.current += 1
    navigationGuard.current = null
    selectedPosition.current = null
    advancing.current = false
    setSelected(null)
    setSelectedFiltersKey(null)
    setQueueItems([])
    setQueuePage(null)
    setQueueNotice(null)
  }, [])

  const updateFilters = useCallback(
    (next: ReviewQueueFilters, navigation: 'replace' | 'push' = 'replace') => {
      const generation = filterNavigationGeneration.current + 1
      filterNavigationGeneration.current = generation
      void (async () => {
        const guard = navigationGuard.current
        if (guard) {
          setQueueNotice('Saving the current draft before changing the queue…')
          if (!(await guard())) {
            if (filterNavigationGeneration.current === generation) {
              setQueueNotice('Queue change cancelled because the current draft could not be saved.')
            }
            return
          }
        }
        if (filterNavigationGeneration.current !== generation) return
        const nextSearch = reviewQueueFiltersToSearchParams(next)
        const nextKey = nextSearch.toString()
        expectedFiltersKey.current = nextKey
        activeFiltersKey.current = nextKey
        clearWorkspace()
        setSearchParams(nextSearch, { replace: navigation === 'replace' })
      })()
    },
    [clearWorkspace, setSearchParams],
  )

  const registerNavigationGuard = useCallback((guard: (() => Promise<boolean>) | null) => {
    navigationGuard.current = guard
  }, [])

  const choose = useCallback(
    (subject: ReviewSubject, index: number, offset: number, selectionKey = filtersKey) => {
      selectedPosition.current = { traceUid: subject.traceUid, offset, index }
      setSelected(subject)
      setSelectedFiltersKey(selectionKey)
      setQueueNotice(null)
    },
    [filtersKey],
  )

  const receiveQueuePage = useCallback((page: ReviewQueueResponse) => {
    setQueueItems(page.items)
    setQueuePage(page)
  }, [])

  const select = useCallback(
    (subject: ReviewSubject) => {
      const index = queueItems.findIndex((item) => item.subject.traceUid === subject.traceUid)
      choose(subject, Math.max(0, index), queuePage?.offset ?? filters.offset ?? 0)
    },
    [choose, filters.offset, queueItems, queuePage?.offset],
  )

  const next = useCallback(async () => {
    const current = visibleSelected
    const position = selectedPosition.current
    if (!current || !position || advancing.current) return
    const generation = advanceGeneration.current + 1
    advanceGeneration.current = generation
    advancing.current = true
    setQueueNotice('Refreshing the queue before advancing…')
    try {
      const fresh = await fetchReviewQueue(filters, { anchorTraceUid: current.traceUid })
      if (advanceGeneration.current !== generation || activeFiltersKey.current !== filtersKey)
        return
      setQueueItems(fresh.items)
      setQueuePage(fresh)
      const currentIndex =
        fresh.anchorFound === true && fresh.anchorIndex !== undefined
          ? fresh.anchorIndex
          : fresh.items.findIndex((item) => item.subject.traceUid === current.traceUid)
      // If saving/submitting removed the selected row, its old index is now
      // occupied by the logical successor. This avoids skipping an entire row
      // when an offset page shifts left.
      const successorIndex = currentIndex >= 0 ? currentIndex + 1 : position.index
      const successor = fresh.items[successorIndex]
      if (successor) {
        if (fresh.offset !== (filters.offset ?? 0)) {
          const anchoredFilters = { ...filters, offset: fresh.offset }
          const anchoredSearch = reviewQueueFiltersToSearchParams(anchoredFilters)
          const anchoredKey = anchoredSearch.toString()
          expectedFiltersKey.current = anchoredKey
          activeFiltersKey.current = anchoredKey
          choose(successor.subject, successorIndex, fresh.offset, anchoredKey)
          setSearchParams(anchoredSearch, { replace: false })
        } else {
          choose(successor.subject, successorIndex, fresh.offset)
        }
        return
      }

      const pageWindow = reviewQueuePageWindow(
        fresh.total,
        fresh.limit,
        fresh.offset,
        fresh.items.length,
      )
      if (pageWindow.hasNext) {
        const nextFilters = { ...filters, offset: pageWindow.nextOffset }
        const nextPage = await fetchReviewQueue(nextFilters)
        if (advanceGeneration.current !== generation || activeFiltersKey.current !== filtersKey) {
          return
        }
        const first = nextPage.items[0]
        if (!first) {
          setQueueNotice('The next page became empty after the queue changed. Try again.')
          return
        }
        const nextSearch = reviewQueueFiltersToSearchParams(nextFilters)
        const nextKey = nextSearch.toString()
        expectedFiltersKey.current = nextKey
        setQueueItems(nextPage.items)
        setQueuePage(nextPage)
        choose(first.subject, 0, nextPage.offset, nextKey)
        setSearchParams(nextSearch, { replace: false })
        return
      }

      if (filters.state === 'unreviewed' || filters.state === 'draft') {
        const firstFilters = { ...filters, offset: 0 }
        const firstPage = fresh.offset === 0 ? fresh : await fetchReviewQueue(firstFilters)
        if (advanceGeneration.current !== generation || activeFiltersKey.current !== filtersKey) {
          return
        }
        const first = firstPage.items[0]
        if (first && first.subject.traceUid !== current.traceUid) {
          if (fresh.offset !== 0) {
            const firstSearch = reviewQueueFiltersToSearchParams(firstFilters)
            const firstKey = firstSearch.toString()
            expectedFiltersKey.current = firstKey
            setSearchParams(firstSearch, { replace: false })
            choose(first.subject, 0, firstPage.offset, firstKey)
          } else {
            choose(first.subject, 0, firstPage.offset)
          }
          setQueueItems(firstPage.items)
          setQueuePage(firstPage)
          return
        }
      }
      setQueueNotice('You reached the end of the current filtered queue.')
    } catch (error) {
      if (advanceGeneration.current !== generation) return
      setQueueNotice(
        `Could not refresh the review queue: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      if (advanceGeneration.current === generation) advancing.current = false
    }
  }, [choose, filters, filtersKey, setSearchParams, visibleSelected])

  const submitted = useCallback((_record: ReviewRecord) => {
    setQueueNotice('Submitted and locked. Review the reveal, then press Alt/Option + ↓ for next.')
  }, [])

  // All URL filters, including offset, are part of the selected workspace
  // identity. Browser back/forward must never retain a stale submit target.
  useEffect(() => {
    if (observedFiltersKey.current === filtersKey) return
    if (expectedFiltersKey.current === filtersKey) {
      observedFiltersKey.current = filtersKey
      expectedFiltersKey.current = null
      return
    }
    expectedFiltersKey.current = null
    const previousFiltersKey = observedFiltersKey.current
    const generation = externalNavigationGeneration.current + 1
    externalNavigationGeneration.current = generation
    const guard = navigationGuard.current
    if (!guard) {
      observedFiltersKey.current = filtersKey
      clearWorkspace()
      return
    }
    setQueueNotice('Saving the current draft before changing the queue…')
    void guard().then((saved) => {
      if (externalNavigationGeneration.current !== generation) return
      if (saved) {
        observedFiltersKey.current = filtersKey
        clearWorkspace()
        return
      }
      activeFiltersKey.current = previousFiltersKey
      setSearchParams(new URLSearchParams(previousFiltersKey), { replace: true })
      setQueueNotice('Navigation cancelled because the current draft could not be saved.')
    })
  }, [clearWorkspace, filtersKey, setSearchParams])

  return (
    <main className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto mb-4 flex max-w-[1600px] items-center gap-3">
        <Link to="/" className="text-xs text-blue-600 hover:underline">
          ← Traces
        </Link>
        <Link to="/ace" className="text-xs text-blue-600 hover:underline">
          ACE runs
        </Link>
        <h1 className="text-base font-semibold text-slate-900">Human review workspace</h1>
      </div>
      <div className="mx-auto grid max-w-[1600px] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <ReviewQueue
            filters={filters}
            selectedTraceUid={visibleSelected?.traceUid}
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
              onNavigationGuardChange={registerNavigationGuard}
              suspended={!visibleSelected}
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
