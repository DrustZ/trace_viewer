import type {
  AutomaticFailureSummary,
  AutomaticReviewContext,
  AutomaticRubricVerdict,
  ReviewTraceContext,
  RubricDefinition,
} from '../../shared/reviews/types'
import type { AceTaskDetail } from '../../shared/schema/aceTasks'
import type { Trace, TraceSummary } from '../../shared/schema/types'
import type { AceTaskCatalog } from '../ace/taskCatalog'
import type { TraceStore } from '../store/traceStore'

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

function currentCatalogReference(task: AceTaskDetail | undefined): unknown {
  if (!task) return undefined
  const uniqueVariant = !task.conflict && task.variants.length === 1 ? task.variants[0] : undefined
  return {
    source: 'current_catalog_unverified',
    authoritative: false,
    scenarioId: task.scenarioId,
    conflict: task.conflict || task.variants.length !== 1,
    ...(task.issue ? { issue: task.issue } : {}),
    ...(task.language ? { language: task.language } : {}),
    ...(uniqueVariant?.persona.goal ? { personaGoal: uniqueVariant.persona.goal } : {}),
  }
}

function definitionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(definitionValue)
  const object = record(value)
  if (!object) return value
  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => !/canary/i.test(key))
      .map(([key, child]) => [key, definitionValue(child)]),
  )
}

function snapshotField(snapshot: Record<string, unknown>, snake: string, camel: string): unknown {
  return snapshot[snake] ?? snapshot[camel]
}

interface GroundTruthResolution {
  groundTruth: unknown
  issue?: string
  language?: string
}

function resolveGroundTruth(
  summary: TraceSummary,
  extra: Record<string, unknown>,
  task: AceTaskDetail | undefined,
): GroundTruthResolution {
  const scenarioId = summary.meta.instanceId
  const snapshot = record(extra.scenario_snapshot) ?? record(extra.scenarioSnapshot)
  const reference = currentCatalogReference(task)
  const unavailable = (reason: string): GroundTruthResolution => ({
    groundTruth: {
      status: 'unavailable',
      authoritative: false,
      reason,
      ...(scenarioId ? { scenarioId } : {}),
      ...(reference ? { currentDefinitionReference: reference } : {}),
    },
  })

  if (!snapshot) return unavailable('trace_bound_scenario_snapshot_missing')
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

  const card = record(snapshot.card) ?? {}
  const issue = stringAt(card.issue, snapshot.issue)
  const language = stringAt(card.language, snapshot.language)
  const goal = stringAt(card.goal, snapshot.goal)
  const definition = {
    ...(issue ? { issue } : {}),
    ...(language ? { language } : {}),
    ...(goal ? { persona: { goal } } : {}),
    expectedActions: definitionValue(
      snapshotField(snapshot, 'expected_actions', 'expectedActions'),
    ),
    forbiddenActions: definitionValue(
      snapshotField(snapshot, 'forbidden_actions', 'forbiddenActions'),
    ),
    requiredInfo: definitionValue(snapshotField(snapshot, 'required_info', 'requiredInfo')),
    expectedStateDelta: definitionValue(
      snapshotField(snapshot, 'expected_state_delta', 'expectedStateDelta'),
    ),
    mustPrecede: definitionValue(snapshotField(snapshot, 'must_precede', 'mustPrecede')),
    consentRequired: snapshotField(snapshot, 'consent_required', 'consentRequired'),
    expectedOutcome: snapshotField(snapshot, 'expected_outcome', 'expectedOutcome'),
  }
  return {
    groundTruth: {
      status: 'available',
      authoritative: true,
      source: `trace_bound_${snapshotProvenance}_scenario_snapshot`,
      scenarioId,
      configDigest: traceConfigDigest,
      definition,
    },
    ...(issue ? { issue } : {}),
    ...(language ? { language } : {}),
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
  const fallbackGroundTruth = groundTruthResolution?.groundTruth ?? extra?.groundTruth
  const automatic: AutomaticReviewContext = {
    ...(model ? { model } : {}),
    ...(arm ? { arm } : {}),
    ...(outcome ? { outcome } : {}),
    ...(gradeVerdicts ? { gradeVerdicts } : {}),
    ...(judgeVerdicts ? { judgeVerdicts } : {}),
    ...(detectorVerdicts ? { detectorVerdicts } : {}),
    ...(failures.length > 0 ? { failures } : {}),
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
      ...(fallbackGroundTruth !== undefined ? { groundTruth: fallbackGroundTruth } : {}),
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
  let cachedCandidates: Promise<ReviewTraceCandidate[]> | null = null

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
    const taskSnapshot = await tasks()
    if (
      cachedVersion === store.dataVersion &&
      cachedCatalogDigest === taskSnapshot.digest &&
      cachedCandidates
    ) {
      return cachedCandidates
    }
    const summaries = store.list()
    cachedVersion = store.dataVersion
    cachedCatalogDigest = taskSnapshot.digest
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
        return full ? [projectTrace(summary, full, task)] : []
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
