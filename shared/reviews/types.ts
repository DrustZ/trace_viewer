/**
 * Human-review contracts shared by the API, the React client, and ACE's
 * append-only label export. Automatic evaluation data is deliberately kept in
 * a separate field so calibration responses can remove it as one unit.
 */

export const REVIEW_MODES = ['calibration', 'assisted'] as const
export type ReviewMode = (typeof REVIEW_MODES)[number]

export const REVIEW_PRIORITIES = ['none', 'low', 'medium', 'high', 'critical'] as const
export type ReviewPriority = (typeof REVIEW_PRIORITIES)[number]

export const REVIEW_STATUSES = ['in_review', 'reviewed', 'skipped'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const REVIEW_VERDICTS = ['pass', 'fail', 'unsure', 'skip'] as const
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number]

export const RUBRIC_VERDICTS = ['pass', 'fail', 'skip'] as const
export type RubricVerdict = (typeof RUBRIC_VERDICTS)[number]

export const FAILURE_DECISIONS = ['confirmed', 'false_positive', 'unsure'] as const
export type FailureDecision = (typeof FAILURE_DECISIONS)[number]

export interface ReviewSubject {
  corpusId: string
  /** Opaque HMAC alias in an unlocked Calibration response; canonical after reveal/storage. */
  runId: string
  /** Review-only opaque alias in unlocked Calibration; canonical after reveal/storage. */
  traceUid: string
  rubricVersion: string
  annotator: string
  mode: ReviewMode
}

export interface RubricReview {
  dimensionId: string
  verdict: RubricVerdict
  critique: string
  evidenceMessageIds: string[]
}

export interface FailureReview {
  failureId: string
  decision: FailureDecision
  note: string
}

export interface ReviewMessageIndex {
  space: 'raw' | 'chronological'
  /** Zero-based index in the declared space. */
  index: number
}

export interface TurnAnnotation {
  annotationId: string
  messageId: string
  index?: ReviewMessageIndex
  label: string
  tags: string[]
  note: string
}

export interface ReviewPayload {
  reviewStatus: ReviewStatus
  overallVerdict: ReviewVerdict
  priority: ReviewPriority
  rootCauseTags: string[]
  note: string
  rubricReviews: RubricReview[]
  failureReviews: FailureReview[]
  turnAnnotations: TurnAnnotation[]
}

export interface AutomaticRubricVerdict {
  verdict: 'pass' | 'fail' | 'unknown'
  critique?: string
  evidenceMessageIds?: string[]
}

export interface AutomaticFailureSummary {
  id: string
  code: string
  origin:
    | 'integrity'
    | 'runtime'
    | 'tool'
    | 'user_sim'
    | 'grader'
    | 'detector'
    | 'judge'
    | 'semantic'
    | 'replay'
  severity: 'info' | 'minor' | 'major' | 'critical'
  message: string
  messageId?: string
  toolCallId?: string
}

/** Everything in this object is forbidden in an unlocked calibration response. */
export interface AutomaticReviewContext {
  model?: string
  arm?: string
  outcome?: string
  gradeVerdicts?: Record<string, AutomaticRubricVerdict>
  judgeVerdicts?: Record<string, AutomaticRubricVerdict>
  detectorVerdicts?: Record<string, AutomaticRubricVerdict>
  failures?: AutomaticFailureSummary[]
}

export interface ReviewDraft extends ReviewSubject, ReviewPayload {
  /** The revision this draft will become if submitted. */
  revision: number
  key: string
  locked: false
  createdAt: string
  updatedAt: string
}

export interface ReviewRecord extends ReviewSubject, ReviewPayload {
  revision: number
  key: string
  locked: true
  createdAt: string
  submittedAt: string
  /** Captured server-side at submit time; clients cannot supply this field. */
  automaticSnapshot?: AutomaticReviewContext
}

export interface RubricDefinition {
  dimensionId: string
  label: string
  description?: string
}

export interface ReviewTranscriptMessage {
  id: string
  role: string
  content: string
  timestamp?: string
}

export type ReviewGroundTruthValue = string | number | boolean | null

export interface ReviewGroundTruthTask {
  issue?: string
  language?: string
  personaGoal?: string
  expectedOutcome?: string
}

export interface ReviewGroundTruthAction {
  name: string
  argsSubset?: Record<string, ReviewGroundTruthValue>
}

export interface ReviewGroundTruthAuthorizedEffect {
  orderId: string
  effects: string[]
  refundCap?: number
}

export interface ReviewGroundTruthRequiredInfo {
  kind: string
  value: string | number
}

export interface ReviewGroundTruthStateDelta {
  orderId: string
  field: string
  to: ReviewGroundTruthValue
}

export type ReviewGroundTruthPrecedence =
  | [string, string]
  | [string, string, Record<string, ReviewGroundTruthValue>]

export interface ReviewGroundTruthPolicy {
  expectedActions?: ReviewGroundTruthAction[]
  forbiddenActions?: string[]
  authorizedEffects?: ReviewGroundTruthAuthorizedEffect[]
  mustPrecede?: ReviewGroundTruthPrecedence[]
  consentRequired?: boolean
}

export interface ReviewGroundTruthDatabase {
  requiredInfo?: ReviewGroundTruthRequiredInfo[]
  expectedStateDelta?: ReviewGroundTruthStateDelta[]
}

export interface ReviewGroundTruthRubric {
  rewardBasis?: string[]
  promiseCheck?: boolean
}

export type ReviewGroundTruthUnavailableReason =
  | 'trace_bound_scenario_snapshot_missing'
  | 'snapshot_provenance_missing'
  | 'scenario_id_mismatch'
  | 'config_provenance_missing'
  | 'config_digest_mismatch'
  | 'task_catalog_definition_conflict'
  | 'task_catalog_definition_invalid'
  | 'unsafe_ground_truth_shape'

export interface ReviewGroundTruthAvailable {
  status: 'available'
  authoritative: true
  source:
    | 'current_task_catalog'
    | 'trace_bound_episode_sidecar_scenario_snapshot'
    | 'trace_bound_batch_manifest_scenario_snapshot'
  /** False means authoritative for the current task definition, not a historical-trace claim. */
  traceBound: boolean
  scenarioId: string
  configDigest?: string
  definitionDigest?: string
  task?: ReviewGroundTruthTask
  policy?: ReviewGroundTruthPolicy
  database?: ReviewGroundTruthDatabase
  rubric?: ReviewGroundTruthRubric
}

export interface ReviewGroundTruthUnavailable {
  status: 'unavailable'
  authoritative: false
  reason: ReviewGroundTruthUnavailableReason
  scenarioId?: string
}

/** Server-sanitized, task-definition-only context safe for blind Calibration. */
export type ReviewGroundTruth = ReviewGroundTruthAvailable | ReviewGroundTruthUnavailable

/** Safe-to-show context. It must never contain model, arm, or automatic verdicts. */
export interface ReviewTraceContext {
  corpusId: string
  /** Opaque HMAC alias in an unlocked Calibration response. */
  runId: string
  /** Review-only opaque alias in an unlocked Calibration response. */
  traceUid: string
  /** Also opaque while Calibration is locked. */
  sourceTraceId: string
  instanceId?: string
  timestamp?: string
  issue?: string
  language?: string
  title?: string
  transcript?: ReviewTranscriptMessage[]
  rubric?: RubricDefinition[]
  groundTruth?: ReviewGroundTruth
}

export type ReviewQueueState = 'unreviewed' | 'draft' | 'submitted'

export interface ReviewQueueItem {
  subject: ReviewSubject
  trace: Omit<ReviewTraceContext, 'transcript' | 'rubric' | 'groundTruth'>
  state: ReviewQueueState
  revision: number
  locked: boolean
  priority: ReviewPriority
  overallVerdict?: ReviewVerdict
  rootCauseTags: string[]
  hasDisagreement?: boolean
  automatic?: AutomaticReviewContext
}

export interface ReviewQueueResponse {
  total: number
  limit: number
  offset: number
  items: ReviewQueueItem[]
}

export interface ReviewWorkspaceResponse {
  subject: ReviewSubject
  trace: ReviewTraceContext
  draft: ReviewDraft | null
  latestFinal: ReviewRecord | null
  nextRevision: number
  visibility: 'hidden_until_submit' | 'revealed'
  automatic?: AutomaticReviewContext
}

export interface SaveReviewDraftRequest {
  subject: ReviewSubject
  review: ReviewPayload
  expectedRevision?: number
}

export interface SubmitReviewRequest {
  subject: ReviewSubject
  review: ReviewPayload
  expectedRevision?: number
}

export interface CalibrationClassRecall {
  pass: number | null
  fail: number | null
}

export interface CalibrationDimensionStats {
  dimensionId: string
  pairs: number
  agreements: number
  rawAgreement: number | null
  /** Null means undefined; kappaStatus explains why. */
  kappa: number | null
  kappaStatus: 'defined' | 'undefined_no_pairs' | 'undefined_single_class'
  perClassRecall: CalibrationClassRecall
  confusion: {
    humanPassJudgePass: number
    humanPassJudgeFail: number
    humanFailJudgePass: number
    humanFailJudgeFail: number
  }
}

export interface CalibrationDisagreement {
  traceUid: string
  corpusId: string
  runId: string
  rubricVersion: string
  dimensionId: string
  human: 'pass' | 'fail'
  automatic: 'pass' | 'fail'
}

export interface CalibrationStatsResponse {
  records: number
  recordsWithAutomaticVerdicts: number
  dimensions: CalibrationDimensionStats[]
  disagreements: CalibrationDisagreement[]
}

/** Unambiguous even when identifiers themselves contain slashes. */
export function reviewSubjectKey(subject: ReviewSubject): string {
  return JSON.stringify([
    subject.corpusId,
    subject.runId,
    subject.traceUid,
    subject.rubricVersion,
    subject.annotator,
    subject.mode,
  ])
}

export function reviewRecordKey(subject: ReviewSubject, revision: number): string {
  return JSON.stringify([
    subject.corpusId,
    subject.runId,
    subject.traceUid,
    subject.rubricVersion,
    subject.annotator,
    subject.mode,
    revision,
  ])
}

export function emptyReviewPayload(): ReviewPayload {
  return {
    reviewStatus: 'in_review',
    overallVerdict: 'unsure',
    priority: 'none',
    rootCauseTags: [],
    note: '',
    rubricReviews: [],
    failureReviews: [],
    turnAnnotations: [],
  }
}
