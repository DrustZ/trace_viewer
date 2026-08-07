import { createHmac, randomBytes } from 'node:crypto'
import { Router } from 'express'
import {
  REVIEW_MODES,
  REVIEW_PRIORITIES,
  type ReviewDraft,
  type ReviewPayload,
  type ReviewQueueItem,
  type ReviewQueueResponse,
  type ReviewRecord,
  type ReviewSubject,
  type ReviewWorkspaceResponse,
  reviewSubjectKey,
} from '../../shared/reviews/types'
import { computeCalibrationStats, recordHasDisagreement } from '../reviews/calibration'
import { sanitizeReviewGroundTruth } from '../reviews/groundTruth'
import { ReviewStore, ReviewStoreError } from '../reviews/reviewStore'
import type { ReviewTraceCandidate, ReviewTraceSource } from '../reviews/traceSource'
import { parseSaveDraftRequest, parseSubmitRequest } from '../reviews/validation'
import { asyncHandler, firstParam } from './context'

export interface ReviewRoutesDefaults {
  annotator: string
  rubricVersion: string
  mode: (typeof REVIEW_MODES)[number]
}

export interface ReviewRoutesDeps {
  traceSource: ReviewTraceSource
  reviewStore?: ReviewStore
  defaults?: Partial<ReviewRoutesDefaults>
}

const DEFAULTS: ReviewRoutesDefaults = {
  annotator: 'local',
  rubricVersion: 'judge_v2',
  mode: 'calibration',
}

function badRequest(error: unknown): never {
  if (error instanceof ReviewStoreError) throw error
  const detail = error instanceof Error ? error.message : String(error)
  throw new ReviewStoreError(`invalid review request: ${detail}`, 400)
}

function parseMode(
  value: unknown,
  fallback: ReviewRoutesDefaults['mode'],
): ReviewRoutesDefaults['mode'] {
  const candidate = firstParam(value) ?? fallback
  if (!REVIEW_MODES.includes(candidate as ReviewRoutesDefaults['mode'])) {
    throw new ReviewStoreError('mode must be calibration or assisted', 400)
  }
  return candidate as ReviewRoutesDefaults['mode']
}

function subjectFor(
  candidate: ReviewTraceCandidate,
  query: Record<string, unknown>,
  defaults: ReviewRoutesDefaults,
): ReviewSubject {
  return {
    corpusId: candidate.trace.corpusId,
    runId: candidate.trace.runId,
    traceUid: candidate.trace.traceUid,
    rubricVersion: firstParam(query.rubricVersion)?.trim() || defaults.rubricVersion,
    annotator: firstParam(query.annotator)?.trim() || defaults.annotator,
    mode: parseMode(query.mode, defaults.mode),
  }
}

function blindToken(secret: Buffer, namespace: string, value: string): string {
  return createHmac('sha256', secret)
    .update(namespace)
    .update('\0')
    .update(value)
    .digest('hex')
    .slice(0, 20)
}

function blindRunId(secret: Buffer, candidate: ReviewTraceCandidate): string {
  return `blind_run_${blindToken(
    secret,
    'run',
    `${candidate.trace.traceUid}\0${candidate.trace.runId}`,
  )}`
}

function blindTraceId(secret: Buffer, candidate: ReviewTraceCandidate): string {
  return `blind_trace_${blindToken(secret, 'trace', candidate.trace.traceUid)}`
}

function blindSubject(
  secret: Buffer,
  subject: ReviewSubject,
  candidate: ReviewTraceCandidate,
): ReviewSubject {
  return {
    ...subject,
    runId: blindRunId(secret, candidate),
    traceUid: blindTraceId(secret, candidate),
  }
}

function blindTrace(
  secret: Buffer,
  candidate: ReviewTraceCandidate,
): ReviewTraceCandidate['trace'] {
  const trace = candidate.trace
  const groundTruth = sanitizeReviewGroundTruth(trace.groundTruth, trace.instanceId)
  return {
    corpusId: trace.corpusId,
    runId: blindRunId(secret, candidate),
    traceUid: blindTraceId(secret, candidate),
    sourceTraceId: blindTraceId(secret, candidate),
    ...(trace.instanceId ? { instanceId: trace.instanceId } : {}),
    ...(trace.issue ? { issue: trace.issue } : {}),
    ...(trace.language ? { language: trace.language } : {}),
    ...(trace.transcript
      ? {
          transcript: trace.transcript.map(({ id, role, content }) => ({ id, role, content })),
        }
      : {}),
    ...(trace.rubric ? { rubric: trace.rubric } : {}),
    ...(groundTruth !== undefined ? { groundTruth } : {}),
  }
}

function blindDraft(
  secret: Buffer,
  draft: ReviewDraft,
  candidate: ReviewTraceCandidate,
): ReviewDraft {
  return {
    ...draft,
    ...blindSubject(secret, draft, candidate),
    key: `blind_record_${blindToken(secret, 'record', draft.key)}`,
  }
}

function canonicalSubjectForRequest(
  requested: ReviewSubject,
  candidate: ReviewTraceCandidate,
  secret: Buffer,
): ReviewSubject {
  if (
    (requested.traceUid !== candidate.trace.traceUid &&
      requested.traceUid !== blindTraceId(secret, candidate)) ||
    requested.corpusId !== candidate.trace.corpusId
  ) {
    throw new ReviewStoreError('review subject does not match the requested trace', 409)
  }
  const acceptedRunIds =
    requested.mode === 'calibration'
      ? new Set([candidate.trace.runId, blindRunId(secret, candidate)])
      : new Set([candidate.trace.runId])
  const isOpaqueCalibrationAlias =
    requested.mode === 'calibration' && /^blind_run_[0-9a-f]{20}$/.test(requested.runId)
  if (!acceptedRunIds.has(requested.runId) && !isOpaqueCalibrationAlias) {
    throw new ReviewStoreError('review subject does not match the requested trace', 409)
  }
  return {
    ...requested,
    runId: candidate.trace.runId,
    traceUid: candidate.trace.traceUid,
  }
}

function assertReviewReferences(
  subject: ReviewSubject,
  review: ReviewPayload,
  candidate: ReviewTraceCandidate,
): void {
  if (subject.mode === 'calibration' && review.failureReviews.length > 0) {
    throw new ReviewStoreError(
      'calibration reviews cannot decide hidden automatic failures before submit',
      400,
    )
  }
  const messageIds = new Set(candidate.trace.transcript?.map((message) => message.id) ?? [])
  if (messageIds.size > 0) {
    const referenced = [
      ...review.rubricReviews.flatMap((item) => item.evidenceMessageIds),
      ...review.turnAnnotations.map((item) => item.messageId),
    ]
    const unknown = referenced.find((messageId) => !messageIds.has(messageId))
    if (unknown) throw new ReviewStoreError(`unknown evidence message id: ${unknown}`, 400)
  }
  const rubricIds = new Set(
    candidate.trace.rubric?.map((definition) => definition.dimensionId) ?? [],
  )
  if (rubricIds.size > 0) {
    const unknown = review.rubricReviews.find((item) => !rubricIds.has(item.dimensionId))
    if (unknown) throw new ReviewStoreError(`unknown rubric dimension: ${unknown.dimensionId}`, 400)
  }
  if (subject.mode === 'assisted') {
    const failureIds = new Set(candidate.automatic?.failures?.map((failure) => failure.id) ?? [])
    const unknown = review.failureReviews.find((item) => !failureIds.has(item.failureId))
    if (unknown) throw new ReviewStoreError(`unknown automatic failure: ${unknown.failureId}`, 400)
  }
}

function latestBySubject(records: readonly ReviewRecord[]): Map<string, ReviewRecord> {
  const latest = new Map<string, ReviewRecord>()
  for (const record of records) {
    const key = reviewSubjectKey(record)
    const previous = latest.get(key)
    if (!previous || record.revision > previous.revision) latest.set(key, record)
  }
  return latest
}

function draftsBySubject(drafts: readonly ReviewDraft[]): Map<string, ReviewDraft> {
  return new Map(drafts.map((draft) => [reviewSubjectKey(draft), draft]))
}

function safeQueueTrace(
  candidate: ReviewTraceCandidate,
  revealed: boolean,
  secret: Buffer,
): ReviewQueueItem['trace'] {
  const trace = revealed ? candidate.trace : blindTrace(secret, candidate)
  const { transcript: _transcript, rubric: _rubric, groundTruth: _groundTruth, ...safe } = trace
  return safe
}

function priorityRank(priority: ReviewQueueItem['priority']): number {
  return REVIEW_PRIORITIES.indexOf(priority)
}

function asBoundedInteger(value: unknown, fallback: number, maximum: number): number {
  const numeric = Number(firstParam(value))
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.min(Math.floor(numeric), maximum)
    : fallback
}

function textValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap((item) =>
    typeof item === 'string'
      ? item
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      : [],
  )
}

function filterQueue(items: ReviewQueueItem[], query: Record<string, unknown>): ReviewQueueItem[] {
  const state = firstParam(query.state)
  const priority = firstParam(query.priority)
  const corpusId = firstParam(query.corpusId)
  const runId = firstParam(query.runId)
  const q = firstParam(query.q)?.trim().toLocaleLowerCase()
  const tags = textValues(query.tag)
  const disagreement = firstParam(query.disagreement)
  return items.filter((item) => {
    if (state && item.state !== state) return false
    if (priority && item.priority !== priority) return false
    if (
      corpusId === 'ace' &&
      item.subject.corpusId !== 'production' &&
      item.subject.corpusId !== 'simulation'
    ) {
      return false
    }
    if (corpusId && corpusId !== 'ace' && item.subject.corpusId !== corpusId) return false
    if (runId && item.subject.runId !== runId) return false
    if (tags.length > 0 && !tags.every((tag) => item.rootCauseTags.includes(tag))) return false
    if (disagreement === 'true' && item.hasDisagreement !== true) return false
    if (disagreement === 'false' && item.hasDisagreement === true) return false
    if (q) {
      const haystack = [
        item.subject.traceUid,
        item.trace.sourceTraceId,
        item.trace.instanceId,
        item.trace.issue,
        item.trace.language,
        item.trace.title,
        ...item.rootCauseTags,
      ]
        .filter((part): part is string => typeof part === 'string')
        .join('\n')
        .toLocaleLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

function automaticFor(
  subject: ReviewSubject,
  candidate: ReviewTraceCandidate,
  latest: ReviewRecord | undefined,
) {
  if (subject.mode === 'calibration' && !latest) return undefined
  return latest?.automaticSnapshot ?? candidate.automatic
}

/**
 * /api/reviews factory. Calibration redaction happens on the server, so a
 * browser cannot reveal hidden model/judge data by inspecting JSON responses.
 */
export function reviewsRoutes(deps: ReviewRoutesDeps): Router {
  const router = Router()
  const store = deps.reviewStore ?? new ReviewStore()
  const defaults = { ...DEFAULTS, ...deps.defaults }
  // Process-local HMAC aliases are stable for a running review session but
  // cannot be dictionary-matched against the small set of ACE arm/run names.
  const blindSecret = randomBytes(32)
  const candidateForReviewId = async (reviewId: string): Promise<ReviewTraceCandidate | null> => {
    const direct = await deps.traceSource.get(reviewId)
    if (direct) return direct
    if (!/^blind_trace_[0-9a-f]{20}$/.test(reviewId)) return null
    const candidates = await deps.traceSource.list()
    return candidates.find((candidate) => blindTraceId(blindSecret, candidate) === reviewId) ?? null
  }

  router.get(
    '/api/reviews/queue',
    asyncHandler(async (req, res) => {
      const [candidates, finals, drafts] = await Promise.all([
        deps.traceSource.list(),
        store.listFinals(),
        store.listDrafts(),
      ])
      const latest = latestBySubject(finals)
      const draftMap = draftsBySubject(drafts)
      const items = candidates.map((candidate): ReviewQueueItem => {
        const canonicalSubject = subjectFor(candidate, req.query, defaults)
        const final = latest.get(reviewSubjectKey(canonicalSubject))
        const draft = draftMap.get(reviewSubjectKey(canonicalSubject))
        const active = draft ?? final
        const revealed = canonicalSubject.mode !== 'calibration' || Boolean(final)
        const subject = revealed
          ? canonicalSubject
          : blindSubject(blindSecret, canonicalSubject, candidate)
        const automatic = automaticFor(canonicalSubject, candidate, final)
        return {
          subject,
          trace: safeQueueTrace(candidate, revealed, blindSecret),
          state: draft ? 'draft' : final ? 'submitted' : 'unreviewed',
          revision: active?.revision ?? (final?.revision ?? 0) + 1,
          locked: Boolean(final) && !draft,
          priority: active?.priority ?? 'none',
          ...(active ? { overallVerdict: active.overallVerdict } : {}),
          rootCauseTags: active?.rootCauseTags ?? [],
          ...(final ? { hasDisagreement: recordHasDisagreement(final) } : {}),
          ...(automatic ? { automatic } : {}),
        }
      })
      const filtered = filterQueue(items, req.query).sort((a, b) => {
        if (a.hasDisagreement !== b.hasDisagreement) return a.hasDisagreement ? -1 : 1
        const priorityDelta = priorityRank(b.priority) - priorityRank(a.priority)
        if (priorityDelta !== 0) return priorityDelta
        if (a.state !== b.state) return a.state === 'draft' ? -1 : 1
        return (b.trace.timestamp ?? '').localeCompare(a.trace.timestamp ?? '')
      })
      const limit = asBoundedInteger(req.query.limit, 100, 500)
      const offset = asBoundedInteger(req.query.offset, 0, Number.MAX_SAFE_INTEGER)
      res.json({
        total: filtered.length,
        limit,
        offset,
        items: filtered.slice(offset, offset + limit),
      } satisfies ReviewQueueResponse)
    }),
  )

  router.get(
    '/api/reviews/calibration',
    asyncHandler(async (req, res) => {
      res.json(
        computeCalibrationStats(await store.listFinals(), {
          ...(firstParam(req.query.corpusId) ? { corpusId: firstParam(req.query.corpusId) } : {}),
          ...(firstParam(req.query.runId) ? { runId: firstParam(req.query.runId) } : {}),
          ...(firstParam(req.query.rubricVersion)
            ? { rubricVersion: firstParam(req.query.rubricVersion) }
            : {}),
          ...(firstParam(req.query.annotator)
            ? { annotator: firstParam(req.query.annotator) }
            : {}),
        }),
      )
    }),
  )

  router.get(
    '/api/reviews/:traceUid/draft',
    asyncHandler(async (req, res) => {
      const candidate = await candidateForReviewId(String(req.params.traceUid))
      if (!candidate) throw new ReviewStoreError('trace not found', 404)
      const canonicalSubject = subjectFor(candidate, req.query, defaults)
      const [draft, latestFinal] = await Promise.all([
        store.getDraft(canonicalSubject),
        store.latestFinal(canonicalSubject),
      ])
      const revealed = canonicalSubject.mode !== 'calibration' || Boolean(latestFinal)
      const subject = revealed
        ? canonicalSubject
        : blindSubject(blindSecret, canonicalSubject, candidate)
      const automatic = automaticFor(canonicalSubject, candidate, latestFinal ?? undefined)
      res.json({
        subject,
        trace: revealed ? candidate.trace : blindTrace(blindSecret, candidate),
        draft: draft && !revealed ? blindDraft(blindSecret, draft, candidate) : draft,
        latestFinal,
        nextRevision: (latestFinal?.revision ?? 0) + 1,
        visibility: revealed ? 'revealed' : 'hidden_until_submit',
        ...(automatic ? { automatic } : {}),
      } satisfies ReviewWorkspaceResponse)
    }),
  )

  router.put(
    '/api/reviews/:traceUid/draft',
    asyncHandler(async (req, res) => {
      const candidate = await candidateForReviewId(String(req.params.traceUid))
      if (!candidate) throw new ReviewStoreError('trace not found', 404)
      try {
        const request = parseSaveDraftRequest(req.body)
        const canonicalSubject = canonicalSubjectForRequest(request.subject, candidate, blindSecret)
        assertReviewReferences(canonicalSubject, request.review, candidate)
        const draft = await store.saveDraft(
          canonicalSubject,
          request.review,
          request.expectedRevision,
        )
        res.json(
          canonicalSubject.mode === 'calibration'
            ? blindDraft(blindSecret, draft, candidate)
            : draft,
        )
      } catch (error) {
        badRequest(error)
      }
    }),
  )

  router.post(
    '/api/reviews/:traceUid/submit',
    asyncHandler(async (req, res) => {
      const candidate = await candidateForReviewId(String(req.params.traceUid))
      if (!candidate) throw new ReviewStoreError('trace not found', 404)
      try {
        const request = parseSubmitRequest(req.body)
        const canonicalSubject = canonicalSubjectForRequest(request.subject, candidate, blindSecret)
        assertReviewReferences(canonicalSubject, request.review, candidate)
        const record = await store.submit(
          canonicalSubject,
          request.review,
          candidate.automatic,
          request.expectedRevision,
        )
        res.status(201).json({
          record,
          visibility: 'revealed',
          ...(record.automaticSnapshot ? { automatic: record.automaticSnapshot } : {}),
        })
      } catch (error) {
        badRequest(error)
      }
    }),
  )

  return router
}
