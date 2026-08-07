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
  const [navigationPending, setNavigationPending] = useState(false)
  const selectedPosition = useRef<{
    traceUid: string
    offset: number
    index: number
    successor?: ReviewSubject
  } | null>(null)
  const expectedFiltersKey = useRef<string | null>(null)
  const observedFiltersKey = useRef(filtersKey)
  const activeFiltersKey = useRef(filtersKey)
  activeFiltersKey.current = filtersKey
  const navigationGuard = useRef<ReviewNavigationGuard | null>(null)
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
    setNavigationPending(false)
  }, [])

  const updateFilters = useCallback(
    (next: ReviewQueueFilters, navigation: 'replace' | 'push' = 'replace') => {
      const generation = filterNavigationGeneration.current + 1
      filterNavigationGeneration.current = generation
      advanceGeneration.current += 1
      advancing.current = false
      void (async () => {
        const guard = navigationGuard.current
        if (guard) {
          setNavigationPending(true)
          setQueueNotice('Saving the current draft before changing the queue…')
          if (!(await guard())) {
            if (filterNavigationGeneration.current === generation) {
              setNavigationPending(false)
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

  const registerNavigationGuard = useCallback((guard: ReviewNavigationGuard | null) => {
    navigationGuard.current = guard
  }, [])

  const choose = useCallback(
    (
      subject: ReviewSubject,
      index: number,
      offset: number,
      selectionKey = filtersKey,
      successor?: ReviewSubject,
    ) => {
      selectedPosition.current = { traceUid: subject.traceUid, offset, index, successor }
      setSelected(subject)
      setSelectedFiltersKey(selectionKey)
      setQueueNotice(null)
      setNavigationPending(false)
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
      choose(
        subject,
        Math.max(0, index),
        queuePage?.offset ?? filters.offset ?? 0,
        filtersKey,
        index >= 0 ? queueItems[index + 1]?.subject : undefined,
      )
    },
    [choose, filters.offset, filtersKey, queueItems, queuePage?.offset],
  )

  const next = useCallback(
    async (persistCurrent: ReviewNavigationGuard) => {
      const current = visibleSelected
      const position = selectedPosition.current
      if (!current || !position || advancing.current) return
      const generation = advanceGeneration.current + 1
      advanceGeneration.current = generation
      advancing.current = true
      setNavigationPending(true)
      setQueueNotice('Refreshing the queue before advancing…')
      try {
        // Resolve a stable successor while the current row still belongs to the
        // filtered queue. Saving a draft can immediately remove that row, and a
        // simultaneous live insert can invalidate any old numeric index.
        const fresh = await fetchReviewQueue(filters, { anchorTraceUid: current.traceUid })
        if (advanceGeneration.current !== generation || activeFiltersKey.current !== filtersKey)
          return
        setQueueItems(fresh.items)
        setQueuePage(fresh)
        const currentIndex =
          fresh.anchorFound === true && fresh.anchorIndex !== undefined
            ? fresh.anchorIndex
            : fresh.items.findIndex((item) => item.subject.traceUid === current.traceUid)
        let successor =
          currentIndex >= 0 ? fresh.items[currentIndex + 1]?.subject : position.successor

        if (currentIndex < 0 && !successor) {
          setNavigationPending(false)
          setQueueNotice(
            'The selected trace already left this queue and no stable successor was captured. Select the next trace from the refreshed queue.',
          )
          return
        }

        const pageWindow = reviewQueuePageWindow(
          fresh.total,
          fresh.limit,
          fresh.offset,
          fresh.items.length,
        )
        if (!successor && pageWindow.hasNext) {
          const nextPage = await fetchReviewQueue({ ...filters, offset: pageWindow.nextOffset })
          if (advanceGeneration.current !== generation || activeFiltersKey.current !== filtersKey) {
            return
          }
          successor = nextPage.items.find(
            (item) => item.subject.traceUid !== current.traceUid,
          )?.subject
        }

        if (!successor && (filters.state === 'unreviewed' || filters.state === 'draft')) {
          const firstPage =
            fresh.offset === 0 ? fresh : await fetchReviewQueue({ ...filters, offset: 0 })
          if (advanceGeneration.current !== generation || activeFiltersKey.current !== filtersKey) {
            return
          }
          const first = firstPage.items[0]
          if (first?.subject.traceUid !== current.traceUid) successor = first?.subject
        }

        if (!(await persistCurrent())) {
          if (advanceGeneration.current === generation) {
            setNavigationPending(false)
            setQueueNotice('Advance cancelled because the current draft could not be saved.')
          }
          return
        }
        if (advanceGeneration.current !== generation || activeFiltersKey.current !== filtersKey)
          return

        if (!successor) {
          setNavigationPending(false)
          setQueueNotice('You reached the end of the current filtered queue.')
          return
        }

        // The successor UID was captured before persistence. Anchor it again
        // afterwards so inserts, removals, and page shifts cannot change which
        // trace is selected or leave the URL on the wrong page.
        const located = await fetchReviewQueue(filters, { anchorTraceUid: successor.traceUid })
        if (advanceGeneration.current !== generation || activeFiltersKey.current !== filtersKey)
          return
        const successorIndex =
          located.anchorFound === true && located.anchorIndex !== undefined
            ? located.anchorIndex
            : located.items.findIndex((item) => item.subject.traceUid === successor?.traceUid)
        const locatedSuccessor = located.items[successorIndex]
        if (!locatedSuccessor) {
          setNavigationPending(false)
          setQueueNotice(
            'The captured successor left the queue before it could be opened. Try again.',
          )
          return
        }

        const successorFilters = { ...filters, offset: located.offset }
        const successorSearch = reviewQueueFiltersToSearchParams(successorFilters)
        const successorKey = successorSearch.toString()
        setQueueItems(located.items)
        setQueuePage(located)
        choose(
          locatedSuccessor.subject,
          successorIndex,
          located.offset,
          successorKey,
          located.items[successorIndex + 1]?.subject,
        )
        if (successorKey !== filtersKey) {
          expectedFiltersKey.current = successorKey
          activeFiltersKey.current = successorKey
          setSearchParams(successorSearch, { replace: false })
        }
      } catch (error) {
        if (advanceGeneration.current !== generation) return
        setNavigationPending(false)
        setQueueNotice(
          `Could not refresh the review queue: ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        if (advanceGeneration.current === generation) advancing.current = false
      }
    },
    [choose, filters, filtersKey, setSearchParams, visibleSelected],
  )

  const submitted = useCallback((_record: ReviewRecord) => {
    setQueueNotice('Submitted and locked. Review the reveal, then press Alt/Option + ↓ for next.')
  }, [])

  // All URL filters, including offset, are part of the selected workspace
  // identity. Browser back/forward must never retain a stale submit target.
  useEffect(() => {
    // Increment even when a rapid back→forward returns to the observed key;
    // this invalidates the save continuation started by the intermediate URL.
    const generation = externalNavigationGeneration.current + 1
    externalNavigationGeneration.current = generation
    if (observedFiltersKey.current === filtersKey) {
      setNavigationPending(false)
      return
    }
    if (expectedFiltersKey.current === filtersKey) {
      observedFiltersKey.current = filtersKey
      expectedFiltersKey.current = null
      setNavigationPending(false)
      return
    }
    expectedFiltersKey.current = null
    const previousFiltersKey = observedFiltersKey.current
    const guard = navigationGuard.current
    if (!guard) {
      observedFiltersKey.current = filtersKey
      clearWorkspace()
      return
    }
    setNavigationPending(true)
    setQueueNotice('Saving the current draft before changing the queue…')
    void guard().then((saved) => {
      if (externalNavigationGeneration.current !== generation) return
      if (saved) {
        observedFiltersKey.current = filtersKey
        clearWorkspace()
        return
      }
      activeFiltersKey.current = previousFiltersKey
      setNavigationPending(false)
      setSearchParams(new URLSearchParams(previousFiltersKey), { replace: true })
      setQueueNotice('Navigation cancelled because the current draft could not be saved.')
    })
  }, [clearWorkspace, filtersKey, setSearchParams])

  return (
    <main className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto mb-4 flex max-w-[1600px] items-center gap-3">
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
              suspended={navigationPending || !visibleSelected}
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
