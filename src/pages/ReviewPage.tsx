import {
  type ReviewQueueItem,
  type ReviewQueueResponse,
  type ReviewRecord,
  type ReviewSubject,
  reviewSubjectKey,
} from '@shared/reviews/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ReviewQueueFilters } from '../api/reviews'
import { CalibrationStatsPanel } from '../components/review/CalibrationStatsPanel'
import { ReviewPanel } from '../components/review/ReviewPanel'
import { ReviewQueue } from '../components/review/ReviewQueue'
import {
  calibrationFiltersForQueue,
  nextReviewSubject,
  reviewQueueFiltersFromSearchParams,
  reviewQueueFiltersToSearchParams,
  reviewQueuePageWindow,
} from '../components/review/reviewQueueState'

export function ReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => reviewQueueFiltersFromSearchParams(searchParams), [searchParams])
  const [selected, setSelected] = useState<ReviewSubject | null>(null)
  const [queueItems, setQueueItems] = useState<readonly ReviewQueueItem[]>([])
  const [queuePage, setQueuePage] = useState<ReviewQueueResponse | null>(null)
  const [queueNotice, setQueueNotice] = useState<string | null>(null)
  const selectFirstAtOffset = useRef<number | null>(null)

  const updateFilters = useCallback(
    (next: ReviewQueueFilters) => {
      selectFirstAtOffset.current = null
      setSelected(null)
      setQueueItems([])
      setQueuePage(null)
      setQueueNotice(null)
      setSearchParams(reviewQueueFiltersToSearchParams(next), { replace: true })
    },
    [setSearchParams],
  )

  const receiveQueuePage = useCallback((page: ReviewQueueResponse) => {
    setQueueItems(page.items)
    setQueuePage(page)
    const pendingOffset = selectFirstAtOffset.current
    if (pendingOffset === null || pendingOffset !== page.offset) return
    selectFirstAtOffset.current = null
    const first = page.items[0]
    if (first) {
      setSelected(first.subject)
      setQueueNotice(null)
    } else {
      setQueueNotice('The next page became empty after the queue changed.')
    }
  }, [])

  const select = useCallback((subject: ReviewSubject) => {
    setSelected(subject)
    setQueueNotice(null)
  }, [])

  const next = useCallback(() => {
    const subject = nextReviewSubject(queueItems, selected?.traceUid)
    if (subject) {
      setSelected(subject)
      setQueueNotice(null)
      return
    }
    if (queuePage) {
      const pageWindow = reviewQueuePageWindow(
        queuePage.total,
        queuePage.limit,
        queuePage.offset,
        queuePage.items.length,
      )
      if (pageWindow.hasNext) {
        selectFirstAtOffset.current = pageWindow.nextOffset
        setSelected(null)
        setQueueItems([])
        setQueuePage(null)
        setQueueNotice('Loading the next review page…')
        setSearchParams(
          reviewQueueFiltersToSearchParams({ ...filters, offset: pageWindow.nextOffset }),
          { replace: true },
        )
        return
      }
    }
    const wrap =
      filters.state === 'unreviewed' || filters.state === 'draft'
        ? nextReviewSubject(queueItems, selected?.traceUid, true)
        : null
    if (wrap) {
      setSelected(wrap)
      setQueueNotice(null)
      return
    }
    setQueueNotice('You reached the end of the current filtered queue.')
  }, [filters, queueItems, queuePage, selected?.traceUid, setSearchParams])

  const submitted = useCallback((_record: ReviewRecord) => {
    setQueueNotice('Submitted and locked. Review the reveal, then press Alt/Option + ↓ for next.')
  }, [])

  // Browser back/forward can restore a different mode or rubric. Clear the
  // current workspace immediately so Assisted data never remains visible under
  // a Calibration queue header.
  useEffect(() => {
    if (
      selected &&
      (selected.mode !== filters.mode ||
        selected.annotator !== filters.annotator ||
        selected.rubricVersion !== filters.rubricVersion)
    ) {
      setSelected(null)
      setQueueNotice(null)
    }
  }, [filters.annotator, filters.mode, filters.rubricVersion, selected])

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
            selectedTraceUid={selected?.traceUid}
            onFiltersChange={updateFilters}
            onPageDataChange={receiveQueuePage}
            onSelect={select}
          />
          <CalibrationStatsPanel filters={calibrationFiltersForQueue(filters)} />
        </div>
        {selected ? (
          <div className="space-y-3">
            {queueNotice ? (
              <p
                aria-live="polite"
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800"
              >
                {queueNotice}
              </p>
            ) : null}
            <ReviewPanel
              key={reviewSubjectKey(selected)}
              subject={selected}
              onSubmitted={submitted}
              onNext={next}
            />
          </div>
        ) : (
          <div className="space-y-3">
            {queueNotice ? (
              <p
                aria-live="polite"
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800"
              >
                {queueNotice}
              </p>
            ) : null}
            <section className="flex min-h-96 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
              Select a trace to start human review.
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
