import type {
  AceBatchSummary,
  AceBreakdownItem,
  AceDashboardRunScope,
  AceDashboardSummary,
  AceRunKind,
  AceTriageItem,
} from '../../shared/schema/ace'
import type { AceTaskDetail } from '../../shared/schema/aceTasks'
import type { TraceSummary } from '../../shared/schema/types'
import type { TraceStore } from '../store/traceStore'
import { aceTraceDimensions } from './traceDimensions'

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function breakdown(values: Iterable<string>): AceBreakdownItem[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

function extraString(summary: TraceSummary, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(summary.meta.extra?.[key])
    if (value) return value
  }
  return undefined
}

function taskExpectedOutcome(task: AceTaskDetail | undefined): string | undefined {
  if (!task) return undefined
  const outcomes = [
    ...new Set(
      task.variants
        .map((variant) => variant.expectedOutcome)
        .filter((value): value is string => value !== null),
    ),
  ]
  return outcomes.length === 1 ? outcomes[0] : undefined
}

function escalationRequired(
  summary: TraceSummary,
  task: AceTaskDetail | undefined,
): boolean | undefined {
  const explicit = booleanValue(summary.meta.extra?.escalation_required)
  if (explicit !== undefined) return explicit
  const expected = (
    extraString(summary, 'expected_outcome', 'expectedOutcome') ?? taskExpectedOutcome(task)
  )?.toLowerCase()
  return expected ? /escalat|handoff|human/.test(expected) : undefined
}

function escalated(summary: TraceSummary): boolean | undefined {
  const metric = booleanValue(summary.evaluation?.metrics.escalated)
  return metric ?? booleanValue(summary.meta.extra?.escalated)
}

function triageItem(summary: TraceSummary): AceTriageItem | null {
  const evaluation = summary.evaluation
  if (!evaluation) return null
  const important = evaluation.failures.filter((failure) => {
    if (failure.severity !== 'major' && failure.severity !== 'critical') return false
    if (failure.origin === 'judge' || failure.origin === 'semantic') return false
    if (failure.origin !== 'detector') return true
    return evaluation.flags.some(
      (flag) => flag.detector === failure.code && flag.tier === 'hard_fact',
    )
  })
  const disagreement = evaluation.judge?.disagreement === true
  if (important.length === 0 && !disagreement) return null
  return {
    traceUid: summary.meta.traceUid ?? summary.meta.traceId,
    sourceTraceId: summary.meta.sourceTraceId ?? summary.meta.traceId,
    runId: summary.meta.runId ?? 'unknown',
    instanceId: summary.meta.instanceId,
    outcome: evaluation.outcome,
    severity: important.some((failure) => failure.severity === 'critical')
      ? 'critical'
      : important.length > 0
        ? 'major'
        : 'shadow',
    codes: [...new Set(important.map((failure) => failure.code))],
    judgeDisagreement: disagreement,
  }
}

function explicitRunKind(summary: TraceSummary): AceRunKind | undefined {
  if (summary.meta.corpusId === 'production') return 'production'
  const value = summary.meta.extra?.run_kind
  return value === 'scored' || value === 'debug' || value === 'counterfactual' ? value : undefined
}

function runScope(
  runId: string,
  traces: readonly TraceSummary[],
  batch: AceBatchSummary | undefined,
): AceDashboardRunScope {
  const corpusIds = [...new Set(traces.map((trace) => trace.meta.corpusId ?? 'unknown'))].sort()
  const explicitKinds = [...new Set(traces.flatMap((trace) => explicitRunKind(trace) ?? []))]
  const runKind: AceRunKind =
    explicitKinds.length === 1
      ? explicitKinds[0]
      : batch?.runKind && batch.runKind !== 'unknown'
        ? batch.runKind
        : corpusIds.includes('production')
          ? 'production'
          : corpusIds.includes('simulation')
            ? 'scored'
            : 'unknown'
  const outcomes = traces.map((trace) => trace.evaluation?.outcome ?? 'ungraded')
  const pass = outcomes.filter((value) => value === 'pass').length
  const fail = outcomes.filter((value) => value === 'fail').length
  const invalid = outcomes.filter((value) => value === 'invalid').length
  const runtimeError = outcomes.filter((value) => value === 'runtime_error').length
  const ungraded = outcomes.filter((value) => value === 'ungraded').length
  const executed = pass + fail
  const terminalStatuses = new Set(['completed', 'cancelled', 'failed', 'error'])
  const batchEpisodes = batch?.episodes ?? []
  const scheduledEpisodes = batch?.totals.episodes ?? traces.length
  const terminalEpisodes = batch
    ? batchEpisodes.filter((episode) => terminalStatuses.has(episode.status)).length
    : traces.length
  const awaitingTraceIngest =
    batch?.reconciliation?.missingTerminalTraces ??
    batchEpisodes.filter(
      (episode) => terminalStatuses.has(episode.status) && episode.traceUid === undefined,
    ).length
  return {
    runId,
    traces: traces.length,
    corpusIds,
    runKind,
    includedByDefault: runKind === 'scored' || runKind === 'production',
    lifecycle: batch?.lifecycle ?? (corpusIds.includes('production') ? 'completed' : 'unknown'),
    scheduledEpisodes,
    terminalEpisodes,
    inProgressEpisodes: Math.max(0, scheduledEpisodes - terminalEpisodes),
    awaitingTraceIngest,
    pass,
    fail,
    invalid,
    runtimeError,
    ungraded,
    passRateExecuted: executed > 0 ? pass / executed : null,
    costUsd: batch?.totals.costUsd ?? null,
  }
}

/**
 * Builds an ACE-only aggregate. `runIds === undefined` means all ACE runs;
 * passing ids opts into exact (never substring) run matching.
 */
export function buildAceDashboard(
  store: TraceStore,
  runIds?: readonly string[],
  taskDefinitions: readonly AceTaskDetail[] = [],
  batches: readonly AceBatchSummary[] = [],
): AceDashboardSummary {
  // A TraceStore can also contain the viewer's bundled examples or user-added
  // generic corpora.  Those traces may have an evaluation object, but they are
  // not ACE episodes and must never affect ACE denominators or triage queues.
  // A running simulation can temporarily lack its sidecar/evaluation. It is
  // still part of the selected denominator and is honestly reported ungraded.
  const allAceTraces = store
    .list()
    .filter(
      (summary) => summary.meta.corpusId === 'production' || summary.meta.corpusId === 'simulation',
    )
  const tracesByRun = new Map<string, TraceSummary[]>()
  for (const summary of allAceTraces) {
    const runId = summary.meta.runId ?? 'unknown'
    const current = tracesByRun.get(runId)
    if (current) current.push(summary)
    else tracesByRun.set(runId, [summary])
  }
  const batchByRun = new Map(batches.map((batch) => [batch.runId, batch]))
  const availableRunIds = new Set([...tracesByRun.keys(), ...batchByRun.keys()])
  const availableRuns = [...availableRunIds]
    .map((runId) => runScope(runId, tracesByRun.get(runId) ?? [], batchByRun.get(runId)))
    .sort((a, b) => a.runId.localeCompare(b.runId))
  const availableByRun = new Map(availableRuns.map((run) => [run.runId, run]))
  const defaultRunIds = availableRuns.filter((run) => run.includedByDefault).map((run) => run.runId)
  const requestedRunIds = runIds === undefined ? [] : [...new Set(runIds)]
  const requestedSet = new Set(requestedRunIds)
  const selectedRunIds =
    runIds === undefined
      ? defaultRunIds
      : requestedRunIds.filter((runId) => availableByRun.has(runId))
  const selectedSet = new Set(selectedRunIds)
  const traces =
    runIds === undefined
      ? allAceTraces.filter((summary) => selectedSet.has(summary.meta.runId ?? 'unknown'))
      : allAceTraces.filter((summary) => requestedSet.has(summary.meta.runId ?? 'unknown'))
  const outcomes = traces.map((summary) => summary.evaluation?.outcome ?? 'ungraded')
  const pass = outcomes.filter((value) => value === 'pass').length
  const fail = outcomes.filter((value) => value === 'fail').length
  const invalid = outcomes.filter((value) => value === 'invalid').length
  const runtimeError = outcomes.filter((value) => value === 'runtime_error').length
  const ungraded = outcomes.filter((value) => value === 'ungraded').length
  const executed = pass + fail
  const userSimValidEpisodes = pass + fail
  const userSimEpisodeDenominator = userSimValidEpisodes + invalid
  const taskByScenarioId = new Map(taskDefinitions.map((task) => [task.scenarioId, task]))

  const scenarioGroups = new Map<string, TraceSummary[]>()
  for (const summary of traces) {
    if (summary.meta.corpusId !== 'simulation') continue
    const outcome = summary.evaluation?.outcome
    if (outcome !== 'pass' && outcome !== 'fail') continue
    const key = `${summary.meta.runId ?? 'unknown'}\0${summary.meta.instanceId}`
    const group = scenarioGroups.get(key)
    if (group) group.push(summary)
    else scenarioGroups.set(key, [summary])
  }
  const scenarioOutcomes = [...scenarioGroups.values()].map((group) =>
    [...group].sort((a, b) => {
      const aSeed = Number(a.meta.extra?.environment_seed ?? a.meta.extra?.seed ?? 0)
      const bSeed = Number(b.meta.extra?.environment_seed ?? b.meta.extra?.seed ?? 0)
      return aSeed - bSeed
    }),
  )

  const requirements = traces.flatMap((summary) => {
    const required = escalationRequired(summary, taskByScenarioId.get(summary.meta.instanceId))
    const observed = escalated(summary)
    return required === undefined || observed === undefined ? [] : [{ required, observed }]
  })

  const failures = traces.flatMap((summary) => summary.evaluation?.failures ?? [])
  const flags = traces.flatMap((summary) => summary.evaluation?.flags ?? [])
  const triage = traces
    .flatMap((summary) => triageItem(summary) ?? [])
    .sort((a, b) => {
      const severity = { critical: 3, major: 2, shadow: 1 } as const
      return (
        severity[b.severity as keyof typeof severity] -
        severity[a.severity as keyof typeof severity]
      )
    })
  const selectedRuns = availableRuns.filter((run) => selectedSet.has(run.runId))
  const recordedCosts = selectedRuns.flatMap((run) => (run.costUsd === null ? [] : [run.costUsd]))
  const recordedAttemptRuns = selectedRuns.flatMap((run) => {
    const totals = batchByRun.get(run.runId)?.totals
    if (
      totals?.userSimAttempts === null ||
      totals?.userSimAttempts === undefined ||
      totals.invalidUserSimAttempts === null ||
      totals.invalidUserSimAttempts === undefined ||
      totals.userSimAttempts < 0 ||
      totals.invalidUserSimAttempts < 0 ||
      totals.invalidUserSimAttempts > totals.userSimAttempts
    ) {
      return []
    }
    return [
      {
        attempts: totals.userSimAttempts,
        invalidAttempts: totals.invalidUserSimAttempts,
      },
    ]
  })
  const userSimAttempts = recordedAttemptRuns.reduce((sum, run) => sum + run.attempts, 0)
  const userSimInvalidAttempts = recordedAttemptRuns.reduce(
    (sum, run) => sum + run.invalidAttempts,
    0,
  )
  const userSimValidAttempts = userSimAttempts - userSimInvalidAttempts
  const userSimEpisodeValidityRate =
    userSimEpisodeDenominator > 0 ? userSimValidEpisodes / userSimEpisodeDenominator : null
  const userSimAttemptValidityRate =
    userSimAttempts > 0 ? userSimValidAttempts / userSimAttempts : null

  return {
    scope: {
      mode: runIds === undefined ? 'all' : 'selected',
      requestedRunIds,
      selectedRunIds,
      defaultRunIds,
      unmatchedRunIds: requestedRunIds.filter((runId) => !availableByRun.has(runId)),
      availableRuns,
    },
    total: traces.length,
    pass,
    fail,
    invalid,
    runtimeError,
    ungraded,
    scheduledEpisodes: selectedRuns.reduce((sum, run) => sum + run.scheduledEpisodes, 0),
    terminalEpisodes: selectedRuns.reduce((sum, run) => sum + run.terminalEpisodes, 0),
    inProgressEpisodes: selectedRuns.reduce((sum, run) => sum + run.inProgressEpisodes, 0),
    awaitingTraceIngest: selectedRuns.reduce((sum, run) => sum + run.awaitingTraceIngest, 0),
    executed,
    passRateExecuted: executed > 0 ? pass / executed : null,
    // Backward-compatible alias for the original episode-level metric. New UI
    // uses the explicitly named episode/attempt fields below.
    userSimValidityRate: userSimEpisodeValidityRate,
    userSimEpisodeValidityRate,
    userSimValidEpisodes,
    userSimEpisodeDenominator,
    userSimAttemptValidityRate,
    userSimValidAttempts,
    userSimAttempts,
    userSimInvalidAttempts,
    userSimAttemptRunCount: recordedAttemptRuns.length,
    passAt1:
      scenarioOutcomes.length > 0
        ? scenarioOutcomes.filter((group) => group[0]?.evaluation?.outcome === 'pass').length /
          scenarioOutcomes.length
        : null,
    passToK:
      scenarioOutcomes.length > 0
        ? scenarioOutcomes.filter((group) =>
            group.every((summary) => summary.evaluation?.outcome === 'pass'),
          ).length / scenarioOutcomes.length
        : null,
    requiredEscalations:
      requirements.length > 0
        ? requirements.filter((item) => item.required && item.observed).length
        : null,
    unnecessaryEscalations:
      requirements.length > 0
        ? requirements.filter((item) => !item.required && item.observed).length
        : null,
    totalCostUsd:
      recordedCosts.length > 0 ? recordedCosts.reduce((sum, cost) => sum + cost, 0) : null,
    costRunCount: recordedCosts.length,
    failureChecks: breakdown(
      traces.flatMap((summary) =>
        (summary.evaluation?.checks ?? [])
          .filter((check) => check.gating && !check.ok)
          .map((check) => check.name),
      ),
    ),
    failureOrigins: breakdown(failures.map((failure) => failure.origin)),
    failureCodes: breakdown(failures.map((failure) => failure.code)),
    detectorTiers: breakdown(flags.flatMap((flag) => flag.tier ?? [])),
    detectorFamilies: breakdown(flags.flatMap((flag) => flag.family ?? [])),
    toolErrors: breakdown(
      failures.filter((failure) => failure.origin === 'tool').map((failure) => failure.code),
    ),
    terminations: breakdown(
      traces.flatMap((summary) => summary.evaluation?.lifecycle.termination ?? []),
    ),
    issues: breakdown(
      traces.flatMap((summary) => {
        const issue = aceTraceDimensions(summary, taskByScenarioId).issue
        return issue ? [issue] : []
      }),
    ),
    languages: breakdown(
      traces.flatMap((summary) => {
        const language = aceTraceDimensions(summary, taskByScenarioId).language
        return language ? [language] : []
      }),
    ),
    prompts: breakdown(
      traces.flatMap((summary) => extraString(summary, 'prompt', 'prompt_alias') ?? []),
    ),
    transports: breakdown(traces.flatMap((summary) => extraString(summary, 'transport') ?? [])),
    triageTotal: triage.length,
    triageTruncated: triage.length > 250,
    triage: triage.slice(0, 250),
  }
}
