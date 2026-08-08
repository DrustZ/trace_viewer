import { z } from 'zod'
import {
  FAILURE_DECISIONS,
  JUDGE_REVIEW_DECISIONS,
  REVIEW_MODES,
  REVIEW_PRIORITIES,
  REVIEW_STATUSES,
  REVIEW_VERDICTS,
  type ReviewDraft,
  type ReviewPayload,
  type ReviewRecord,
  type ReviewSubject,
  RUBRIC_VERDICTS,
  type SaveReviewDraftRequest,
  type SubmitReviewRequest,
} from '../../shared/reviews/types'

const identifier = z.string().trim().min(1).max(500)
const shortText = z.string().max(2_000)
const note = z.string().max(100_000)
const stringList = z.array(z.string().trim().min(1).max(500)).max(250)

const subjectShape = {
  corpusId: identifier,
  runId: identifier,
  traceUid: identifier,
  rubricVersion: identifier,
  annotator: identifier,
  mode: z.enum(REVIEW_MODES),
}

export const reviewSubjectSchema = z.object(subjectShape).strict()

const rubricReviewSchema = z
  .object({
    dimensionId: identifier,
    verdict: z.enum(RUBRIC_VERDICTS),
    critique: note,
    evidenceMessageIds: stringList,
  })
  .strict()

const failureReviewSchema = z
  .object({
    failureId: identifier,
    decision: z.enum(FAILURE_DECISIONS),
    note,
  })
  .strict()

const messageIndexSchema = z
  .object({
    space: z.enum(['raw', 'chronological']),
    index: z.number().int().nonnegative(),
  })
  .strict()

const turnAnnotationSchema = z
  .object({
    annotationId: identifier,
    messageId: identifier,
    index: messageIndexSchema.optional(),
    label: shortText,
    tags: stringList,
    note,
  })
  .strict()

const judgeDimensionReviewSchema = z
  .object({
    decision: z.enum(JUDGE_REVIEW_DECISIONS),
    note: note.optional(),
  })
  .strict()

const payloadShape = {
  reviewStatus: z.enum(REVIEW_STATUSES),
  overallVerdict: z.enum(REVIEW_VERDICTS),
  priority: z.enum(REVIEW_PRIORITIES),
  rootCauseTags: stringList,
  note,
  rubricReviews: z.array(rubricReviewSchema).max(250),
  failureReviews: z.array(failureReviewSchema).max(1_000),
  turnAnnotations: z.array(turnAnnotationSchema).max(2_000),
  // Judge calibration verdicts. Optional: payloads stored before this field
  // existed keep parsing (drafts, finals, and the append-only reviews.jsonl).
  judgeReviews: z
    .record(identifier, judgeDimensionReviewSchema)
    .refine((value) => Object.keys(value).length <= 250, {
      message: 'judgeReviews supports at most 250 dimensions',
    })
    .optional(),
}

function enforceUniqueReviewIds(
  payload: z.infer<z.ZodObject<typeof payloadShape>>,
  ctx: z.core.$RefinementCtx<z.infer<z.ZodObject<typeof payloadShape>>>,
): void {
  const uniqueFields: Array<[string, readonly string[]]> = [
    ['rubricReviews', payload.rubricReviews.map((item) => item.dimensionId)],
    ['failureReviews', payload.failureReviews.map((item) => item.failureId)],
    ['turnAnnotations', payload.turnAnnotations.map((item) => item.annotationId)],
  ]
  for (const [field, ids] of uniqueFields) {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: [field], message: `${field} ids must be unique` })
    }
  }
}

export const reviewPayloadSchema = z
  .object(payloadShape)
  .strict()
  .superRefine(enforceUniqueReviewIds)

const requestSchema = z
  .object({
    subject: reviewSubjectSchema,
    review: reviewPayloadSchema,
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict()

const automaticVerdictSchema = z
  .object({
    verdict: z.enum(['pass', 'fail', 'unknown']),
    critique: z.string().optional(),
    evidenceMessageIds: z.array(z.string()).optional(),
  })
  .strict()

const automaticFailureSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    origin: z.enum([
      'integrity',
      'runtime',
      'tool',
      'user_sim',
      'grader',
      'detector',
      'judge',
      'semantic',
      'replay',
    ]),
    severity: z.enum(['info', 'minor', 'major', 'critical']),
    message: z.string(),
    messageId: z.string().optional(),
    toolCallId: z.string().optional(),
  })
  .strict()

const verdictMap = z.record(z.string(), automaticVerdictSchema)

const detectorAnalysisSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('available'),
      source: z.literal('ace.detector_registry'),
    })
    .strict(),
  z
    .object({
      status: z.literal('unavailable'),
      source: z.literal('ace.detector_registry'),
      reason: z.enum([
        'coordinator_not_configured',
        'analysis_failed',
        'not_loaded_for_current_source',
        'trace_not_covered',
      ]),
    })
    .strict(),
])

const automaticContextSchema = z
  .object({
    model: z.string().optional(),
    arm: z.string().optional(),
    outcome: z.string().optional(),
    gradeVerdicts: verdictMap.optional(),
    judgeVerdicts: verdictMap.optional(),
    detectorVerdicts: verdictMap.optional(),
    failures: z.array(automaticFailureSchema).optional(),
    detectorAnalysis: detectorAnalysisSchema.optional(),
  })
  .strict()

export const reviewDraftSchema = z
  .object({
    ...subjectShape,
    ...payloadShape,
    revision: z.number().int().positive(),
    key: z.string(),
    locked: z.literal(false),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
  .superRefine(enforceUniqueReviewIds)

export const reviewRecordSchema = z
  .object({
    ...subjectShape,
    ...payloadShape,
    revision: z.number().int().positive(),
    key: z.string(),
    locked: z.literal(true),
    createdAt: z.string(),
    submittedAt: z.string(),
    automaticSnapshot: automaticContextSchema.optional(),
  })
  .strict()
  .superRefine(enforceUniqueReviewIds)

export function parseReviewSubject(input: unknown): ReviewSubject {
  return reviewSubjectSchema.parse(input) as ReviewSubject
}

export function parseReviewPayload(input: unknown): ReviewPayload {
  return reviewPayloadSchema.parse(input) as ReviewPayload
}

export function parseSaveDraftRequest(input: unknown): SaveReviewDraftRequest {
  return requestSchema.parse(input) as SaveReviewDraftRequest
}

export function parseSubmitRequest(input: unknown): SubmitReviewRequest {
  return requestSchema.parse(input) as SubmitReviewRequest
}

export function parseStoredDraft(input: unknown): ReviewDraft {
  return reviewDraftSchema.parse(input) as ReviewDraft
}

export function parseStoredRecord(input: unknown): ReviewRecord {
  return reviewRecordSchema.parse(input) as ReviewRecord
}
