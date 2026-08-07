import type {
  BatchEpisode,
  BatchSummary,
  DetectorFlag,
  FailureSeverity,
  FailureV1,
  GradeCheck,
  JudgeDimension,
  JudgeEvaluation,
  Message,
  ReplayLineage,
  SemanticClaim,
  SemanticVerification,
  ToolLedgerEntry,
  TraceEvaluation,
  TraceMeta,
  TraceOutcome,
  TraceStats,
  TraceStatus,
  UserSimGate,
  UserSimViolation,
  WorldDiffEntry,
} from '../schema/types'
import type { ParsedTrace } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function severity(value: unknown, fallback: FailureSeverity = 'minor'): FailureSeverity {
  if (value === 'critical' || value === 'major' || value === 'minor' || value === 'info') {
    return value
  }
  if (value === 'error' || value === 'fatal') return 'critical'
  if (value === 'warning' || value === 'warn') return 'minor'
  return fallback
}

function snakeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function batchEpisode(value: Record<string, unknown>): BatchEpisode | null {
  const scenarioId = stringValue(value.scenario_id) ?? stringValue(value.scenarioId)
  const environmentSeed =
    numberValue(value.environment_seed) ??
    numberValue(value.environmentSeed) ??
    numberValue(value.seed)
  if (!scenarioId || environmentSeed === undefined) return null
  return {
    ...value,
    scenarioId,
    environmentSeed,
    sourceFile: stringValue(value.file) ?? stringValue(value.sourceFile),
    status: stringValue(value.status),
    phase: stringValue(value.phase),
    toolName: stringValue(value.tool_name) ?? stringValue(value.toolName),
    messageCount: numberValue(value.message_count) ?? numberValue(value.messageCount),
    updatedAt: stringValue(value.updated_at) ?? stringValue(value.updatedAt),
    termination: stringValue(value.termination),
    invalidUserSim: booleanValue(value.invalid_user_sim) ?? booleanValue(value.invalidUserSim),
    gradePassed: isRecord(value.grade) ? (booleanValue(value.grade.passed) ?? null) : null,
  }
}

function batchEpisodeKey(episode: BatchEpisode): string {
  return episode.sourceFile ?? `${episode.scenarioId}\0${episode.environmentSeed}`
}

/** Strict enough to exclude unrelated JSON while retaining future manifest fields. */
export function parseAceBatchManifest(value: unknown): BatchSummary | null {
  if (!isRecord(value)) return null
  const batchId = stringValue(value.batch_id) ?? stringValue(value.batchId)
  if (!batchId || !Array.isArray(value.episodes)) return null
  const scheduled = records(value.episode_states ?? value.episodeStates)
    .map(batchEpisode)
    .filter((episode): episode is BatchEpisode => episode !== null)
  const completed = records(value.episodes)
    .map(batchEpisode)
    .filter((episode): episode is BatchEpisode => episode !== null)
  const byEpisode = new Map(scheduled.map((episode) => [batchEpisodeKey(episode), episode]))
  for (const episode of completed) {
    const key = batchEpisodeKey(episode)
    byEpisode.set(key, { ...byEpisode.get(key), ...episode })
  }
  const lifecycle = snakeRecord(value.lifecycle)
  const episodes = [...byEpisode.values()]
  return {
    schemaVersion: numberValue(value.schema_version) ?? numberValue(value.schemaVersion),
    batchId,
    lifecycle: stringValue(lifecycle.status) ?? stringValue(value.lifecycle),
    heartbeat:
      stringValue(lifecycle.heartbeat_at) ??
      stringValue(lifecycle.heartbeatAt) ??
      stringValue(value.heartbeat),
    configDigest: stringValue(value.config_digest) ?? stringValue(value.configDigest),
    scheduleDigest: stringValue(value.schedule_digest) ?? stringValue(value.scheduleDigest),
    spec: isRecord(value.spec) ? value.spec : undefined,
    configSnapshot: isRecord(value.config_snapshot)
      ? value.config_snapshot
      : isRecord(value.configSnapshot)
        ? value.configSnapshot
        : undefined,
    scenarioSnapshots: records(value.scenario_snapshot ?? value.scenarioSnapshots),
    totals: isRecord(value.totals) ? value.totals : undefined,
    episodes,
  }
}

function messageAtRawIndex(messages: Message[], rawIndex: number | undefined): Message | undefined {
  if (rawIndex === undefined) return undefined
  return messages.find((message, index) => (message.rawIndex ?? index) === rawIndex)
}

function indexedFields(messages: Message[], rawIndex: number | undefined) {
  if (rawIndex === undefined) return { indexSpace: 'raw' as const }
  const message = messageAtRawIndex(messages, rawIndex)
  return {
    indexSpace: 'raw' as const,
    rawIndex,
    ...(message?.chronologicalIndex !== undefined
      ? { chronologicalIndex: message.chronologicalIndex }
      : {}),
    ...(message?.id ? { messageId: message.id } : { messageId: `m-${rawIndex}` }),
  }
}

function normalizeFlag(value: Record<string, unknown>, messages: Message[]): DetectorFlag | null {
  const detector = stringValue(value.detector) ?? stringValue(value.code)
  if (!detector) return null
  const rawIndex = numberValue(value.idx) ?? numberValue(value.message_index)
  return {
    detector,
    severity: severity(value.severity, 'info'),
    tier: stringValue(value.tier),
    family: stringValue(value.family),
    note: stringValue(value.note),
    verdict: stringValue(value.verdict),
    evidence: stringValue(value.evidence),
    ...indexedFields(messages, rawIndex),
  }
}

function normalizeFlags(value: unknown, messages: Message[]): DetectorFlag[] {
  const out: DetectorFlag[] = []
  const seen = new Set<string>()
  for (const flag of records(value)) {
    const normalized = normalizeFlag(flag, messages)
    if (!normalized) continue
    const key = [
      normalized.detector,
      normalized.rawIndex ?? '',
      normalized.note ?? '',
      normalized.evidence ?? '',
    ].join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function normalizeChecks(value: unknown): GradeCheck[] {
  return records(value).flatMap((check) => {
    const name = stringValue(check.name)
    const ok = booleanValue(check.ok)
    if (!name || ok === undefined) return []
    return [
      {
        name,
        ok,
        gating: booleanValue(check.gating) ?? false,
        detail: stringValue(check.detail),
      },
    ]
  })
}

function normalizeUserGate(value: unknown, messages: Message[]): UserSimGate | undefined {
  if (!isRecord(value)) return undefined
  const violations: UserSimViolation[] = records(value.violations).flatMap((entry) => {
    const rule = stringValue(entry.rule)
    if (!rule) return []
    const rawIndex = numberValue(entry.idx) ?? numberValue(entry.message_index)
    return [
      {
        rule,
        severity: severity(entry.severity, 'major'),
        note: stringValue(entry.note),
        ...indexedFields(messages, rawIndex),
      },
    ]
  })
  return {
    invalid: booleanValue(value.invalid) ?? false,
    attempt: numberValue(value.attempt),
    seed: numberValue(value.seed),
    environmentSeed: numberValue(value.environment_seed) ?? numberValue(value.environmentSeed),
    userSampleNonce: numberValue(value.user_sample_nonce) ?? numberValue(value.userSampleNonce),
    violations,
  }
}

function normalizeWorldDiff(value: unknown): WorldDiffEntry[] {
  return records(value).flatMap((entry) => {
    const field = stringValue(entry.field)
    if (!field) return []
    return [
      {
        orderId: stringValue(entry.order_id) ?? stringValue(entry.orderId),
        field,
        ...('before' in entry ? { before: entry.before } : {}),
        ...('after' in entry ? { after: entry.after } : {}),
        legal: booleanValue(entry.legal),
      },
    ]
  })
}

function normalizeLedger(value: unknown): ToolLedgerEntry[] {
  return records(value).flatMap((entry) => {
    const name = stringValue(entry.name)
    if (!name) return []
    const seconds = numberValue(entry.ts)
    return [
      {
        tier: stringValue(entry.tier),
        name,
        ...('args' in entry ? { args: entry.args } : {}),
        ok: booleanValue(entry.ok),
        ...('result' in entry ? { result: entry.result } : {}),
        resultHead: stringValue(entry.result_head) ?? stringValue(entry.resultHead),
        executed: booleanValue(entry.executed),
        outcomeKnown: booleanValue(entry.outcome_known) ?? booleanValue(entry.outcomeKnown),
        ...('actual_result' in entry
          ? { actualResult: entry.actual_result }
          : 'actualResult' in entry
            ? { actualResult: entry.actualResult }
            : {}),
        actualResultHead:
          stringValue(entry.actual_result_head) ?? stringValue(entry.actualResultHead),
        ...(seconds !== undefined
          ? { sourceTimestampSeconds: seconds, timestamp: new Date(seconds * 1000).toISOString() }
          : {}),
        toolCallId: stringValue(entry.tool_call_id) ?? stringValue(entry.toolCallId),
      },
    ]
  })
}

function normalizeJudgeDimension(value: unknown): JudgeDimension | undefined {
  if (!isRecord(value)) return undefined
  const verdict = stringValue(value.verdict)
  if (!verdict) return undefined
  return { verdict, evidence: stringValue(value.evidence) }
}

function normalizeJudge(value: unknown): JudgeEvaluation | undefined {
  if (!isRecord(value)) return undefined
  const dimensions: Record<string, JudgeDimension> = {}
  if (isRecord(value.dimensions)) {
    for (const [name, raw] of Object.entries(value.dimensions)) {
      const dimension = normalizeJudgeDimension(raw)
      if (dimension) dimensions[name] = dimension
    }
  }
  return {
    model: stringValue(value.model),
    rubricVersion: stringValue(value.rubric_version) ?? stringValue(value.rubricVersion),
    dimensions,
    outcomeSecondOpinion: normalizeJudgeDimension(
      value.outcome_second_opinion ?? value.outcomeSecondOpinion,
    ),
    disagreement: booleanValue(value.disagreement),
    error: stringValue(value.error),
  }
}

function normalizeSemantic(value: unknown, messages: Message[]): SemanticVerification | undefined {
  if (!isRecord(value)) return undefined
  const claims: SemanticClaim[] = records(value.claims).map((claim) => {
    const rawIndex = numberValue(claim.message_index) ?? numberValue(claim.idx)
    const span =
      Array.isArray(claim.span) &&
      claim.span.length === 2 &&
      numberValue(claim.span[0]) !== undefined &&
      numberValue(claim.span[1]) !== undefined
        ? ([claim.span[0], claim.span[1]] as [number, number])
        : undefined
    return {
      kind: stringValue(claim.kind),
      ...('value' in claim ? { value: claim.value } : {}),
      verdict: stringValue(claim.verdict),
      basis: stringValue(claim.basis),
      span,
      quote: stringValue(claim.quote),
      ...indexedFields(messages, rawIndex),
    }
  })
  return {
    schemaVersion: numberValue(value.schema_version) ?? numberValue(value.schemaVersion),
    mode: stringValue(value.mode),
    engine: stringValue(value.engine),
    model: value.model === null ? null : stringValue(value.model),
    claims,
    supportedCount: numberValue(value.supported_count) ?? numberValue(value.supportedCount),
    contradictedCount:
      numberValue(value.contradicted_count) ?? numberValue(value.contradictedCount),
    unverifiedCount: numberValue(value.unverified_count) ?? numberValue(value.unverifiedCount),
    findings: normalizeFlags(value.findings, messages),
    consent: value.consent,
    disclosures: Array.isArray(value.disclosures) ? value.disclosures : undefined,
    error: stringValue(value.error),
  }
}

function normalizeLineage(value: unknown): ReplayLineage | undefined {
  if (!isRecord(value)) return undefined
  const rawCheckpointId = value.checkpoint_id ?? value.checkpointId
  const lineage: ReplayLineage = {
    relation: stringValue(value.relation),
    parentTrace: stringValue(value.parent_trace) ?? stringValue(value.parentTrace),
    parentTraceUid: stringValue(value.parent_trace_uid) ?? stringValue(value.parentTraceUid),
    checkpointId:
      stringValue(rawCheckpointId) ??
      (numberValue(rawCheckpointId) !== undefined ? String(rawCheckpointId) : undefined),
    forkMessageId: stringValue(value.fork_message_id) ?? stringValue(value.forkMessageId),
    forkMessageCount: numberValue(value.fork_message_count) ?? numberValue(value.forkMessageCount),
    configDigest: stringValue(value.config_digest) ?? stringValue(value.configDigest),
    fidelity: stringValue(value.fidelity),
    runKind: stringValue(value.run_kind) ?? stringValue(value.runKind),
    mode: stringValue(value.mode),
    policyChanged: booleanValue(value.policy_changed) ?? booleanValue(value.policyChanged),
    regressionId: stringValue(value.regression_id) ?? stringValue(value.regressionId),
    synthetic: booleanValue(value.synthetic),
    formalMetricsExcluded:
      booleanValue(value.formal_metrics_excluded) ?? booleanValue(value.formalMetricsExcluded),
  }
  return Object.values(lineage).some((item) => item !== undefined) ? lineage : undefined
}

function scenarioGroundTruth(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  // The canary is an internal prompt-leak sentinel, not part of the review task
  // definition. Keep it out of calibration ground truth and metadata projection.
  const { canary: _canary, ...scenario } = value
  return scenario
}

function traceStatus(raw: unknown, fallback: TraceStatus): TraceStatus {
  if (raw === 'completed') return 'completed'
  if (raw === 'executing' || raw === 'running' || raw === 'pending') return 'executing'
  if (raw === 'failed' || raw === 'error') return 'failed'
  return fallback
}

function lifecycleState(
  raw: unknown,
  fallback: TraceStatus,
): TraceEvaluation['lifecycle']['state'] {
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled'
  return traceStatus(raw, fallback)
}

function normalizeSplit(raw: unknown, fallback: TraceMeta['split']): TraceMeta['split'] {
  if (raw === 'train') return 'train'
  if (raw === 'test' || raw === 'holdout' || raw === 'sealed') return 'test'
  return fallback
}

function failureKey(failure: FailureV1): string {
  return [
    failure.origin,
    failure.code,
    failure.rawIndex ?? '',
    failure.toolCallId ?? '',
    typeof failure.evidence === 'string'
      ? failure.evidence
      : JSON.stringify(failure.evidence ?? ''),
  ].join('\u0000')
}

function dedupeFailures(failures: FailureV1[]): FailureV1[] {
  const seen = new Set<string>()
  return failures.filter((failure) => {
    const key = failureKey(failure)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function genericFailures(parsed: ParsedTrace, ledger: ToolLedgerEntry[]): FailureV1[] {
  const failures: FailureV1[] = []
  if (parsed.statsOverrides?.truncated) {
    failures.push({
      origin: 'integrity',
      code: 'truncated_source',
      severity: 'critical',
      gating: false,
      evidence: 'The source ended mid-write; only its parseable prefix was recovered.',
      source: 'connector',
    })
  }
  for (const warning of parsed.warnings) {
    if (
      !/timestamp regression|could not be safely linked|truncated|invalid|orphan/i.test(warning)
    ) {
      continue
    }
    failures.push({
      origin: 'integrity',
      code: /timestamp regression/i.test(warning)
        ? 'timestamp_regression'
        : /linked|orphan/i.test(warning)
          ? 'unlinked_tool_result'
          : 'source_integrity',
      severity: /truncated|invalid/i.test(warning) ? 'major' : 'minor',
      gating: false,
      evidence: warning,
      source: 'connector',
    })
  }
  // The ACE ledger knows whether a write executed despite a lost response and
  // therefore supersedes the transcript's less precise "Error:" heuristic.
  if (ledger.length === 0) {
    for (const message of parsed.messages) {
      if (!message.toolResult?.isError) continue
      failures.push({
        origin: 'tool',
        code: `tool.${String(message.metadata?.toolName ?? 'unknown')}.error`,
        severity: 'major',
        gating: false,
        toolCallId: message.toolResult.toolCallId || undefined,
        ...indexedFields(parsed.messages, message.rawIndex),
        evidence: message.content,
        source: 'transcript.tool_result',
      })
    }
  }
  return failures
}

function outcomeOf(
  lifecycle: TraceEvaluation['lifecycle']['state'],
  invalid: boolean,
  gradePassed: boolean | undefined,
): TraceOutcome {
  if (invalid) return 'invalid'
  if (lifecycle === 'failed') return 'runtime_error'
  if (gradePassed === true) return 'pass'
  if (gradePassed === false) return 'fail'
  return 'ungraded'
}

export interface AceArtifactContext {
  batch?: BatchSummary | null
  sourceFile?: string
}

/**
 * Merge an ACE `.meta.json` sidecar and sibling `batch.json` row into the
 * connector result.  The raw artifacts are never mutated and all shadow
 * channels remain explicitly non-gating.
 */
export function applyAceArtifacts(
  parsed: ParsedTrace,
  sidecarValue?: unknown,
  context: AceArtifactContext = {},
): ParsedTrace {
  const sidecar = snakeRecord(sidecarValue)
  const sourceMeta = snakeRecord(sidecar.meta)
  const sourceExtra = snakeRecord(sourceMeta.extra)
  const provenance = snakeRecord(sidecar.provenance)
  const rawEvaluation = snakeRecord(sidecar.evaluation)
  const grade = snakeRecord(rawEvaluation.grade)
  const episodeRecord = snakeRecord(sidecar.episode_record ?? sidecar.episodeRecord)
  const sourceFile = context.sourceFile
  const episode = context.batch?.episodes.find(
    (candidate) => !sourceFile || candidate.sourceFile === sourceFile,
  )

  const scenarioId =
    stringValue(sourceExtra.scenario_id) ??
    stringValue(sourceExtra.scenarioId) ??
    episode?.scenarioId
  const environmentSeed =
    numberValue(sourceExtra.environment_seed) ??
    numberValue(sourceExtra.environmentSeed) ??
    episode?.environmentSeed
  const scheduleDigest = context.batch?.scheduleDigest ?? stringValue(provenance.schedule_digest)
  const pairKey =
    scheduleDigest && scenarioId && environmentSeed !== undefined
      ? `${scheduleDigest}:${scenarioId}:${environmentSeed}`
      : stringValue(provenance.pair_key)

  const metrics = isRecord(rawEvaluation.metrics) ? rawEvaluation.metrics : {}
  const rawStatus = episode?.status ?? metrics.status
  const status = traceStatus(rawStatus, parsed.meta.status)
  const lifecycle = lifecycleState(rawStatus, status)
  const pendingPhase =
    lifecycle === 'executing' && episode?.phase
      ? episode.toolName
        ? `${episode.phase}: ${episode.toolName}`
        : episode.phase
      : undefined
  const termination =
    episode?.termination ?? stringValue(metrics.termination) ?? stringValue(sourceExtra.termination)
  const checks = normalizeChecks(grade.checks)
  const gradePassed = booleanValue(grade.passed) ?? episode?.gradePassed ?? undefined
  const userSimGate = normalizeUserGate(
    sidecar.user_sim_gate ?? sidecar.userSimGate,
    parsed.messages,
  )
  const worldDiff = normalizeWorldDiff(episodeRecord.world_diff ?? episodeRecord.worldDiff)
  const ledger = normalizeLedger(episodeRecord.ledger)
  const evaluationFlags = normalizeFlags(rawEvaluation.flags, parsed.messages)
  const analysis = snakeRecord(sidecar.analysis)
  const analysisFlags = normalizeFlags(analysis.flags ?? sidecar.flags, parsed.messages)
  const semanticVerify = normalizeSemantic(
    sidecar.semantic_verify ?? sidecar.semanticVerify,
    parsed.messages,
  )
  const flags = normalizeFlags(
    [...evaluationFlags, ...analysisFlags, ...(semanticVerify?.findings ?? [])].map((flag) => ({
      detector: flag.detector,
      severity: flag.severity,
      tier: flag.tier,
      family: flag.family,
      note: flag.note,
      verdict: flag.verdict,
      evidence: flag.evidence,
      idx: flag.rawIndex,
    })),
    parsed.messages,
  )
  const judge = normalizeJudge(sidecar.judge)
  const rawLineage = snakeRecord(
    sidecar.lineage ??
      sidecar.replay_lineage ??
      sidecar.replayLineage ??
      provenance.lineage ??
      sourceExtra.lineage,
  )
  const lineage = normalizeLineage({
    ...rawLineage,
    run_kind: rawLineage.run_kind ?? provenance.run_kind,
    config_digest: rawLineage.config_digest ?? provenance.config_digest,
  })

  const failures: FailureV1[] = genericFailures(parsed, ledger)
  if (lifecycle === 'failed') {
    failures.push({
      origin: 'runtime',
      code: termination ? `runtime.${termination}` : 'runtime.failed',
      severity: 'critical',
      gating: false,
      evidence: termination ? `Episode terminated with ${termination}.` : 'Episode runtime failed.',
      source: 'ace.batch',
    })
  }
  for (const check of checks) {
    if (check.ok) continue
    failures.push({
      origin: 'grader',
      code: `grade.${check.name.toLowerCase()}`,
      severity: check.gating ? 'major' : 'minor',
      gating: check.gating,
      evidence: check.detail,
      source: 'ace.grade_atomic',
    })
  }
  for (const flag of flags) {
    const semantic = flag.tier === 'semantic_shadow'
    failures.push({
      origin: semantic ? 'semantic' : 'detector',
      code: flag.detector,
      severity: flag.severity,
      gating: false,
      messageId: flag.messageId,
      indexSpace: flag.indexSpace,
      rawIndex: flag.rawIndex,
      chronologicalIndex: flag.chronologicalIndex,
      evidence: flag.evidence ?? flag.note,
      source: semantic ? 'ace.semantic_verify' : `ace.detector.${flag.tier ?? 'unknown'}`,
    })
  }
  if (userSimGate) {
    for (const violation of userSimGate.violations) {
      failures.push({
        origin: 'user_sim',
        code: violation.rule,
        severity: violation.severity ?? 'major',
        gating: userSimGate.invalid,
        messageId: violation.messageId,
        indexSpace: violation.indexSpace,
        rawIndex: violation.rawIndex,
        chronologicalIndex: violation.chronologicalIndex,
        evidence: violation.note,
        source: 'ace.user_sim_gate',
      })
    }
    if (userSimGate.invalid && userSimGate.violations.length === 0) {
      failures.push({
        origin: 'user_sim',
        code: 'invalid_user_sim',
        severity: 'major',
        gating: true,
        source: 'ace.user_sim_gate',
      })
    }
  }
  for (const entry of ledger) {
    if (entry.ok === false) {
      failures.push({
        origin: 'tool',
        code: `tool.${entry.name}.error`,
        severity: 'major',
        gating: false,
        toolCallId: entry.toolCallId,
        evidence: typeof entry.result === 'string' ? entry.result : { result: entry.result },
        source: 'ace.episode_record.ledger',
      })
    }
    if (entry.outcomeKnown === false) {
      failures.push({
        origin: 'tool',
        code: `tool.${entry.name}.unknown_outcome`,
        severity: 'major',
        gating: false,
        toolCallId: entry.toolCallId,
        evidence: entry.resultHead,
        source: 'ace.episode_record.ledger',
      })
    }
  }
  if (judge) {
    for (const [dimension, verdict] of Object.entries(judge.dimensions)) {
      if (verdict.verdict !== 'fail') continue
      failures.push({
        origin: 'judge',
        code: `judge.${dimension}`,
        severity: 'minor',
        gating: false,
        evidence: verdict.evidence,
        source: `ace.judge.${judge.rubricVersion ?? 'unknown'}`,
      })
    }
    if (judge.error) {
      failures.push({
        origin: 'judge',
        code: 'judge.error',
        severity: 'minor',
        gating: false,
        evidence: judge.error,
        source: 'ace.judge',
      })
    }
  }
  if (semanticVerify?.error) {
    failures.push({
      origin: 'semantic',
      code: 'semantic.error',
      severity: 'minor',
      gating: false,
      evidence: semanticVerify.error,
      source: 'ace.semantic_verify',
    })
  }

  const invalid = userSimGate?.invalid ?? episode?.invalidUserSim ?? false
  const normalizedFailures = dedupeFailures(failures)
  const messages = parsed.messages.map((message, index) => {
    const rawIndex = message.rawIndex ?? index
    const anchored = normalizedFailures.filter(
      (failure) =>
        (failure.messageId !== undefined && failure.messageId === message.id) ||
        (failure.indexSpace === 'raw' && failure.rawIndex === rawIndex) ||
        (failure.indexSpace === 'chronological' &&
          failure.chronologicalIndex === (message.chronologicalIndex ?? index)),
    )
    if (anchored.length === 0) return message
    return {
      ...message,
      metadata: {
        ...message.metadata,
        aceFailures: anchored.map((failure) => ({
          id: [failure.origin, failure.code, failure.rawIndex ?? rawIndex].join(':'),
          code: failure.code,
          severity: failure.severity,
          origin: failure.origin,
          evidence: failure.evidence,
        })),
      },
    }
  })

  const evaluation: TraceEvaluation = {
    lifecycle: { state: lifecycle, termination, pendingPhase },
    outcome: outcomeOf(lifecycle, invalid, gradePassed),
    checks,
    metrics,
    failures: normalizedFailures,
    flags,
    userSimGate,
    judge,
    semanticVerify,
    worldDiff,
    ledger,
    lineage,
  }

  const sidecarMeta: Partial<TraceMeta> = sourceMeta
  const spec = isRecord(rawEvaluation.spec) ? rawEvaluation.spec : context.batch?.spec
  const sidecarScenarioSnapshot = scenarioGroundTruth(provenance.scenario_snapshot)
  const batchScenarioSnapshot = context.batch?.scenarioSnapshots?.find(
    (candidate) =>
      stringValue(candidate.scenario_id) === scenarioId ||
      stringValue(candidate.scenarioId) === scenarioId,
  )
  const scenarioSnapshot = sidecarScenarioSnapshot ?? scenarioGroundTruth(batchScenarioSnapshot)
  const scenarioSnapshotProvenance = sidecarScenarioSnapshot
    ? 'episode_sidecar'
    : batchScenarioSnapshot
      ? 'batch_manifest'
      : undefined
  const configSnapshot = isRecord(provenance.config_snapshot)
    ? provenance.config_snapshot
    : context.batch?.configSnapshot
  const provenanceWorld = isRecord(provenance.world) ? provenance.world : undefined
  const groundTruth =
    scenarioSnapshot || provenanceWorld
      ? {
          ...(scenarioSnapshot ? { scenario: scenarioSnapshot } : {}),
          ...(provenanceWorld ? { world: provenanceWorld } : {}),
          ...(worldDiff.length > 0 ? { worldDiff } : {}),
        }
      : undefined
  const specPromptDigests = isRecord(spec?.prompt_digests) ? spec.prompt_digests : undefined
  const provenancePromptDigests = isRecord(provenance.prompt_digests)
    ? provenance.prompt_digests
    : undefined
  const promptDigests = specPromptDigests ?? provenancePromptDigests
  const inferredPromptAlias = promptDigests
    ? Object.keys(promptDigests)
        .filter((key) => key !== 'human_tier')
        .sort()[0]
    : undefined
  const promptAlias = stringValue(spec?.prompt) ?? inferredPromptAlias
  const promptDigest = promptAlias ? stringValue(promptDigests?.[promptAlias]) : undefined
  const promoted = {
    prompt: promptAlias,
    prompt_alias: promptAlias,
    prompt_digest: promptDigest,
    transport: stringValue(spec?.transport) ?? stringValue(spec?.agent_transport),
    suite: stringValue(episode?.suite) ?? stringValue(sourceExtra.suite),
    journey_id:
      stringValue(episode?.journey_id) ??
      stringValue(episode?.journeyId) ??
      stringValue(sourceExtra.journey_id) ??
      stringValue(sourceExtra.journeyId),
    journey_step:
      numberValue(episode?.journey_step) ??
      numberValue(episode?.journeyStep) ??
      numberValue(sourceExtra.journey_step) ??
      numberValue(sourceExtra.journeyStep),
    issue:
      stringValue(episode?.issue) ??
      stringValue(episode?.issue_type) ??
      stringValue(sourceExtra.issue) ??
      stringValue(sourceExtra.issue_type),
    language: stringValue(episode?.language) ?? stringValue(sourceExtra.language),
    persona: stringValue(episode?.persona) ?? stringValue(sourceExtra.persona),
    scenario_id: scenarioId,
    environment_seed: environmentSeed,
    pending_phase: pendingPhase,
    pending_tool_name: episode?.toolName,
    message_count: episode?.messageCount,
  }
  const extra: Record<string, unknown> = {
    ...parsed.meta.extra,
    ...sourceExtra,
    ...(spec ? { spec } : {}),
    ...Object.fromEntries(Object.entries(promoted).filter(([, value]) => value !== undefined)),
    ...(episode?.split !== undefined ? { split: episode.split } : {}),
    ...(context.batch?.configDigest ? { config_digest: context.batch.configDigest } : {}),
    ...(stringValue(provenance.config_digest)
      ? { config_digest: stringValue(provenance.config_digest) }
      : {}),
    ...(scheduleDigest ? { schedule_digest: scheduleDigest } : {}),
    ...(stringValue(provenance.run_kind) ? { run_kind: stringValue(provenance.run_kind) } : {}),
    ...(isRecord(provenance.prompt_digests) ? { prompt_digests: provenance.prompt_digests } : {}),
    ...(stringValue(provenance.tool_digest)
      ? { tool_digest: stringValue(provenance.tool_digest) }
      : {}),
    ...(stringValue(provenance.model_digest)
      ? { model_digest: stringValue(provenance.model_digest) }
      : {}),
    ...(isRecord(provenance.models) ? { models: provenance.models } : {}),
    ...(configSnapshot ? { config_snapshot: configSnapshot } : {}),
    ...(scenarioSnapshot ? { scenario_snapshot: scenarioSnapshot } : {}),
    ...(scenarioSnapshotProvenance
      ? { scenario_snapshot_provenance: scenarioSnapshotProvenance }
      : {}),
    ...(isRecord(provenance.checkpoint) ? { checkpoint: provenance.checkpoint } : {}),
    ...(isRecord(provenance.usage) ? { usage: provenance.usage } : {}),
    ...(groundTruth ? { groundTruth } : {}),
  }
  const meta: TraceMeta = {
    ...parsed.meta,
    ...sidecarMeta,
    // Identity fields are derived, never trusted from an enrichment sidecar.
    traceId: parsed.meta.traceId,
    sourceTraceId: parsed.meta.sourceTraceId ?? parsed.meta.traceId,
    instanceId: scenarioId ?? parsed.meta.instanceId,
    status,
    split: normalizeSplit(episode?.split, parsed.meta.split),
    pairKey,
    extra,
  }
  const statsOverrides = {
    ...parsed.statsOverrides,
    ...(isRecord(sidecar.statsOverrides) ? (sidecar.statsOverrides as Partial<TraceStats>) : {}),
  }
  return {
    ...parsed,
    meta,
    messages,
    evaluation,
    ...(Object.keys(statsOverrides).length > 0 ? { statsOverrides } : {}),
  }
}
