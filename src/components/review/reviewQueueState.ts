import {
  REVIEW_MODES,
  REVIEW_PRIORITIES,
  type ReviewQueueItem,
  type ReviewSubject,
} from '@shared/reviews/types'
import type { CalibrationFilters, ReviewQueueFilters } from '../../api/reviews'

export const DEFAULT_REVIEW_QUEUE_FILTERS: ReviewQueueFilters = {
  annotator: 'local',
  rubricVersion: 'judge_v2',
  mode: 'calibration',
  corpusId: 'ace',
  state: 'unreviewed',
  limit: 200,
}

const QUEUE_STATES = ['unreviewed', 'draft', 'submitted'] as const

function nonEmpty(value: string | null): string | undefined {
  return value?.trim() || undefined
}

function oneOf<T extends string>(value: string | null, values: readonly T[]): T | undefined {
  return values.includes(value as T) ? (value as T) : undefined
}

/**
 * Only explicit review-queue parameters are accepted. In particular, model,
 * arm, grade, detector, and judge query parameters can never enter the queue
 * state used by blind Calibration.
 */
export function reviewQueueFiltersFromSearchParams(search: URLSearchParams): ReviewQueueFilters {
  const tags = [
    ...new Set(
      search
        .getAll('tag')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ]
  const disagreement = oneOf(search.get('disagreement'), ['true', 'false'] as const)
  const mode = oneOf(search.get('mode'), REVIEW_MODES) ?? DEFAULT_REVIEW_QUEUE_FILTERS.mode
  const stateParam = search.get('state')
  const corpusParam = search.get('corpusId')
  const state =
    stateParam === 'all'
      ? undefined
      : (oneOf(stateParam, QUEUE_STATES) ?? DEFAULT_REVIEW_QUEUE_FILTERS.state)
  const corpusId =
    corpusParam === 'all'
      ? undefined
      : (nonEmpty(corpusParam) ?? DEFAULT_REVIEW_QUEUE_FILTERS.corpusId)

  return {
    ...DEFAULT_REVIEW_QUEUE_FILTERS,
    mode,
    annotator: nonEmpty(search.get('annotator')) ?? DEFAULT_REVIEW_QUEUE_FILTERS.annotator,
    rubricVersion:
      nonEmpty(search.get('rubricVersion')) ?? DEFAULT_REVIEW_QUEUE_FILTERS.rubricVersion,
    state,
    corpusId,
    ...(oneOf(search.get('priority'), REVIEW_PRIORITIES)
      ? { priority: oneOf(search.get('priority'), REVIEW_PRIORITIES) }
      : {}),
    ...(mode === 'assisted' && nonEmpty(search.get('runId'))
      ? { runId: nonEmpty(search.get('runId')) }
      : {}),
    ...(nonEmpty(search.get('q')) ? { q: nonEmpty(search.get('q')) } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(disagreement ? { disagreement: disagreement === 'true' } : {}),
  }
}

/** Serialize every user-visible filter so the URL is reload-safe and shareable. */
export function reviewQueueFiltersToSearchParams(filters: ReviewQueueFilters): URLSearchParams {
  const search = new URLSearchParams()
  search.set('mode', filters.mode)
  search.set('annotator', filters.annotator)
  search.set('rubricVersion', filters.rubricVersion)
  search.set('corpusId', filters.corpusId || 'all')
  if (filters.mode === 'assisted' && filters.runId) search.set('runId', filters.runId)
  search.set('state', filters.state || 'all')
  if (filters.priority) search.set('priority', filters.priority)
  if (filters.q) search.set('q', filters.q)
  for (const tag of filters.tags ?? []) search.append('tag', tag)
  if (filters.disagreement !== undefined) {
    search.set('disagreement', String(filters.disagreement))
  }
  return search
}

/**
 * Calibration aliases deliberately hide the canonical run id before submit, so
 * statistics must follow the visible queue filters rather than a selected blind
 * subject. The synthetic "ace" corpus means production + simulation and cannot
 * be sent as an exact server-side corpus id.
 */
export function calibrationFiltersForQueue(filters: ReviewQueueFilters): CalibrationFilters {
  return {
    annotator: filters.annotator,
    rubricVersion: filters.rubricVersion,
    ...(filters.corpusId && filters.corpusId !== 'ace' ? { corpusId: filters.corpusId } : {}),
    ...(filters.mode === 'assisted' && filters.runId ? { runId: filters.runId } : {}),
  }
}

/**
 * Find the next item in the currently visible queue. When the just-submitted
 * item has disappeared because state=unreviewed, the first refreshed item is
 * the correct continuation.
 */
export function nextReviewSubject(
  items: readonly ReviewQueueItem[],
  currentTraceUid: string | undefined,
  wrapAtEnd = false,
): ReviewSubject | null {
  if (items.length === 0) return null
  const currentIndex = currentTraceUid
    ? items.findIndex((item) => item.subject.traceUid === currentTraceUid)
    : -1
  if (currentIndex < 0) return items[0]?.subject ?? null
  return (
    items[currentIndex + 1]?.subject ??
    (wrapAtEnd && items.length > 1 ? (items[0]?.subject ?? null) : null)
  )
}
