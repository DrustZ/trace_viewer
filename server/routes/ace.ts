import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import type {
  AceBatchEpisode,
  AceBatchSummary,
  AceEvaluationOutcome,
  AceRunKind,
  AceRunLineage,
  AceRunTraceSummary,
} from '../../shared/schema/ace'
import { parseAceRegressionScenarioSnapshot } from '../../shared/schema/aceRegression'
import { ACE_RUN_CONTROL_ACTIONS, aceRunControlDecision } from '../../shared/schema/aceRunControl'
import type { Trace } from '../../shared/schema/types'
import { AceAnalysisCoordinator, type AceAnalysisLoader } from '../ace/analysisCoordinator'
import { AceBridgeClient, type AceBridgeCommand, aceBridgeSourcePath } from '../ace/bridge'
import { buildAceDashboard } from '../ace/dashboard'
import { AceLaunchLineageStore } from '../ace/launchLineageStore'
import {
  AceRequestError,
  aceMaxRunCostUsd,
  parseAceRunRequest,
  parseControlRequest,
} from '../ace/requests'
import { AceRunCatalog } from '../ace/runCatalog'
import { compareAceRunConfig } from '../ace/runConfigFidelity'
import { loadAceTaskCatalog } from '../ace/taskCatalog'
import { PROJECT_ROOT } from '../config/dataRoots'
import { asyncHandler, type RouteCtx } from './context'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const MAX_INLINE_TEXT = 1_000_000
const MAX_DASHBOARD_RUNS = 64
const MAX_TRIAGE_OFFSET = 1_000_000
const MAX_TRIAGE_LIMIT = 250
const PROMPT_PRESET_FILES: Record<string, string> = {
  baseline: 'baseline_beta.md',
  improved: 'improved_beta.md',
  optimized: 'optimized_beta.md',
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  const candidate = record(value)
  return Object.keys(candidate).length > 0 ? candidate : undefined
}

function publicBridgeResult(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((entry) => publicBridgeResult(entry))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, entry]) => [
        childKey,
        publicBridgeResult(entry, childKey),
      ]),
    )
  }
  // Python uses both snake_case and camelCase keys. Never serialize an ACE-owned
  // absolute path merely because the bridge happened to change its casing.
  if (typeof value === 'string' && /(?:path|parent_checkpoint)$/i.test(key)) {
    return path.basename(value)
  }
  return value
}

function safeId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new AceRequestError(`${name} is not a safe identifier`)
  }
  return value
}

function optionalSafeId(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : safeId(value, name)
}

function optionalOpaqueId(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new AceRequestError(`${name} must be a non-empty opaque identifier`)
  }
  return value
}

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_INLINE_TEXT) {
    throw new AceRequestError(
      `${name} must be a non-empty string of at most ${MAX_INLINE_TEXT} characters`,
    )
  }
  return value
}

function optionalModel(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !SAFE_MODEL.test(value)) {
    throw new AceRequestError('model is not a safe model identifier')
  }
  return value
}

function optionalTemperature(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
    throw new AceRequestError('temperature must be between 0 and 2')
  }
  return value
}

/** Parses Express' repeated `?runId=a&runId=b` shape without accepting objects. */
export function parseDashboardRunIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  const values = Array.isArray(value) ? value : [value]
  if (values.length === 0 || values.length > MAX_DASHBOARD_RUNS) {
    throw new AceRequestError(`runId must contain 1-${MAX_DASHBOARD_RUNS} values`)
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const candidate of values) {
    if (typeof candidate !== 'string' || !SAFE_ID.test(candidate)) {
      throw new AceRequestError('runId must be a safe exact run identifier')
    }
    if (seen.has(candidate)) continue
    seen.add(candidate)
    result.push(candidate)
  }
  return result
}

function dashboardPageInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback
  if (
    typeof value !== 'string' ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    throw new AceRequestError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

export function parseDashboardTriagePage(
  offsetValue: unknown,
  limitValue: unknown,
): { offset: number; limit: number } {
  return {
    offset: dashboardPageInteger(offsetValue, 'triageOffset', 0, MAX_TRIAGE_OFFSET, 0),
    limit: dashboardPageInteger(limitValue, 'triageLimit', 1, MAX_TRIAGE_LIMIT, 250),
  }
}

function forkCostCap(value: unknown): number {
  const maximum = aceMaxRunCostUsd()
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.01 || value > maximum) {
    throw new AceRequestError(`costCapUsd must be between 0.01 and ${maximum} for checkpoint forks`)
  }
  return value
}

function checkpointPathFor(sourcePath: string): string | null {
  return sourcePath.toLowerCase().endsWith('.json')
    ? `${sourcePath.slice(0, -'.json'.length)}.checkpoints.json`
    : null
}

function childRunId(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
  return `fork-${stamp}-${randomBytes(3).toString('hex')}`
}

function bridgeFreshRunLineage(lineage: AceRunLineage): Record<string, unknown> {
  return {
    relation: 'fresh_task_rerun',
    parent_trace_uid: lineage.parentTraceUid,
    parent_source_trace_id: lineage.parentSourceTraceId,
    parent_run_id: lineage.parentRunId,
    fidelity: lineage.fidelity,
    state_exact: lineage.stateExact,
    config_exact: lineage.configExact,
    llm_exact: lineage.llmExact,
    ...(lineage.policyChanged !== undefined ? { policy_changed: lineage.policyChanged } : {}),
  }
}

async function effectiveChildPromptText(
  bridgeParams: Record<string, unknown>,
  projectRoot: string,
): Promise<string | undefined> {
  if (typeof bridgeParams.promptText === 'string') return bridgeParams.promptText
  if (typeof bridgeParams.promptPreset !== 'string') return undefined
  const file = PROMPT_PRESET_FILES[bridgeParams.promptPreset]
  if (!file) return undefined
  try {
    return await fs.readFile(path.join(projectRoot, 'configs', 'prompts', file), 'utf8')
  } catch {
    // The bridge remains the authority for missing preset files. Fidelity falls back
    // conservatively to the recorded preset identity in lightweight/test worktrees.
    return undefined
  }
}

function regressionScenarioSnapshot(trace: Trace): Record<string, unknown> | undefined {
  const extra = record(trace.meta.extra)
  const groundTruth = record(extra.groundTruth)
  return optionalRecord(extra.scenario_snapshot) ?? optionalRecord(groundTruth.scenario)
}

function isAceOwnedSource(sourcePath: string, projectRoot: string): boolean {
  if (!path.isAbsolute(sourcePath)) return false
  const candidate = path.resolve(sourcePath)
  return [path.join(projectRoot, 'data'), path.join(projectRoot, 'runs')].some((root) => {
    const relative = path.relative(path.resolve(root), candidate)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  })
}

function regressionCapability(trace: Trace, sourcePath: string | undefined, projectRoot: string) {
  const snapshot = regressionScenarioSnapshot(trace)
  const missing: string[] = []
  if (!sourcePath) missing.push('durable source trace')
  else if (!sourcePath.toLowerCase().endsWith('.json')) missing.push('JSON conversation source')
  else if (!isAceOwnedSource(sourcePath, projectRoot)) missing.push('ACE-owned data/runs source')
  if (trace.messages.length === 0) missing.push('transcript messages')
  const runnable = snapshot !== undefined
  return {
    traceUid: trace.meta.traceUid ?? trace.meta.traceId,
    available: missing.length === 0,
    expectedArtifactKind: runnable ? 'runnable_scenario_pack' : 'regression_draft',
    scenarioSnapshotAvailable: runnable,
    messageCount: trace.messages.length,
    missing,
    explanation: runnable
      ? 'A trace-bound Scenario snapshot is available. Saving creates an immutable single-item scenario pack using observed user turns; it is a fresh rerun, not checkpoint- or LLM-exact replay.'
      : 'No trace-bound Scenario snapshot is available. Complete a validated Scenario definition to create a runnable synthetic rerun, or save a clearly marked non-runnable draft.',
  } as const
}

function regressionPrefix(trace: Trace, boundaryMessageId: string | undefined) {
  const ordered = trace.messages
    .map((message, position) => ({
      message,
      position,
      chronologicalIndex: message.chronologicalIndex ?? position,
      rawIndex: message.rawIndex ?? position,
    }))
    .sort(
      (left, right) =>
        left.chronologicalIndex - right.chronologicalIndex || left.position - right.position,
    )
  if (ordered.length === 0) throw new AceRequestError('trace has no messages to save')
  let boundaryPosition = ordered.length - 1
  if (boundaryMessageId !== undefined) {
    const matches = ordered.flatMap((entry, position) =>
      entry.message.id === boundaryMessageId ? [position] : [],
    )
    if (matches.length !== 1) {
      throw new AceRequestError(
        matches.length === 0
          ? 'boundaryMessageId is not in this trace'
          : 'boundaryMessageId is ambiguous in this trace',
      )
    }
    boundaryPosition = matches[0]
  }
  const prefix = ordered.slice(0, boundaryPosition + 1)
  const boundary = prefix[prefix.length - 1]
  return {
    anchor: {
      kind: boundaryMessageId === undefined ? 'full_trace' : 'message_prefix',
      index_space: 'chronological',
      inclusive: true,
      message_id: boundary.message.id,
      raw_index: boundary.rawIndex,
      chronological_index: boundary.chronologicalIndex,
    },
    transcriptPrefix: prefix.map(({ message, rawIndex, chronologicalIndex }) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      raw_index: rawIndex,
      chronological_index: chronologicalIndex,
      ...(message.channel ? { channel: message.channel } : {}),
      ...(message.timestamp ? { timestamp: message.timestamp } : {}),
      ...(message.toolCalls && message.toolCalls.length > 0
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              name: call.name,
              arguments: call.arguments,
            })),
          }
        : {}),
      ...(message.toolResult
        ? {
            tool_result: {
              tool_call_id: message.toolResult.toolCallId,
              is_error: message.toolResult.isError,
              ...(message.toolResult.durationMs !== undefined
                ? { duration_ms: message.toolResult.durationMs }
                : {}),
            },
          }
        : {}),
    })),
  }
}

export interface AceRouteConfig {
  projectRoot: string
  runRoot: string
  python?: string
}

/** Narrow bridge surface so route tests can prove translation without launching Python. */
export interface AceRouteBridge {
  call<T>(
    command: Exclude<AceBridgeCommand, 'start'>,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T>
  start(
    runId: string,
    params: Record<string, unknown>,
  ): Promise<{ runId: string; startedAt: string }>
  active(runId: string): { pid: number | undefined; startedAt: string } | null
  activeRunIds(): string[]
}

export function resolveAceConfig(): AceRouteConfig {
  const projectRoot = path.resolve(
    process.env.ACE_PROJECT_ROOT ?? path.join(PROJECT_ROOT, '..', 'ac_express'),
  )
  return {
    projectRoot,
    runRoot: path.resolve(process.env.ACE_RUN_ROOT ?? path.join(projectRoot, 'runs', 'episodes')),
  }
}

export function aceRoutes(
  ctx: RouteCtx,
  config: AceRouteConfig = resolveAceConfig(),
  bridge: AceRouteBridge = new AceBridgeClient({
    projectRoot: config.projectRoot,
    python: config.python,
  }),
  launchLineage: AceLaunchLineageStore = new AceLaunchLineageStore(
    path.join(PROJECT_ROOT, '.trace-viewer', 'ace-run-lineage.jsonl'),
  ),
  analysisCoordinator: AceAnalysisLoader = new AceAnalysisCoordinator(ctx.store, bridge),
): Router {
  const router = Router()
  const runCatalog = new AceRunCatalog()

  // Task configs are intentionally read on every consuming request. The
  // sibling ACE worktree is live during local evaluation; pinning one Promise
  // here made Dashboard disagree with Task Explorer until a server restart.
  const loadTaskDefinitions = () => loadAceTaskCatalog(config.projectRoot)

  const batchesWithTraceUids = async () => {
    const recordedLineage = await launchLineage.all()
    const aceTraces = ctx.store
      .list()
      .filter(
        (summary) =>
          summary.meta.corpusId === 'simulation' || summary.meta.corpusId === 'production',
      )
    const byRun = new Map<string, typeof aceTraces>()
    const byRunAndSource = new Map<string, typeof aceTraces>()
    for (const summary of aceTraces) {
      const runId = summary.meta.runId ?? 'unknown'
      const sourceTraceId = summary.meta.sourceTraceId ?? summary.meta.traceId
      const runRows = byRun.get(runId)
      if (runRows) runRows.push(summary)
      else byRun.set(runId, [summary])
      const sourceKey = `${runId}\0${sourceTraceId}`
      const sourceRows = byRunAndSource.get(sourceKey)
      if (sourceRows) sourceRows.push(summary)
      else byRunAndSource.set(sourceKey, [summary])
    }

    const traceProjection = (summary: (typeof aceTraces)[number]): AceRunTraceSummary => {
      const traceUid = summary.meta.traceUid ?? summary.meta.traceId
      const evaluation = summary.evaluation
      const full = ctx.store.getFull(traceUid)
      const failures = evaluation?.failures ?? []
      const metricToolErrors = evaluation?.metrics.tool_errors
      return {
        traceUid,
        sourceTraceId: summary.meta.sourceTraceId ?? summary.meta.traceId,
        scenarioId: summary.meta.instanceId,
        status: evaluation?.lifecycle.state ?? summary.meta.status,
        ...(evaluation?.lifecycle.pendingPhase ? { phase: evaluation.lifecycle.pendingPhase } : {}),
        outcome: (evaluation?.outcome ?? 'ungraded') as AceEvaluationOutcome,
        messageCount: full?.messages.length ?? 0,
        turns: summary.stats.turns,
        toolUses: summary.stats.toolUses,
        toolErrors:
          typeof metricToolErrors === 'number' && Number.isFinite(metricToolErrors)
            ? metricToolErrors
            : failures.filter((failure) => failure.origin === 'tool').length,
        failureCount: failures.length,
        majorFailureCount: failures.filter(
          (failure) => failure.severity === 'major' || failure.severity === 'critical',
        ).length,
        failureCodes: [...new Set(failures.map((failure) => failure.code))],
        failureOrigins: [...new Set(failures.map((failure) => failure.origin))],
        judgeDisagreement: evaluation?.judge?.disagreement === true,
        timestamp: summary.meta.timestamp,
      }
    }

    const sortedTraceProjections = (summaries: typeof aceTraces) =>
      summaries
        .map(traceProjection)
        .sort(
          (left, right) =>
            right.timestamp.localeCompare(left.timestamp) ||
            left.sourceTraceId.localeCompare(right.sourceTraceId),
        )

    const counted = (values: readonly string[]) => {
      const counts = new Map<string, number>()
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
      return [...counts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
    }

    const episodeWithoutPairKey = (episode: AceBatchEpisode): AceBatchEpisode => {
      const { pairKey: _pairKey, ...unpaired } = episode
      return unpaired
    }

    const reconcileEpisode = (
      episode: AceBatchEpisode,
      candidates: typeof aceTraces,
    ): AceBatchEpisode => {
      if (candidates.length === 0) return episode
      if (candidates.length > 1) {
        return {
          ...episodeWithoutPairKey(episode),
          outcome: episode.outcome === 'runtime_error' ? 'runtime_error' : 'ungraded',
        }
      }
      const summary = candidates[0]
      if (!summary) return episode
      const traceUid = summary.meta.traceUid ?? summary.meta.traceId
      const traceOutcome = (summary.evaluation?.outcome ?? 'ungraded') as AceEvaluationOutcome
      const artifactConflict = (summary.evaluation?.failures ?? []).some((failure) =>
        /^ace_.*_conflict$/.test(failure.code),
      )
      const pairMismatch = episode.pairKey !== undefined && summary.meta.pairKey !== episode.pairKey
      const outcomeMismatch = episode.outcome !== traceOutcome
      const quarantined = artifactConflict || pairMismatch || outcomeMismatch
      const outcome =
        episode.outcome === 'runtime_error' || traceOutcome === 'runtime_error'
          ? 'runtime_error'
          : quarantined
            ? 'ungraded'
            : traceOutcome
      const unpaired = episodeWithoutPairKey(episode)
      return {
        ...unpaired,
        traceUid,
        outcome,
        ...(episode.pairKey && !quarantined && summary.meta.pairKey === episode.pairKey
          ? { pairKey: episode.pairKey }
          : {}),
      }
    }

    const totalsForEpisodes = (
      batch: AceBatchSummary,
      episodes: readonly AceBatchEpisode[],
    ): AceBatchSummary['totals'] => {
      const passed = episodes.filter((episode) => episode.outcome === 'pass').length
      const failedGrade = episodes.filter((episode) => episode.outcome === 'fail').length
      const runtimeErrors = episodes.filter((episode) => episode.outcome === 'runtime_error').length
      const invalidUserSim = episodes.filter((episode) => episode.outcome === 'invalid').length
      const executed = passed + failedGrade
      return {
        ...batch.totals,
        passed,
        failedGrade,
        runtimeErrors,
        invalidUserSim,
        passRate: executed > 0 ? passed / executed : null,
      }
    }

    const synthesizedRun = (
      runId: string,
      summaries: typeof aceTraces,
      options: {
        controlsAvailable: boolean
        lifecycle?: AceBatchSummary['lifecycle']
        updatedAt?: string
      },
    ): AceBatchSummary => {
      const traces = sortedTraceProjections(summaries)
      const outcomes = summaries.map((summary) => summary.evaluation?.outcome ?? 'ungraded')
      const passed = outcomes.filter((value) => value === 'pass').length
      const failedGrade = outcomes.filter((value) => value === 'fail').length
      const runtimeErrors = outcomes.filter((value) => value === 'runtime_error').length
      const invalidUserSim = outcomes.filter((value) => value === 'invalid').length
      const executed = passed + failedGrade
      const corpusIds = new Set(summaries.map((summary) => summary.meta.corpusId))
      const explicitKinds = new Set<AceRunKind>(
        summaries.flatMap((summary) => {
          const value = summary.meta.extra?.run_kind
          return value === 'scored' || value === 'debug' || value === 'counterfactual'
            ? [value]
            : []
        }),
      )
      const runKind: AceRunKind =
        corpusIds.size === 1 && corpusIds.has('production')
          ? 'production'
          : explicitKinds.size === 1
            ? ([...explicitKinds][0] ?? 'unknown')
            : 'unknown'
      const lifecycleStates = summaries.map(
        (summary) => summary.evaluation?.lifecycle.state ?? summary.meta.status,
      )
      const lifecycle =
        options.lifecycle ??
        (lifecycleStates.some((state) => state === 'executing') ? 'running' : 'completed')
      const updatedAt =
        options.updatedAt ??
        summaries
          .map((summary) => summary.meta.timestamp)
          .sort()
          .at(-1) ??
        new Date(0).toISOString()
      const failedChecks = summaries.flatMap((summary) =>
        (summary.evaluation?.checks ?? [])
          .filter((check) => check.gating && !check.ok)
          .map((check) => check.name),
      )
      const terminations = summaries.flatMap((summary) =>
        summary.evaluation?.lifecycle.termination ? [summary.evaluation.lifecycle.termination] : [],
      )
      const flags = summaries.flatMap((summary) => summary.evaluation?.flags ?? [])
      return {
        runId,
        runKind,
        schemaVersion: 0,
        manifestAvailable: false,
        controlsAvailable: options.controlsAvailable,
        lifecycle,
        updatedAt,
        ...(recordedLineage.get(runId) ? { lineage: recordedLineage.get(runId) } : {}),
        spec: {},
        totals: {
          episodes: traces.length,
          passed,
          failedGrade,
          runtimeErrors,
          invalidUserSim,
          userSimAttempts: null,
          invalidUserSimAttempts: null,
          passRate: executed > 0 ? passed / executed : null,
          userSimValidityRate: null,
          userSimAttemptValidityRate: null,
          avgUserTurns:
            summaries.length > 0
              ? summaries.reduce((sum, summary) => sum + summary.stats.turns, 0) / summaries.length
              : null,
          avgToolCalls:
            summaries.length > 0
              ? summaries.reduce((sum, summary) => sum + summary.stats.toolUses, 0) /
                summaries.length
              : null,
          flagsMajor: flags.filter(
            (flag) => flag.severity === 'major' || flag.severity === 'critical',
          ).length,
          flagsMinor: flags.filter((flag) => flag.severity === 'minor').length,
          costUsd: null,
        },
        failureChecks: counted(failedChecks),
        terminations: counted(terminations),
        episodes: [],
        traces,
        reconciliation: {
          scheduledEpisodes: traces.length,
          manifestEpisodes: 0,
          ingestedTraces: traces.length,
          matchedTraces: 0,
          pendingTraceFiles: 0,
          missingTerminalTraces: 0,
          orphanTraces: traces.length,
        },
      }
    }

    const batches: AceBatchSummary[] = (await runCatalog.list(config.runRoot)).map((batch) => {
      const traces = sortedTraceProjections(byRun.get(batch.runId) ?? [])
      const episodes = (batch.episodes ?? []).map((episode) => {
        const candidates = byRunAndSource.get(`${batch.runId}\0${episode.sourceTraceId}`) ?? []
        // A duplicate producer id or a trace-side artifact disagreement is an
        // integrity problem. Keep runtime failures visible, but never let an
        // ambiguous unit enter formal pass/fail or paired statistics.
        return reconcileEpisode(episode, candidates)
      })
      const scheduledSources = new Set(episodes.map((episode) => episode.sourceTraceId))
      const terminal = new Set(['completed', 'cancelled', 'failed', 'error'])
      const matchedTraceUids = new Set(
        episodes.flatMap((episode) => (episode.traceUid ? [episode.traceUid] : [])),
      )
      return {
        ...batch,
        ...(batch.lineage
          ? {}
          : recordedLineage.get(batch.runId)
            ? { lineage: recordedLineage.get(batch.runId) }
            : {}),
        episodes,
        totals: totalsForEpisodes(batch, episodes),
        failureChecks: counted(
          episodes
            .filter((episode) => episode.outcome === 'fail')
            .flatMap((episode) => episode.failedChecks),
        ),
        traces,
        reconciliation: {
          scheduledEpisodes: batch.totals.episodes,
          manifestEpisodes: episodes.length,
          ingestedTraces: traces.length,
          matchedTraces: matchedTraceUids.size,
          pendingTraceFiles: episodes.filter(
            (episode) => !terminal.has(episode.status) && !episode.traceUid,
          ).length,
          missingTerminalTraces: episodes.filter(
            (episode) => terminal.has(episode.status) && !episode.traceUid,
          ).length,
          orphanTraces: traces.filter((trace) => !scheduledSources.has(trace.sourceTraceId)).length,
        },
      }
    })
    const existing = new Set(batches.map((batch) => batch.runId))
    for (const runId of bridge.activeRunIds()) {
      if (existing.has(runId)) continue
      const active = bridge.active(runId)
      const summaries = byRun.get(runId) ?? []
      batches.push(
        synthesizedRun(runId, summaries, {
          // Before READY there is no durable manifest/authoritative control
          // target. Expose progress, but fail closed instead of writing a
          // queued cancel that the runner could later overwrite.
          controlsAvailable: false,
          lifecycle: summaries.length === 0 ? 'queued' : 'running',
          updatedAt: active?.startedAt ?? new Date().toISOString(),
        }),
      )
      existing.add(runId)
    }
    for (const [runId, summaries] of byRun) {
      if (existing.has(runId)) continue
      batches.push(synthesizedRun(runId, summaries, { controlsAvailable: false }))
      existing.add(runId)
    }
    return batches.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.runId.localeCompare(right.runId),
    )
  }

  router.get(
    '/api/ace/dashboard',
    asyncHandler(async (req, res) => {
      const runIds = parseDashboardRunIds(req.query.runId)
      const triagePage = parseDashboardTriagePage(req.query.triageOffset, req.query.triageLimit)
      // Detector output is an overlay on production traces. Await the shared,
      // cached load before taking the snapshot so a first-page request cannot
      // race and return a permanently detector-free aggregate. Simulation-only
      // dashboards still work if the optional Python analysis bridge is down.
      let detectorAnalysisAvailable = false
      try {
        await analysisCoordinator.load()
        detectorAnalysisAvailable = true
      } catch {
        // `/api/ace/analysis` exposes the bridge error; core grade/runtime
        // aggregates remain useful and must not become unavailable with it.
      }
      const tasks = await loadTaskDefinitions()
        .then((catalog) => catalog.tasks)
        .catch(() => [])
      const batches = await batchesWithTraceUids()
      if (detectorAnalysisAvailable) {
        // Task/manifest reads above are asynchronous. Revalidate once at the
        // projection boundary so a source change during those reads cannot
        // produce a detector-free dashboard snapshot.
        try {
          await analysisCoordinator.load()
        } catch {
          // Keep the same core-browsing degradation contract as the first load.
        }
      }
      // Without this flag a consumer cannot distinguish "zero detector
      // findings" from "analysis bridge down / stabilization cap hit".
      res.json({
        ...buildAceDashboard(ctx.store, runIds, tasks, batches, triagePage),
        detectorAnalysisAvailable,
      })
    }),
  )

  router.get(
    '/api/ace/analysis',
    asyncHandler(async (_req, res) => {
      res.json(await analysisCoordinator.load())
    }),
  )

  router.post(
    '/api/ace/analysis/refresh',
    asyncHandler(async (_req, res) => {
      res.json(await analysisCoordinator.load(true))
    }),
  )

  router.get(
    '/api/ace/capabilities',
    asyncHandler(async (_req, res) => {
      const python =
        config.python ??
        process.env.ACE_PYTHON ??
        path.join(config.projectRoot, '.venv', 'bin', 'python')
      const bridgeModule = aceBridgeSourcePath(config.projectRoot)
      const readable = async (candidate: string) => {
        try {
          await fs.access(candidate)
          return true
        } catch {
          return false
        }
      }
      const [projectConfigured, pythonAvailable, bridgeSourceAvailable, runRootAvailable] =
        await Promise.all([
          readable(config.projectRoot),
          readable(python),
          readable(bridgeModule),
          readable(config.runRoot),
        ])
      let bridgeAvailable = false
      if (projectConfigured && pythonAvailable && bridgeSourceAvailable) {
        try {
          await bridge.call('capabilities', {}, 10_000)
          bridgeAvailable = true
        } catch {
          // File presence cannot prove that the active venv can import the current worktree.
          // The launcher must fail closed before it offers any provider-backed action.
        }
      }
      res.json({
        available: projectConfigured && pythonAvailable && bridgeAvailable,
        projectConfigured,
        pythonAvailable,
        bridgeSourceAvailable,
        bridgeAvailable,
        runRootAvailable,
        ...(!bridgeSourceAvailable
          ? { message: 'ACE cockpit bridge is not installed' }
          : !bridgeAvailable
            ? { message: 'ACE cockpit bridge failed its runtime capability probe' }
            : {}),
      })
    }),
  )

  router.get(
    '/api/ace/scenarios',
    asyncHandler(async (_req, res) => {
      const root = path.join(config.projectRoot, 'configs', 'scenarios')
      const entries = await fs.readdir(root, { withFileTypes: true })
      const items = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(async (entry) => {
            const value: unknown = JSON.parse(
              await fs.readFile(path.join(root, entry.name), 'utf8'),
            )
            const rows = Array.isArray(value) ? value : []
            return {
              file: entry.name,
              count: rows.length,
              scenarioIds: rows
                .map((row) =>
                  typeof row === 'object' && row !== null && 'scenario_id' in row
                    ? (row as { scenario_id?: unknown }).scenario_id
                    : undefined,
                )
                .filter((id): id is string => typeof id === 'string'),
            }
          }),
      )
      res.json({ items })
    }),
  )

  router.post(
    '/api/ace/runs',
    asyncHandler(async (req, res) => {
      const parsed = parseAceRunRequest(req.body)
      const sourceTraceUid = parsed.request.sourceTraceUid
      let pendingLineage: AceRunLineage | undefined
      if (sourceTraceUid !== undefined) {
        const source = ctx.store.lookup(sourceTraceUid)
        if (source.kind === 'ambiguous') {
          res.status(409).json({
            error: 'legacy trace id is ambiguous',
            candidates: source.candidates,
          })
          return
        }
        if (source.kind === 'missing') {
          res.status(404).json({ error: 'source trace not found' })
          return
        }
        const parent = source.stored.trace
        if (parent.meta.corpusId !== 'simulation') {
          res.status(422).json({
            error:
              'fresh same-task rerun requires a simulation trace; save production evidence as a runnable regression scenario first',
          })
          return
        }
        if (parsed.request.scenarioIds?.[0] !== parent.meta.instanceId) {
          res.status(422).json({
            error: 'source trace task does not match the requested scenarioId',
            sourceScenarioId: parent.meta.instanceId,
          })
          return
        }
        const parentExtra = record(parent.meta.extra)
        const parentSeed = parentExtra.environment_seed ?? parentExtra.environmentSeed
        if (!Number.isSafeInteger(parentSeed) || Number(parentSeed) < 0) {
          res.status(422).json({
            error:
              'source trace lacks a recorded environment seed; launch a task rerun without trace ancestry instead',
          })
          return
        }
        if (parsed.request.seeds[0] !== parentSeed) {
          res.status(422).json({
            error: 'fresh trace rerun must preserve the recorded environment seed',
            sourceEnvironmentSeed: parentSeed,
          })
          return
        }
        const promptText = await effectiveChildPromptText(parsed.bridgeParams, config.projectRoot)
        const configComparison = compareAceRunConfig(
          parentExtra.config_snapshot,
          parsed.bridgeParams,
          {
            ...(promptText !== undefined ? { effectivePromptText: promptText } : {}),
          },
        )
        pendingLineage = {
          relation: 'fresh_task_rerun',
          parentTraceUid: source.traceUid,
          parentSourceTraceId: parent.meta.sourceTraceId ?? parent.meta.traceId,
          parentRunId: parent.meta.runId ?? 'unknown',
          fidelity: 'scenario_fresh_rerun_state_regenerated',
          stateExact: false,
          configExact: configComparison.configExact,
          llmExact: false,
          ...(configComparison.policyChanged !== undefined
            ? { policyChanged: configComparison.policyChanged }
            : {}),
        }
      }
      if (pendingLineage) await launchLineage.assertCompatible(parsed.runId, pendingLineage)
      const started = await bridge.start(parsed.runId, {
        ...parsed.bridgeParams,
        ...(pendingLineage ? { lineage: bridgeFreshRunLineage(pendingLineage) } : {}),
      })
      // Starting the fixed bridge is the commit point. A spawn/duplicate-run
      // failure must never leave immutable ancestry attached to a run that did
      // not launch and may later be retried with a different parent.
      let lineageWarning: string | undefined
      if (pendingLineage) {
        try {
          await launchLineage.append(parsed.runId, pendingLineage)
        } catch (error) {
          // READY means ACE already durably recorded the authoritative lineage
          // in batch.json. A local mirror failure must not turn a running batch
          // into a false HTTP failure that tempts the caller to launch again.
          lineageWarning =
            'ACE run started, but the Viewer lineage mirror could not be updated; batch.json remains authoritative.'
          console.error(
            `[ace lineage] ${parsed.runId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      res.status(202).json({
        runId: started.runId,
        lifecycle: 'queued',
        startedAt: started.startedAt,
        checkpoints: true,
        ...(lineageWarning ? { warnings: [lineageWarning] } : {}),
      })
    }),
  )

  router.post(
    '/api/ace/runs/:runId/control',
    asyncHandler(async (req, res) => {
      const action = parseControlRequest(req.body)
      const runId = safeId(req.params.runId, 'runId')
      const run = (await batchesWithTraceUids()).find((candidate) => candidate.runId === runId)
      if (!run) {
        res.status(404).json({ error: 'run not found', runId })
        return
      }
      const decision = aceRunControlDecision(run, action)
      if (!decision.allowed) {
        res.status(409).json({
          error: decision.reason,
          runId,
          lifecycle: run.lifecycle,
          manifestAvailable: run.manifestAvailable,
          controlsAvailable: run.controlsAvailable !== false,
          allowedActions: ACE_RUN_CONTROL_ACTIONS.filter(
            (candidate) => aceRunControlDecision(run, candidate).allowed,
          ),
        })
        return
      }
      const result = await bridge.call<{ run_id: string; control: Record<string, unknown> }>(
        'control',
        { runId, command: action },
      )
      res.json({ runId: result.run_id, desiredState: action, control: result.control })
    }),
  )

  router.get(
    '/api/ace/traces/:traceUid/checkpoints',
    asyncHandler(async (req, res) => {
      const lookup = ctx.store.lookup(String(req.params.traceUid))
      if (lookup.kind === 'ambiguous') {
        res.status(409).json({
          error: 'legacy trace id is ambiguous',
          sourceTraceId: lookup.sourceTraceId,
          candidates: lookup.candidates,
        })
        return
      }
      if (lookup.kind === 'missing') {
        res.status(404).json({ error: 'trace not found' })
        return
      }
      const traceUid = lookup.traceUid
      const stored = lookup.stored
      const historicalReplayAvailable = stored.trace.meta.corpusId === 'production'
      if (!stored.sourcePath) {
        res.json({
          traceUid,
          available: false,
          forkAvailable: false,
          historicalReplayAvailable,
          missing: ['durable source path', 'checkpoint archive'],
          checkpoints: [],
        })
        return
      }
      const checkpointPath = checkpointPathFor(stored.sourcePath)
      if (!checkpointPath) {
        res.json({
          traceUid,
          available: false,
          forkAvailable: false,
          historicalReplayAvailable,
          missing: ['checkpoint archive', 'JSON episode source'],
          checkpoints: [],
        })
        return
      }
      try {
        await fs.access(checkpointPath)
      } catch {
        res.json({
          traceUid,
          available: false,
          forkAvailable: false,
          historicalReplayAvailable,
          missing: ['checkpoint archive', 'scenario/config snapshot'],
          checkpoints: [],
        })
        return
      }
      const result = await bridge.call<Record<string, unknown>>('checkpoints', {
        checkpointPath,
      })
      const fork = record(result.cockpit_fork)
      res.json({
        traceUid,
        available: true,
        forkAvailable: fork.available === true,
        historicalReplayAvailable,
        missing: Array.isArray(fork.missing) ? fork.missing : [],
        checkpoints: Array.isArray(result.checkpoints) ? result.checkpoints : [],
        capabilities: record(result.capabilities),
        source: publicBridgeResult(result.source),
      })
    }),
  )

  router.get(
    '/api/ace/traces/:traceUid/regression-capability',
    asyncHandler(async (req, res) => {
      const lookup = ctx.store.lookup(String(req.params.traceUid))
      if (lookup.kind === 'ambiguous') {
        res.status(409).json({
          error: 'legacy trace id is ambiguous',
          sourceTraceId: lookup.sourceTraceId,
          candidates: lookup.candidates,
        })
        return
      }
      if (lookup.kind === 'missing') {
        res.status(404).json({ error: 'trace not found' })
        return
      }
      res.json(
        regressionCapability(lookup.stored.trace, lookup.stored.sourcePath, config.projectRoot),
      )
    }),
  )

  router.post(
    '/api/ace/regressions',
    asyncHandler(async (req, res) => {
      const body = record(req.body)
      const allowed = new Set([
        'sourceTraceUid',
        'boundaryMessageId',
        'regressionId',
        'scenarioSnapshot',
      ])
      const unknown = Object.keys(body).filter((key) => !allowed.has(key))
      if (unknown.length > 0) {
        throw new AceRequestError(`unknown regression field(s): ${unknown.join(', ')}`)
      }
      if (typeof body.sourceTraceUid !== 'string' || body.sourceTraceUid === '') {
        throw new AceRequestError('sourceTraceUid is required')
      }
      const lookup = ctx.store.lookup(body.sourceTraceUid)
      if (lookup.kind !== 'found') {
        res
          .status(lookup.kind === 'ambiguous' ? 409 : 404)
          .json(
            lookup.kind === 'ambiguous'
              ? { error: 'legacy trace id is ambiguous', candidates: lookup.candidates }
              : { error: 'trace not found' },
          )
        return
      }
      const capability = regressionCapability(
        lookup.stored.trace,
        lookup.stored.sourcePath,
        config.projectRoot,
      )
      if (!capability.available || !lookup.stored.sourcePath) {
        res.status(422).json({
          error: `regression save unavailable: ${capability.missing.join(', ')}`,
          capability,
        })
        return
      }
      const boundaryMessageId = optionalOpaqueId(body.boundaryMessageId, 'boundaryMessageId')
      const regressionId = optionalSafeId(body.regressionId, 'regressionId')
      const trace = lookup.stored.trace
      const prefix = regressionPrefix(trace, boundaryMessageId)
      const extra = record(trace.meta.extra)
      const groundTruth = record(extra.groundTruth)
      const recordedScenarioSnapshot = regressionScenarioSnapshot(trace)
      let suppliedScenarioSnapshot:
        | ReturnType<typeof parseAceRegressionScenarioSnapshot>
        | undefined
      if (body.scenarioSnapshot !== undefined) {
        if (trace.meta.corpusId !== 'production') {
          throw new AceRequestError(
            'scenarioSnapshot may only complete a production trace without a recorded Scenario',
          )
        }
        if (recordedScenarioSnapshot !== undefined) {
          throw new AceRequestError(
            'scenarioSnapshot cannot replace the immutable Scenario already recorded by this trace',
          )
        }
        try {
          suppliedScenarioSnapshot = parseAceRegressionScenarioSnapshot(body.scenarioSnapshot)
        } catch (error) {
          throw new AceRequestError(
            error instanceof Error ? error.message : 'scenarioSnapshot is invalid',
          )
        }
      }
      const scenarioSnapshot = recordedScenarioSnapshot ?? suppliedScenarioSnapshot
      const configSnapshot = optionalRecord(extra.config_snapshot)
      const recordedWorld = optionalRecord(groundTruth.world)
      const worldDiff = trace.evaluation?.worldDiff ?? []
      const worldProvenance =
        recordedWorld || worldDiff.length > 0
          ? { ...(recordedWorld ?? {}), ...(worldDiff.length > 0 ? { world_diff: worldDiff } : {}) }
          : undefined
      const result = await bridge.call<Record<string, unknown>>('save-regression', {
        tracePath: lookup.stored.sourcePath,
        sourceTraceUid: lookup.traceUid,
        sourceTraceId: trace.meta.sourceTraceId ?? trace.meta.traceId,
        corpusId: trace.meta.corpusId ?? 'unknown',
        runId: trace.meta.runId ?? 'unknown',
        instanceId: trace.meta.instanceId || 'unknown',
        ...(trace.meta.pairKey ? { pairKey: trace.meta.pairKey } : {}),
        ...(regressionId ? { regressionId } : {}),
        ...prefix,
        ...(scenarioSnapshot ? { scenarioSnapshot } : {}),
        ...(configSnapshot ? { configSnapshot } : {}),
        ...(worldProvenance ? { worldProvenance } : {}),
        ...(trace.evaluation?.lineage ? { lineage: trace.evaluation.lineage } : {}),
      })
      const rawAnchor = record(result.anchor)
      const response = {
        sourceTraceUid: lookup.traceUid,
        regressionId: String(result.regression_id),
        artifactKind: String(result.artifact_kind),
        runnable: result.runnable === true,
        deduplicated: result.deduplicated === true,
        artifact: String(result.artifact),
        scenarioPack: typeof result.scenario_pack === 'string' ? result.scenario_pack : null,
        draft: typeof result.draft === 'string' ? result.draft : null,
        scenarioId: typeof result.scenario_id === 'string' ? result.scenario_id : null,
        missingRequiredFields: Array.isArray(result.missing_required_fields)
          ? result.missing_required_fields
          : [],
        fidelity: record(result.fidelity),
        anchor: {
          kind: rawAnchor.kind,
          indexSpace: rawAnchor.index_space,
          inclusive: rawAnchor.inclusive,
          messageId: rawAnchor.message_id,
          rawIndex: rawAnchor.raw_index,
          chronologicalIndex: rawAnchor.chronological_index,
        },
      }
      res.status(response.deduplicated ? 200 : 201).json(publicBridgeResult(response))
    }),
  )

  router.post(
    '/api/ace/replays',
    asyncHandler(async (req, res) => {
      const body = record(req.body)
      const allowed = new Set([
        'sourceTraceUid',
        'checkpointId',
        'mode',
        'childRunId',
        'childTraceId',
        'costCapUsd',
        'nextUserMessage',
        'forkMessageId',
        'prompt',
        'model',
        'temperature',
      ])
      const unknown = Object.keys(body).filter((key) => !allowed.has(key))
      if (unknown.length > 0) {
        throw new AceRequestError(`unknown replay field(s): ${unknown.join(', ')}`)
      }
      if (typeof body.sourceTraceUid !== 'string' || body.sourceTraceUid === '') {
        res.status(400).json({ error: 'sourceTraceUid is required' })
        return
      }
      const lookup = ctx.store.lookup(body.sourceTraceUid)
      if (lookup.kind !== 'found') {
        res
          .status(lookup.kind === 'ambiguous' ? 409 : 404)
          .json(
            lookup.kind === 'ambiguous'
              ? { error: 'legacy trace id is ambiguous', candidates: lookup.candidates }
              : { error: 'trace not found' },
          )
        return
      }
      if (!lookup.stored.sourcePath) {
        res.status(422).json({ error: 'replay requires a durable source trace' })
        return
      }
      const mode = body.mode
      if (!['restore', 'exact', 'counterfactual', 'historical_tools'].includes(String(mode))) {
        res.status(400).json({ error: 'invalid replay mode' })
        return
      }
      const modeFields =
        mode === 'historical_tools'
          ? new Set(['sourceTraceUid', 'mode'])
          : mode === 'restore'
            ? new Set(['sourceTraceUid', 'mode', 'checkpointId'])
            : mode === 'exact'
              ? new Set([
                  'sourceTraceUid',
                  'mode',
                  'checkpointId',
                  'childRunId',
                  'childTraceId',
                  'costCapUsd',
                  'forkMessageId',
                ])
              : allowed
      const irrelevant = Object.keys(body).filter((key) => !modeFields.has(key))
      if (irrelevant.length > 0) {
        throw new AceRequestError(
          `field(s) not allowed for ${String(mode)} replay: ${irrelevant.join(', ')}`,
        )
      }
      if (mode === 'historical_tools') {
        if (lookup.stored.trace.meta.corpusId !== 'production') {
          res.status(422).json({
            error: 'historical tool replay is available only for production traces',
          })
          return
        }
        const result = await bridge.call<Record<string, unknown>>('historical-replay', {
          tracePath: lookup.stored.sourcePath,
        })
        res.status(201).json({
          sourceTraceUid: lookup.traceUid,
          mode,
          result: publicBridgeResult(result),
        })
        return
      }

      const checkpointId = body.checkpointId === undefined ? -1 : body.checkpointId
      if (!Number.isSafeInteger(checkpointId) || Number(checkpointId) < -1) {
        res.status(400).json({ error: 'checkpointId must be an integer >= -1' })
        return
      }
      const checkpointPath = checkpointPathFor(lookup.stored.sourcePath)
      if (!checkpointPath) {
        res.status(422).json({ error: 'checkpoint replay requires a JSON episode source' })
        return
      }
      if (mode === 'restore') {
        const result = await bridge.call<Record<string, unknown>>('replay', {
          checkpointPath,
          checkpointId,
        })
        res.status(201).json({
          sourceTraceUid: lookup.traceUid,
          mode,
          result: publicBridgeResult(result),
        })
        return
      }

      const costCapUsd = forkCostCap(body.costCapUsd)
      const nextRunId =
        body.childRunId === undefined ? childRunId() : safeId(body.childRunId, 'childRunId')
      const childTraceId = optionalSafeId(body.childTraceId, 'childTraceId')
      const forkMessageId = optionalOpaqueId(body.forkMessageId, 'forkMessageId')
      const nextUserMessage = optionalText(body.nextUserMessage, 'nextUserMessage')
      const promptText = optionalText(body.prompt, 'prompt')
      const model = optionalModel(body.model)
      const temperature = optionalTemperature(body.temperature)
      const overrides = ['nextUserMessage', 'prompt', 'model', 'temperature'].filter(
        (key) => body[key] !== undefined,
      )
      if (mode === 'exact' && overrides.length > 0) {
        res.status(400).json({ error: 'exact fork forbids policy/message overrides' })
        return
      }
      if (mode === 'counterfactual' && overrides.length === 0) {
        res.status(400).json({ error: 'counterfactual fork requires at least one override' })
        return
      }
      const result = await bridge.call<Record<string, unknown>>(
        'fork',
        {
          checkpointPath,
          checkpointId,
          childRunId: nextRunId,
          mode,
          costCapUsd,
          parentTraceUid: lookup.traceUid,
          ...(forkMessageId !== undefined ? { forkMessageId } : {}),
          ...(childTraceId !== undefined ? { childTraceId } : {}),
          ...(nextUserMessage !== undefined ? { nextUserMessage } : {}),
          ...(promptText !== undefined ? { promptText } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
        },
        30 * 60 * 1000,
      )
      res.status(201).json({
        sourceTraceUid: lookup.traceUid,
        mode,
        childRunId: nextRunId,
        result: publicBridgeResult(result),
      })
    }),
  )

  router.get(
    '/api/ace/runs',
    asyncHandler(async (_req, res) => {
      const items = await batchesWithTraceUids()
      res.json({ total: items.length, items })
    }),
  )

  router.get(
    '/api/ace/runs/:runId',
    asyncHandler(async (req, res) => {
      const items = await batchesWithTraceUids()
      const batch = items.find((item) => item.runId === req.params.runId)
      if (!batch) {
        res.status(404).json({ error: 'ACE run not found' })
        return
      }
      res.json(batch)
    }),
  )

  return router
}
