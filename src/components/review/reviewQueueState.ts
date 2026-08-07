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

function positiveOffset(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

export interface ReviewQueuePageWindow {
  start: number
  end: number
  total: number
  hasPrevious: boolean
  hasNext: boolean
  previousOffset: number
  nextOffset: number
}

/** Move an obsolete offset to the last real page after a filtered total shrinks. */
export function normalizedReviewQueueOffset(
  totalValue: number,
  limitValue: number,
  offsetValue: number,
): number {
  const total = Math.max(0, Math.floor(totalValue))
  const limit = Math.max(1, Math.floor(limitValue))
  const offset = Math.max(0, Math.floor(offsetValue))
  if (total === 0) return 0
  if (offset < total) return offset
  return Math.floor((total - 1) / limit) * limit
}

/** Truthful visible range and page targets for one server response. */
export function reviewQueuePageWindow(
  totalValue: number,
  limitValue: number,
  offsetValue: number,
  itemCountValue: number,
): ReviewQueuePageWindow {
  const total = Math.max(0, Math.floor(totalValue))
  const limit = Math.max(1, Math.floor(limitValue))
  const offset = Math.max(0, Math.floor(offsetValue))
  const available = Math.max(0, total - offset)
  const itemCount = Math.min(Math.max(0, Math.floor(itemCountValue)), available)
  const start = itemCount > 0 ? offset + 1 : 0
  const end = itemCount > 0 ? offset + itemCount : 0
  return {
    start,
    end,
    total,
    hasPrevious: offset > 0,
    hasNext: itemCount > 0 && end < total,
    previousOffset: Math.max(0, offset - limit),
    nextOffset: offset + limit,
  }
}

/**
 * One filter edit from the Filters popover: merge the patch, keep every other
 * parameter (q, tags, disagreement, …) untouched, and restart at page one.
 */
export function patchReviewQueueFilters(
  filters: ReviewQueueFilters,
  patch: Partial<ReviewQueueFilters>,
): ReviewQueueFilters {
  return { ...filters, ...patch, offset: 0 }
}

/** How many narrowing filters are active, for the Filters button badge. */
export function activeReviewQueueFilterCount(filters: ReviewQueueFilters): number {
  return [
    filters.state,
    filters.priority,
    filters.corpusId,
    filters.runId,
    filters.q,
    filters.tags?.length ? 'tags' : undefined,
    filters.disagreement !== undefined ? 'disagreement' : undefined,
  ].filter((value) => value !== undefined).length
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
  const offset = positiveOffset(search.get('offset'))
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
    ...(offset === undefined ? {} : { offset }),
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
  if (Number.isSafeInteger(filters.offset) && (filters.offset ?? 0) > 0) {
    search.set('offset', String(filters.offset))
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

export interface ReviewQueueCursorMove {
  subject: ReviewSubject | null
  reason: 'moved' | 'reset' | 'empty' | 'at-start' | 'at-end'
}

/**
 * Simple queue cursor over the loaded page. When the current item has left
 * the filtered list (e.g. it was submitted under state=unreviewed), the first
 * item is the correct continuation ('reset'). 'at-start'/'at-end' tell the
 * caller to hop a page or refetch-and-clamp.
 */
export function reviewQueueCursorTarget(
  items: readonly ReviewQueueItem[],
  currentTraceUid: string | undefined,
  delta: 1 | -1,
): ReviewQueueCursorMove {
  if (items.length === 0) return { subject: null, reason: 'empty' }
  const currentIndex = currentTraceUid
    ? items.findIndex((item) => item.subject.traceUid === currentTraceUid)
    : -1
  if (currentIndex < 0) return { subject: items[0]?.subject ?? null, reason: 'reset' }
  const targetIndex = currentIndex + delta
  if (targetIndex < 0) return { subject: null, reason: 'at-start' }
  const target = items[targetIndex]
  if (!target) return { subject: null, reason: 'at-end' }
  return { subject: target.subject, reason: 'moved' }
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
