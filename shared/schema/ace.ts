import type { AceRegressionScenarioSnapshot } from './aceRegression'

export type AceRunLifecycle =
  | 'queued'
  | 'running'
  | 'paused'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'unknown'

export type AceEvaluationOutcome = 'pass' | 'fail' | 'invalid' | 'runtime_error' | 'ungraded'

/**
 * Prompt presets the cockpit bridge resolves against configs/prompts. One
 * list for the request validator, the recorded-config extractors, and every
 * preset dropdown — the bridge map is the source of truth. `v4` is the
 * informed-handoff canonical; `optimized` is the live evolving head.
 */
export const ACE_PROMPT_PRESETS = ['baseline', 'improved', 'optimized', 'v3', 'v4'] as const
export type AcePromptPreset = (typeof ACE_PROMPT_PRESETS)[number]

/** Formal score runs are kept separate from exploratory policy changes. */
export type AceRunKind = 'scored' | 'debug' | 'counterfactual' | 'production' | 'unknown'

export interface AceBatchEpisode {
  scenarioId: string
  seed: number
  sourceTraceId: string
  traceUid?: string
  status: string
  phase?: string
  toolName?: string
  messageCount?: number
  updatedAt?: string
  outcome: AceEvaluationOutcome
  termination?: string
  escalated?: boolean
  failedChecks: string[]
  flagsMajor: number
  flagsMinor: number
  invalidUserSim: boolean
  userSimAttempts?: number
  userSimInvalidAttempts?: number
  environmentSeed: number
  /** Present only when schedule digest + explicit environment seed make this unit pairable. */
  pairKey?: string
}

export interface AceBatchTotals {
  episodes: number
  passed: number
  failedGrade: number
  runtimeErrors: number
  invalidUserSim: number
  /** Total user-simulator attempts, including retries. */
  userSimAttempts: number | null
  /** Attempts voided by a hard user-simulator validity rule. */
  invalidUserSimAttempts: number | null
  passRate: number | null
  /** @deprecated Attempt-level alias retained for older clients. */
  userSimValidityRate: number | null
  userSimAttemptValidityRate: number | null
  avgUserTurns: number | null
  avgToolCalls: number | null
  flagsMajor: number
  flagsMinor: number
  costUsd: number | null
}

/** A compact, uncapped projection of every durable trace currently loaded for one run. */
export interface AceRunTraceSummary {
  traceUid: string
  sourceTraceId: string
  scenarioId: string
  status: string
  phase?: string
  outcome: AceEvaluationOutcome
  messageCount: number
  turns: number
  toolUses: number
  toolErrors: number
  failureCount: number
  majorFailureCount: number
  failureCodes: string[]
  failureOrigins: string[]
  judgeDisagreement: boolean
  timestamp: string
}

export interface AceRunReconciliation {
  /** Intended units according to the versioned batch manifest. */
  scheduledEpisodes: number
  /** Units currently represented in episode_states/episodes. */
  manifestEpisodes: number
  /** Every exact-run trace in TraceStore; this list is never client-capped. */
  ingestedTraces: number
  matchedTraces: number
  /** Non-terminal units that have not emitted a durable trace yet (normal while running). */
  pendingTraceFiles: number
  /** Terminal manifest units whose durable trace is not loaded (actionable integrity issue). */
  missingTerminalTraces: number
  /** Durable run traces that are absent from the manifest schedule. */
  orphanTraces: number
}

export interface AceBatchSummary {
  runId: string
  runKind: AceRunKind
  schemaVersion: number
  /** False for a read-only run synthesized from durable TraceStore records. */
  manifestAvailable?: boolean
  /** False when pause/resume/cancel cannot be safely forwarded for this run. */
  controlsAvailable?: boolean
  lifecycle: AceRunLifecycle
  updatedAt: string
  lifecycleError?: string
  /** True when a temporarily unreadable manifest is served from the last-good snapshot. */
  staleManifest?: boolean
  manifestError?: string
  configDigest?: string
  scheduleDigest?: string
  stateScope?: string
  /** Immutable ancestry for checkpoint forks or fresh task reruns. */
  lineage?: AceRunLineage
  spec: Record<string, unknown>
  totals: AceBatchTotals
  failureChecks: Array<{ code: string; count: number }>
  terminations: Array<{ code: string; count: number }>
  episodes?: AceBatchEpisode[]
  traces?: AceRunTraceSummary[]
  reconciliation?: AceRunReconciliation
}

/**
 * Normalized, UI-safe run ancestry. A fresh task rerun regenerates world/model
 * state; a checkpoint fork may restore state exactly up to its boundary.
 */
export interface AceRunLineage {
  relation?: 'fresh_task_rerun' | 'synthetic_regression_rerun' | 'checkpoint_fork' | string
  parentTraceUid?: string
  parentSourceTraceId?: string
  parentRunId?: string
  checkpointId?: number
  forkMessageId?: string
  mode?: 'exact' | 'counterfactual' | string
  fidelity?: string
  stateExact?: boolean
  configExact?: boolean
  llmExact?: boolean
  policyChanged?: boolean
  regressionId?: string
  synthetic?: boolean
  formalMetricsExcluded?: boolean
}

export interface AceCapabilities {
  available: boolean
  projectConfigured: boolean
  pythonAvailable: boolean
  /** Current bridge source file exists in the configured ACE checkout. */
  bridgeSourceAvailable?: boolean
  /** The configured Python successfully imported and executed the fixed capability action. */
  bridgeAvailable: boolean
  runRootAvailable: boolean
  message?: string
}

export interface AceScenarioPack {
  file: string
  count: number
  scenarioIds: string[]
}

export interface AceRunRequest {
  scenarioFile: string
  scenarioIds?: string[]
  filters?: {
    issue?: string
    language?: string
    idKnowledge?: string
    persistence?: string
  }
  limit?: number
  seeds: number[]
  batchId?: string
  runKind: 'scored' | 'debug' | 'counterfactual'
  prompt: AcePromptPreset | string
  /** Inline custom prompt. When present it supersedes `prompt`'s preset. */
  promptText?: string
  transport: 'chat' | 'responses'
  model?: string
  userModel?: string
  temperature?: number
  userTemperature?: number
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  bot?: 'baseline' | 'playbook' | 'workflow'
  botOpens?: boolean
  maxMessages: number
  costCapUsd: number
  concurrency?: number
  stateScope?: 'episode' | 'journey'
  latentRefundBlockRate?: number
  toolFailBeforeRate?: number
  toolResponseLostRate?: number
  judge?: 'off' | 'all' | 'sample'
  judgeSample?: number
  semanticVerify?: 'off' | 'all' | 'sample'
  semanticVerifySample?: number
  checkpoints?: boolean
  /**
   * Optional canonical simulation trace used only as immutable ancestry for a
   * fresh same-task rerun. It never requests checkpoint restoration.
   */
  sourceTraceUid?: string
}

export interface AceReplayRequest {
  sourceTraceUid: string
  checkpointId?: number
  /** Last message included in the selected checkpoint's chronological prefix. */
  forkMessageId?: string
  mode: 'restore' | 'exact' | 'counterfactual' | 'historical_tools'
  childRunId?: string
  childTraceId?: string
  costCapUsd?: number
  nextUserMessage?: string
  prompt?: string
  model?: string
  temperature?: number
}

export interface AceCheckpointSummary {
  id: number
  phase: string
  reason?: string
  message_count?: number
  /** Optional authoritative boundary emitted by newer ACE checkpoint inspectors. */
  fork_message_id?: string
  /** Camel-case compatibility for inspectors which already normalize bridge output. */
  forkMessageId?: string
  branchable?: boolean
  counterfactual_branchable?: boolean
  capability_error?: string | null
}

export interface AceCheckpointResponse {
  traceUid: string
  /** Archive exists and can be restored without executing models/tools. */
  available: boolean
  /** Safe state plus trace-bound scenario/config provenance supports a child fork. */
  forkAvailable: boolean
  historicalReplayAvailable: boolean
  missing: string[]
  checkpoints: AceCheckpointSummary[]
  capabilities?: Record<string, unknown>
  source?: Record<string, unknown>
}

export interface AceRegressionAnchor {
  kind: 'full_trace' | 'message_prefix'
  indexSpace: 'chronological'
  inclusive: true
  messageId: string
  rawIndex: number
  chronologicalIndex: number
}

export interface AceRegressionCapability {
  traceUid: string
  available: boolean
  expectedArtifactKind: 'runnable_scenario_pack' | 'regression_draft'
  scenarioSnapshotAvailable: boolean
  messageCount: number
  missing: string[]
  explanation: string
}

export interface AceSaveRegressionRequest {
  sourceTraceUid: string
  /** Omit to retain the complete transcript. The selected message is inclusive. */
  boundaryMessageId?: string
  /** Optional immutable artifact id; the server never accepts an output path. */
  regressionId?: string
  /**
   * A validated Scenario definition is accepted only for production traces
   * which have no trace-bound scenario snapshot.
   */
  scenarioSnapshot?: AceRegressionScenarioSnapshot
}

export interface AceRegressionResult {
  sourceTraceUid: string
  regressionId: string
  artifactKind: 'runnable_scenario_pack' | 'regression_draft'
  runnable: boolean
  deduplicated: boolean
  artifact: string
  scenarioPack: string | null
  draft: string | null
  scenarioId: string | null
  missingRequiredFields: string[]
  fidelity: Record<string, unknown>
  anchor: AceRegressionAnchor
}

export interface AceBreakdownItem {
  code: string
  count: number
}

export interface AceTriageItem {
  traceUid: string
  sourceTraceId: string
  runId: string
  instanceId: string
  outcome: string
  severity: string
  codes: string[]
  judgeDisagreement: boolean
}

export interface AceDashboardRunScope {
  runId: string
  traces: number
  corpusIds: string[]
  runKind: AceRunKind
  includedByDefault: boolean
  lifecycle: AceRunLifecycle
  scheduledEpisodes: number
  terminalEpisodes: number
  inProgressEpisodes: number
  awaitingTraceIngest: number
  pass: number
  fail: number
  invalid: number
  runtimeError: number
  ungraded: number
  passRateExecuted: number | null
  costUsd: number | null
}

export interface AceDashboardScope {
  /** No runId query means all ACE runs; selected means exact run-id matching. */
  mode: 'all' | 'selected'
  /** Deduplicated runId values supplied by the caller, in caller order. */
  requestedRunIds: string[]
  /** Exact requested matches, or every available run when mode is all. */
  selectedRunIds: string[]
  /** Runs used when no explicit runId query is present (formal + production only). */
  defaultRunIds: string[]
  /** Requested ids that currently have no trace in the store. */
  unmatchedRunIds: string[]
  /**
   * Selected runs outside the default formal scope (debug / counterfactual /
   * unknown). When non-empty, headline outcome fields (pass, fail,
   * passRateExecuted, escalation) include informal episodes.
   */
  informalSelectedRunIds: string[]
  /** Complete ACE scope, used by the UI's shareable run selector. */
  availableRuns: AceDashboardRunScope[]
}

export interface AceReliabilityAuthority {
  metric: 'pass^k'
  /** Macro-average of each scenario's without-replacement all-success probability. */
  method: 'mean_per_scenario_combination_probability'
  formula: 'mean_s(C(successes_s,k)/C(trials_s,k))'
  source: 'ac_express/scripts/run_factorial.py::_task_pass_k'
  /** Only programmatically graded pass/fail trials enter the reliability curve. */
  trialPolicy: 'pass_fail_only'
}

export interface AceReliabilityExclusions {
  invalid: number
  runtimeError: number
  ungraded: number
  /** Graded traces that could not be assigned a stable schedule/scenario/seed pair key. */
  missingPairKey: number
  /** Graded rows excluded because their pair key was non-unique within the run/config cell. */
  duplicatePair: number
}

export interface AceReliabilityCoverage {
  /** All formal simulation traces assigned to this run/config cell. */
  inputTraceCount: number
  /** Pass/fail traces before pair-key validation and deduplication. */
  gradedTraceCount: number
  /** Unique, non-conflicting graded pair keys used as trials in the curve. */
  validTrialCount: number
  /** Scenario macro-average denominator used by every point in this cell's curve. */
  scenarioDenominator: number
  minTrialsPerScenario: number
  maxTrialsPerScenario: number
}

export interface AceReliabilityCurvePoint {
  k: number
  value: number
  /** Number of scenario probabilities included in the macro-average. */
  scenarioDenominator: number
}

export interface AceReliabilityCell {
  runId: string
  /** Null means the source and batch manifest did not record a config digest. */
  configDigest: string | null
  coverage: AceReliabilityCoverage
  exclusions: AceReliabilityExclusions
  /** Largest k supported by every scenario in this cell. Zero means no valid trials. */
  commonMaxK: number
  curve: AceReliabilityCurvePoint[]
}

export interface AceReliabilitySummary {
  authority: AceReliabilityAuthority
  /** Production and exploratory traces do not enter formal reliability cells. */
  excludedNonFormalTraceCount: number
  cells: AceReliabilityCell[]
}

export interface AceEscalationConfusionMatrix {
  traceCount: number
  /** Traces for which both required and observed escalation are known. */
  knownPairDenominator: number
  unknownRequirement: number
  unknownObservation: number
  requiredObserved: number
  requiredNotObserved: number
  notRequiredObserved: number
  notRequiredNotObserved: number
  requiredDenominator: number
  notRequiredDenominator: number
  observedDenominator: number
  notObservedDenominator: number
  requiredHitRate: number | null
  unnecessaryEscalationRate: number | null
  observedPrecision: number | null
}

export interface AceDashboardSummary {
  scope: AceDashboardScope
  /**
   * False when the detector analysis bridge failed or hit its stabilization
   * cap — zero detector findings then means "no data", not "no failures".
   */
  detectorAnalysisAvailable?: boolean
  total: number
  pass: number
  fail: number
  invalid: number
  runtimeError: number
  ungraded: number
  /** Every scheduled episode in the selected scope, including production/exploratory runs. */
  scheduledEpisodes: number
  /** Scheduled episodes from uncontaminated scored simulation runs only. */
  formalScheduledEpisodes: number
  terminalEpisodes: number
  inProgressEpisodes: number
  awaitingTraceIngest: number
  executed: number
  passRateExecuted: number | null
  /** @deprecated Episode-level alias retained for older clients. */
  userSimValidityRate: number | null
  /** Loaded episode traces that ultimately produced a valid grade (pass or fail). */
  userSimValidEpisodes: number
  /** Loaded valid graded traces plus traces voided by the user-sim gate. */
  userSimEpisodeDenominator: number
  userSimEpisodeValidityRate: number | null
  /** Attempts reported by selected batch manifests; absent manifests are not inferred. */
  userSimAttempts: number
  userSimInvalidAttempts: number
  userSimValidAttempts: number
  userSimAttemptValidityRate: number | null
  /** Number of selected runs contributing complete attempt counters. */
  userSimAttemptRunCount: number
  reliability: AceReliabilitySummary
  /** @deprecated Use reliability.cells[].curve and its explicit k/coverage fields. */
  passAt1: number | null
  /**
   * @deprecated Last curve point only when exactly one reliability cell exists. Its k is not
   * encoded here; new clients must use reliability.cells[].curve.
   */
  passToK: number | null
  escalation: AceEscalationConfusionMatrix
  /** @deprecated Use escalation.requiredObserved and requiredDenominator. */
  requiredEscalations: number | null
  /** @deprecated Use escalation.notRequiredObserved and notRequiredDenominator. */
  unnecessaryEscalations: number | null
  totalCostUsd: number | null
  costRunCount: number
  failureChecks: AceBreakdownItem[]
  failureOrigins: AceBreakdownItem[]
  failureCodes: AceBreakdownItem[]
  detectorTiers: AceBreakdownItem[]
  detectorFamilies: AceBreakdownItem[]
  toolErrors: AceBreakdownItem[]
  terminations: AceBreakdownItem[]
  issues: AceBreakdownItem[]
  languages: AceBreakdownItem[]
  prompts: AceBreakdownItem[]
  transports: AceBreakdownItem[]
  /** Total matching traces before the bounded response preview is applied. */
  triageTotal: number
  /** Zero-based start of this triage page after deterministic severity/id sorting. */
  triageOffset: number
  /** Requested server-side page size (capped by the API). */
  triageLimit: number
  triageHasPrevious: boolean
  triageHasNext: boolean
  triageTruncated: boolean
  triage: AceTriageItem[]
}

export interface AceAnalysisSummary {
  schemaVersion: number
  source: Record<string, unknown>
  aggregates: Record<string, unknown>
  appliedTraces: number
  unmatchedTraces: number
}
