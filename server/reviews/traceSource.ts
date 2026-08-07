import type {
  AutomaticDetectorAnalysis,
  AutomaticFailureSummary,
  AutomaticReviewContext,
  AutomaticRubricVerdict,
  ReviewGroundTruth,
  ReviewGroundTruthUnavailableReason,
  ReviewTraceContext,
  RubricDefinition,
} from '../../shared/reviews/types'
import type { AceTaskDetail } from '../../shared/schema/aceTasks'
import type { Trace, TraceSummary } from '../../shared/schema/types'
import type { AceAnalysisLoader } from '../ace/analysisCoordinator'
import type { AceTaskCatalog } from '../ace/taskCatalog'
import type { TraceStore } from '../store/traceStore'
import { sanitizeReviewGroundTruth, unavailableGroundTruth } from './groundTruth'

export interface ReviewTraceCandidate {
  trace: ReviewTraceContext
  automatic?: AutomaticReviewContext
}

export interface ReviewTraceSource {
  list(): readonly ReviewTraceCandidate[] | Promise<readonly ReviewTraceCandidate[]>
  get(traceUid: string): ReviewTraceCandidate | null | Promise<ReviewTraceCandidate | null>
}

export interface ReviewTraceSourceOptions {
  /** Fixed configs/scenarios catalog; failures degrade to no task ground truth. */
  loadTaskCatalog?: () => Promise<AceTaskCatalog>
  /** Canonical production detector analysis shared with trace/dashboard routes. */
  analysisCoordinator?: AceAnalysisLoader
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringAt(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value !== '')
}

function verdict(value: unknown): AutomaticRubricVerdict | undefined {
  if (typeof value === 'boolean') return { verdict: value ? 'pass' : 'fail' }
  const item = record(value)
  if (!item) return undefined
  const raw = item.verdict ?? item.label ?? item.passed
  let normalized: AutomaticRubricVerdict['verdict']
  if (raw === true || raw === 'pass' || raw === 'passed') normalized = 'pass'
  else if (raw === false || raw === 'fail' || raw === 'failed') normalized = 'fail'
  else normalized = 'unknown'
  const evidence = Array.isArray(item.evidenceMessageIds)
    ? item.evidenceMessageIds.filter((id): id is string => typeof id === 'string')
    : undefined
  return {
    verdict: normalized,
    ...(typeof item.critique === 'string' ? { critique: item.critique } : {}),
    ...(evidence ? { evidenceMessageIds: evidence } : {}),
  }
}

function verdictMap(value: unknown): Record<string, AutomaticRubricVerdict> | undefined {
  const source = record(value)
  if (!source) return undefined
  const result: Record<string, AutomaticRubricVerdict> = {}
  for (const [key, candidate] of Object.entries(source)) {
    const parsed = verdict(candidate)
    if (parsed) result[key] = parsed
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function automaticFailure(value: unknown, index: number): AutomaticFailureSummary | undefined {
  const failure = record(value)
  if (!failure) return undefined
  const originValues = new Set<AutomaticFailureSummary['origin']>([
    'integrity',
    'runtime',
    'tool',
    'user_sim',
    'grader',
    'detector',
    'judge',
    'semantic',
    'replay',
  ])
  const severityValues = new Set<AutomaticFailureSummary['severity']>([
    'info',
    'minor',
    'major',
    'critical',
  ])
  const rawOrigin = failure.origin
  const rawSeverity = failure.severity
  const origin =
    typeof rawOrigin === 'string' &&
    originValues.has(rawOrigin as AutomaticFailureSummary['origin'])
      ? (rawOrigin as AutomaticFailureSummary['origin'])
      : 'detector'
  const severity =
    typeof rawSeverity === 'string' &&
    severityValues.has(rawSeverity as AutomaticFailureSummary['severity'])
      ? (rawSeverity as AutomaticFailureSummary['severity'])
      : 'minor'
  return {
    id: stringAt(failure.id, failure.failureId) ?? `failure-${index}`,
    code: stringAt(failure.code) ?? 'unknown',
    origin,
    severity,
    message: stringAt(failure.message, failure.detail) ?? 'Automatic finding',
    ...(typeof failure.messageId === 'string' ? { messageId: failure.messageId } : {}),
    ...(typeof failure.toolCallId === 'string' ? { toolCallId: failure.toolCallId } : {}),
  }
}

function rubricNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (typeof candidate === 'string' && candidate.trim() !== '') return [candidate]
    const item = record(candidate)
    const name = stringAt(item?.dimensionId, item?.id, item?.dimension, item?.name, item?.label)
    return name ? [name] : []
  })
}

function rubricDefinitions(...nameLists: readonly string[][]): RubricDefinition[] | undefined {
  const names = [...new Set(nameLists.flat().filter(Boolean))]
  return names.length > 0
    ? names.map((dimensionId) => ({ dimensionId, label: dimensionId }))
    : undefined
}

function snapshotField(snapshot: Record<string, unknown>, snake: string, camel: string): unknown {
  return snapshot[snake] ?? snapshot[camel]
}

interface GroundTruthResolution {
  groundTruth: ReviewGroundTruth
  issue?: string
  language?: string
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function canonicalActions(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((candidate) => {
    const action = record(candidate)
    if (!action || !hasOnlyKeys(action, ['name', 'args_subset', 'argsSubset'])) return candidate
    const argsSubset = action.args_subset ?? action.argsSubset
    return {
      name: action.name,
      ...(argsSubset !== undefined ? { argsSubset } : {}),
    }
  })
}

function canonicalAuthorizedEffects(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((candidate) => {
    const effect = record(candidate)
    if (
      !effect ||
      !hasOnlyKeys(effect, ['order_id', 'orderId', 'effects', 'refund_cap', 'refundCap'])
    ) {
      return candidate
    }
    return {
      orderId: effect.order_id ?? effect.orderId,
      effects: effect.effects,
      ...(effect.refund_cap !== undefined
        ? { refundCap: effect.refund_cap }
        : effect.refundCap !== undefined
          ? { refundCap: effect.refundCap }
          : {}),
    }
  })
}

function canonicalRequiredInfo(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((candidate) => {
    const requirement = record(candidate)
    if (!requirement || !hasOnlyKeys(requirement, ['kind', 'value'])) return candidate
    return { kind: requirement.kind, value: requirement.value }
  })
}

function canonicalStateDelta(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((candidate) => {
    const delta = record(candidate)
    if (!delta || !hasOnlyKeys(delta, ['order_id', 'orderId', 'field', 'to'])) return candidate
    return {
      orderId: delta.order_id ?? delta.orderId,
      field: delta.field,
      to: delta.to,
    }
  })
}

function canonicalPrecedence(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((candidate) => (Array.isArray(candidate) ? [...candidate] : candidate))
}

function groundTruthSections(source: Record<string, unknown>, card: Record<string, unknown>) {
  const issue = stringAt(card.issue, source.issue)
  const language = stringAt(card.language, source.language)
  const personaGoal = stringAt(card.goal, source.goal)
  const expectedOutcome = stringAt(snapshotField(source, 'expected_outcome', 'expectedOutcome'))
  return {
    issue,
    language,
    task: {
      ...(issue ? { issue } : {}),
      ...(language ? { language } : {}),
      ...(personaGoal ? { personaGoal } : {}),
      ...(expectedOutcome ? { expectedOutcome } : {}),
    },
    policy: {
      expectedActions: canonicalActions(
        snapshotField(source, 'expected_actions', 'expectedActions'),
      ),
      forbiddenActions: snapshotField(source, 'forbidden_actions', 'forbiddenActions'),
      authorizedEffects: canonicalAuthorizedEffects(
        snapshotField(source, 'authorized_effects', 'authorizedEffects'),
      ),
      mustPrecede: canonicalPrecedence(snapshotField(source, 'must_precede', 'mustPrecede')),
      consentRequired: snapshotField(source, 'consent_required', 'consentRequired'),
    },
    database: {
      requiredInfo: canonicalRequiredInfo(snapshotField(source, 'required_info', 'requiredInfo')),
      expectedStateDelta: canonicalStateDelta(
        snapshotField(source, 'expected_state_delta', 'expectedStateDelta'),
      ),
    },
    rubric: {
      rewardBasis: snapshotField(source, 'reward_basis', 'rewardBasis'),
      promiseCheck: snapshotField(source, 'promise_check', 'promiseCheck'),
    },
  }
}

function catalogGroundTruth(task: AceTaskDetail | undefined): GroundTruthResolution | undefined {
  if (!task) return undefined
  if (task.conflict || task.variants.length !== 1) {
    return {
      groundTruth: unavailableGroundTruth('task_catalog_definition_conflict', task.scenarioId),
    }
  }
  const variant = task.variants[0]
  if (!variant) {
    return {
      groundTruth: unavailableGroundTruth('task_catalog_definition_invalid', task.scenarioId),
    }
  }
  const source: Record<string, unknown> = {
    expected_actions: variant.expectedActions,
    forbidden_actions: variant.forbiddenActions,
    authorized_effects: variant.authorizedEffects,
    required_info: variant.requiredInfo,
    expected_state_delta: variant.expectedStateDelta,
    must_precede: variant.mustPrecede,
    consent_required: variant.consentRequired,
    expected_outcome: variant.expectedOutcome,
    reward_basis: variant.rewardBasis,
    promise_check: variant.promiseCheck,
  }
  const card: Record<string, unknown> = {
    issue: variant.persona.issue,
    language: variant.persona.language,
    goal: variant.persona.goal,
  }
  const sections = groundTruthSections(source, card)
  const sanitized = sanitizeReviewGroundTruth(
    {
      status: 'reference',
      authoritative: false,
      source: 'current_task_catalog',
      traceBound: false,
      scenarioId: task.scenarioId,
      definitionDigest: variant.definitionDigest,
      task: sections.task,
      policy: sections.policy,
      database: sections.database,
      rubric: sections.rubric,
    },
    task.scenarioId,
  )
  return {
    groundTruth:
      sanitized?.status === 'reference'
        ? sanitized
        : unavailableGroundTruth('task_catalog_definition_invalid', task.scenarioId),
    ...(sections.issue ? { issue: sections.issue } : {}),
    ...(sections.language ? { language: sections.language } : {}),
  }
}

function resolveGroundTruth(
  summary: TraceSummary,
  extra: Record<string, unknown>,
  task: AceTaskDetail | undefined,
): GroundTruthResolution {
  const scenarioId = summary.meta.instanceId
  const snapshot = record(extra.scenario_snapshot) ?? record(extra.scenarioSnapshot)
  const unavailable = (reason: ReviewGroundTruthUnavailableReason): GroundTruthResolution => ({
    groundTruth: unavailableGroundTruth(reason, scenarioId),
  })

  if (!snapshot)
    return catalogGroundTruth(task) ?? unavailable('trace_bound_scenario_snapshot_missing')
  const snapshotProvenance = stringAt(
    extra.scenario_snapshot_provenance,
    extra.scenarioSnapshotProvenance,
  )
  if (snapshotProvenance !== 'episode_sidecar' && snapshotProvenance !== 'batch_manifest') {
    return unavailable('snapshot_provenance_missing')
  }
  const snapshotScenarioId = stringAt(snapshot.scenario_id, snapshot.scenarioId)
  if (!scenarioId || !snapshotScenarioId || snapshotScenarioId !== scenarioId) {
    return unavailable('scenario_id_mismatch')
  }
  const traceConfigDigest = stringAt(extra.config_digest, extra.configDigest)
  const snapshotConfigDigest = stringAt(snapshot.config_digest, snapshot.configDigest)
  if (!traceConfigDigest) return unavailable('config_provenance_missing')
  if (snapshotConfigDigest && snapshotConfigDigest !== traceConfigDigest) {
    return unavailable('config_digest_mismatch')
  }

  const sections = groundTruthSections(snapshot, record(snapshot.card) ?? {})
  const groundTruth = sanitizeReviewGroundTruth(
    {
      status: 'available',
      authoritative: true,
      source: `trace_bound_${snapshotProvenance}_scenario_snapshot`,
      traceBound: true,
      scenarioId,
      configDigest: traceConfigDigest,
      task: sections.task,
      policy: sections.policy,
      database: sections.database,
      rubric: sections.rubric,
    },
    scenarioId,
  )
  return {
    groundTruth: groundTruth ?? unavailableGroundTruth('unsafe_ground_truth_shape', scenarioId),
    ...(sections.issue ? { issue: sections.issue } : {}),
    ...(sections.language ? { language: sections.language } : {}),
  }
}

function evidenceText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'Automatic finding'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function projectTrace(
  summary: TraceSummary,
  full: Trace,
  task: AceTaskDetail | undefined,
  detectorAnalysis?: AutomaticDetectorAnalysis,
): ReviewTraceCandidate {
  const metaRecord = record(summary.meta)
  const fullRecord = record(full)
  const extra = record(summary.meta.extra)
  const identity =
    record(metaRecord?.identity) ?? record(extra?.identity) ?? record(extra?.traceIdentity)
  const evaluation =
    record(summary.evaluation) ??
    record(fullRecord?.evaluation) ??
    record(extra?.evaluation) ??
    record(extra?.traceEvaluation)
  const shadow = record(evaluation?.shadowVerdicts)
  const config = record(extra?.config)
  const traceUid =
    stringAt(summary.meta.traceUid, identity?.traceUid, extra?.traceUid, summary.meta.traceId) ?? ''
  const corpusId =
    stringAt(summary.meta.corpusId, identity?.corpusId, extra?.corpusId, extra?.corpus) ??
    (summary.meta.sourceFormat.startsWith('ace') ? 'simulation' : 'production')
  const runId =
    stringAt(summary.meta.runId, identity?.runId, extra?.runId, extra?.run) ?? 'unassigned'
  const normalizedFailures = summary.evaluation?.failures ?? full.evaluation?.failures
  const failures: AutomaticFailureSummary[] = normalizedFailures
    ? normalizedFailures.map((item, index) => ({
        id: `${item.origin}:${item.code}:${index}`,
        code: item.code,
        origin: item.origin,
        severity: item.severity,
        message: evidenceText(item.evidence),
        ...(item.messageId ? { messageId: item.messageId } : {}),
        ...(item.toolCallId ? { toolCallId: item.toolCallId } : {}),
      }))
    : (Array.isArray(evaluation?.failures) ? evaluation.failures : []).flatMap((item, index) => {
        const parsed = automaticFailure(item, index)
        return parsed ? [parsed] : []
      })
  const normalizedEvaluation = summary.evaluation ?? full.evaluation
  const normalizedGradeVerdicts: Record<string, AutomaticRubricVerdict> | undefined =
    normalizedEvaluation
      ? Object.fromEntries(
          normalizedEvaluation.checks.map((check) => [
            check.name,
            {
              verdict: check.ok ? ('pass' as const) : ('fail' as const),
              ...(check.detail ? { critique: check.detail } : {}),
            },
          ]),
        )
      : undefined
  const normalizedJudgeVerdicts: Record<string, AutomaticRubricVerdict> | undefined =
    normalizedEvaluation?.judge
      ? Object.fromEntries(
          Object.entries(normalizedEvaluation.judge.dimensions).map(([dimensionId, dimension]) => [
            dimensionId,
            {
              verdict:
                dimension.verdict === 'pass' || dimension.verdict === 'fail'
                  ? dimension.verdict
                  : ('unknown' as const),
              ...(dimension.evidence ? { critique: dimension.evidence } : {}),
            },
          ]),
        )
      : undefined
  const normalizedDetectorVerdicts: Record<string, AutomaticRubricVerdict> | undefined =
    normalizedEvaluation
      ? Object.fromEntries(
          normalizedEvaluation.flags.map((flag) => [
            flag.detector,
            {
              verdict: flag.verdict === 'pass' ? ('pass' as const) : ('fail' as const),
              ...(flag.note || flag.evidence ? { critique: flag.note ?? flag.evidence ?? '' } : {}),
            },
          ]),
        )
      : undefined
  const model = summary.stats.model?.name ?? normalizedEvaluation?.judge?.model
  const arm = stringAt(extra?.arm, extra?.abArm, config?.arm)
  const outcome =
    normalizedEvaluation?.outcome ??
    (typeof evaluation?.outcome === 'string' ? evaluation.outcome : undefined)
  const gradeVerdicts =
    normalizedGradeVerdicts ?? verdictMap(evaluation?.gradeVerdicts ?? evaluation?.checks)
  const judgeVerdicts =
    normalizedJudgeVerdicts ??
    verdictMap(evaluation?.judgeVerdicts ?? shadow?.judge ?? extra?.judge)
  const detectorVerdicts =
    normalizedDetectorVerdicts ?? verdictMap(evaluation?.detectorVerdicts ?? extra?.detectors)
  // Definitions expose names only. Automatic ok/detail/judge outputs remain in
  // `automatic`, which the Calibration API removes until submit.
  const rubric = rubricDefinitions(
    normalizedEvaluation?.checks.map((check) => check.name) ?? [],
    rubricNames(extra?.rubric),
    rubricNames(evaluation?.rubric),
    rubricNames(evaluation?.checks),
  )
  // A current catalog checkout is not trace-bound: old sealed traces may have
  // used different order IDs or definitions. Only matching snapshot/config
  // provenance is authoritative.
  const groundTruthResolution =
    corpusId === 'simulation' ? resolveGroundTruth(summary, extra ?? {}, task) : undefined
  const safeGroundTruth =
    groundTruthResolution?.groundTruth ??
    (extra?.groundTruth !== undefined
      ? unavailableGroundTruth('unsafe_ground_truth_shape', summary.meta.instanceId)
      : undefined)
  const automatic: AutomaticReviewContext = {
    ...(model ? { model } : {}),
    ...(arm ? { arm } : {}),
    ...(outcome ? { outcome } : {}),
    ...(gradeVerdicts ? { gradeVerdicts } : {}),
    ...(judgeVerdicts ? { judgeVerdicts } : {}),
    ...(detectorVerdicts ? { detectorVerdicts } : {}),
    ...(failures.length > 0 ? { failures } : {}),
    ...(detectorAnalysis ? { detectorAnalysis } : {}),
  }
  const automaticPresent = Object.keys(automatic).length > 0

  return {
    trace: {
      corpusId,
      runId,
      traceUid,
      sourceTraceId: summary.meta.sourceTraceId ?? summary.meta.traceId,
      instanceId: summary.meta.instanceId,
      timestamp: summary.meta.timestamp,
      ...(typeof extra?.issue === 'string'
        ? { issue: extra.issue }
        : groundTruthResolution?.issue
          ? { issue: groundTruthResolution.issue }
          : {}),
      ...(typeof extra?.language === 'string'
        ? { language: extra.language }
        : groundTruthResolution?.language
          ? { language: groundTruthResolution.language }
          : {}),
      transcript: full.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        ...(message.timestamp ? { timestamp: message.timestamp } : {}),
      })),
      ...(rubric ? { rubric } : {}),
      ...(safeGroundTruth !== undefined ? { groundTruth: safeGroundTruth } : {}),
    },
    ...(automaticPresent ? { automatic } : {}),
  }
}

/** Adapter kept outside TraceStore so the review subsystem does not own ingest. */
export function createTraceStoreReviewSource(
  store: TraceStore,
  options: ReviewTraceSourceOptions = {},
): ReviewTraceSource {
  let cachedVersion = -1
  let cachedCatalogDigest: string | null = null
  let cachedAnalysisKey: string | null = null
  let cachedCandidates: Promise<ReviewTraceCandidate[]> | null = null

  const detectorAnalysis = async (): Promise<{
    byTraceUid: Map<string, AutomaticDetectorAnalysis>
    key: string
  }> => {
    const productionSummaries = () =>
      store.list().filter((summary) => summary.meta.corpusId === 'production')
    const production = productionSummaries()
    if (production.length === 0) return { byTraceUid: new Map(), key: 'none' }

    const unavailable = (
      reason: Extract<AutomaticDetectorAnalysis, { status: 'unavailable' }>['reason'],
    ): AutomaticDetectorAnalysis => ({
      status: 'unavailable',
      source: 'ace.detector_registry',
      reason,
    })
    if (!options.analysisCoordinator) {
      return {
        byTraceUid: new Map(
          productionSummaries().map((summary) => [
            summary.meta.traceUid ?? summary.meta.traceId,
            unavailable('coordinator_not_configured'),
          ]),
        ),
        key: 'unavailable:coordinator_not_configured',
      }
    }

    try {
      await options.analysisCoordinator.load()
    } catch {
      return {
        byTraceUid: new Map(
          productionSummaries().map((summary) => [
            summary.meta.traceUid ?? summary.meta.traceId,
            unavailable('analysis_failed'),
          ]),
        ),
        key: 'unavailable:analysis_failed',
      }
    }

    const byTraceUid = new Map<string, AutomaticDetectorAnalysis>()
    for (const summary of store
      .list()
      .filter((candidate) => candidate.meta.corpusId === 'production')) {
      const traceUid = summary.meta.traceUid ?? summary.meta.traceId
      const status = options.analysisCoordinator.statusForTrace(traceUid)
      byTraceUid.set(
        traceUid,
        status.status === 'available'
          ? { status: 'available', source: 'ace.detector_registry' }
          : unavailable(status.reason),
      )
    }
    const key = [...byTraceUid]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([traceUid, status]) =>
        status.status === 'available' ? `${traceUid}:available` : `${traceUid}:${status.reason}`,
      )
      .join('|')
    return { byTraceUid, key }
  }

  const tasks = async (): Promise<{
    byId: Map<string, AceTaskDetail>
    digest: string | null
  }> => {
    if (!options.loadTaskCatalog) return { byId: new Map(), digest: null }
    const catalog = await options.loadTaskCatalog().catch(() => null)
    return {
      byId: new Map(catalog?.tasks.map((task) => [task.scenarioId, task]) ?? []),
      digest: catalog ? (catalog.source.catalogDigest ?? JSON.stringify(catalog.tasks)) : null,
    }
  }

  const candidates = async (): Promise<ReviewTraceCandidate[]> => {
    // Detector analysis runs last: once it resolves, projection below is
    // synchronous, so a slow task-catalog read cannot leave us with a stale
    // analysis snapshot for a source that changed in the meantime.
    const taskSnapshot = await tasks()
    const analysisSnapshot = await detectorAnalysis()
    if (
      cachedVersion === store.dataVersion &&
      cachedCatalogDigest === taskSnapshot.digest &&
      cachedAnalysisKey === analysisSnapshot.key &&
      cachedCandidates
    ) {
      return cachedCandidates
    }
    const summaries = store.list()
    cachedVersion = store.dataVersion
    cachedCatalogDigest = taskSnapshot.digest
    cachedAnalysisKey = analysisSnapshot.key
    cachedCandidates = Promise.resolve(
      summaries.flatMap((summary) => {
        const metaRecord = record(summary.meta)
        const identity =
          record(metaRecord?.identity) ??
          record(record(summary.meta.extra)?.identity) ??
          record(record(summary.meta.extra)?.traceIdentity)
        const lookupId =
          stringAt(summary.meta.traceUid, identity?.traceUid, summary.meta.traceId) ??
          summary.meta.traceId
        const full = store.getFull(lookupId) ?? store.getFull(summary.meta.traceId)
        const task =
          summary.meta.corpusId === 'simulation' && summary.meta.instanceId
            ? taskSnapshot.byId.get(summary.meta.instanceId)
            : undefined
        return full
          ? [projectTrace(summary, full, task, analysisSnapshot.byTraceUid.get(lookupId))]
          : []
      }),
    )
    return cachedCandidates
  }
  return {
    list: candidates,
    async get(traceUid) {
      return (await candidates()).find((candidate) => candidate.trace.traceUid === traceUid) ?? null
    },
  }
}

export function createStaticReviewTraceSource(
  candidates: readonly ReviewTraceCandidate[],
): ReviewTraceSource {
  return {
    list: () => candidates,
    get: (traceUid) =>
      candidates.find((candidate) => candidate.trace.traceUid === traceUid) ?? null,
  }
}
