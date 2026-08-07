import type { ReviewQueueItem, ReviewSubject } from '@shared/reviews/types'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_QUEUE_FILTERS,
  nextReviewSubject,
  reviewQueueFiltersFromSearchParams,
  reviewQueueFiltersToSearchParams,
} from './reviewQueueState'

function subject(traceUid: string): ReviewSubject {
  return {
    corpusId: 'simulation',
    runId: 'batch-a',
    traceUid,
    rubricVersion: 'judge_v2',
    annotator: 'alice',
    mode: 'calibration',
  }
}

function item(traceUid: string): ReviewQueueItem {
  return {
    subject: subject(traceUid),
    trace: {
      corpusId: 'simulation',
      runId: 'batch-a',
      traceUid,
      sourceTraceId: traceUid,
    },
    state: 'unreviewed',
    revision: 1,
    locked: false,
    priority: 'none',
    rootCauseTags: [],
  }
}

describe('review queue URL state', () => {
  it('uses safe ACE Calibration defaults for an empty URL', () => {
    expect(reviewQueueFiltersFromSearchParams(new URLSearchParams())).toEqual(
      DEFAULT_REVIEW_QUEUE_FILTERS,
    )
  })

  it('round-trips every queue filter through a shareable URL', () => {
    const filters = {
      ...DEFAULT_REVIEW_QUEUE_FILTERS,
      mode: 'assisted' as const,
      annotator: 'alice',
      rubricVersion: 'rubric-v3',
      corpusId: 'simulation',
      runId: 'batch-a',
      state: 'draft' as const,
      priority: 'critical' as const,
      q: 'refund spanish',
      tags: ['tool-state', 'promise'],
      disagreement: true,
    }

    expect(reviewQueueFiltersFromSearchParams(reviewQueueFiltersToSearchParams(filters))).toEqual(
      filters,
    )
  })

  it('ignores invalid and automatic-evaluation URL fields in blind Calibration', () => {
    const filters = reviewQueueFiltersFromSearchParams(
      new URLSearchParams(
        'mode=not-a-mode&state=secret&priority=p0&runId=baseline-chat&model=secret-model&arm=candidate-b&detector=failed',
      ),
    )
    const serialized = reviewQueueFiltersToSearchParams(filters).toString()

    expect(filters).toEqual(DEFAULT_REVIEW_QUEUE_FILTERS)
    expect(serialized).not.toContain('model')
    expect(serialized).not.toContain('arm')
    expect(serialized).not.toContain('detector')
    expect(serialized).not.toContain('baseline-chat')
  })

  it('round-trips explicit All states and All data selections', () => {
    const filters = reviewQueueFiltersFromSearchParams(
      new URLSearchParams('state=all&corpusId=all'),
    )

    expect(filters.state).toBeUndefined()
    expect(filters.corpusId).toBeUndefined()
    expect(reviewQueueFiltersToSearchParams(filters).get('state')).toBe('all')
    expect(reviewQueueFiltersToSearchParams(filters).get('corpusId')).toBe('all')
  })
})

describe('nextReviewSubject', () => {
  const items = [item('trace-a'), item('trace-b'), item('trace-c')]

  it('advances in the visible queue order', () => {
    expect(nextReviewSubject(items, 'trace-a')?.traceUid).toBe('trace-b')
    expect(nextReviewSubject(items, 'trace-b')?.traceUid).toBe('trace-c')
  })

  it('continues at the first refreshed item when a submitted item disappeared', () => {
    expect(nextReviewSubject(items.slice(1), 'trace-a')?.traceUid).toBe('trace-b')
  })

  it('reports the end of the queue instead of reopening the same item', () => {
    expect(nextReviewSubject(items, 'trace-c')).toBeNull()
    expect(nextReviewSubject([], 'trace-c')).toBeNull()
  })

  it('can wrap a work queue so submit-at-end still advances without waiting for refetch', () => {
    expect(nextReviewSubject(items, 'trace-c', true)?.traceUid).toBe('trace-a')
    expect(nextReviewSubject([item('trace-c')], 'trace-c', true)).toBeNull()
  })
})
