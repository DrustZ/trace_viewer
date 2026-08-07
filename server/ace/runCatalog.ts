import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AceBatchEpisode,
  AceBatchSummary,
  AceEvaluationOutcome,
  AceRunKind,
  AceRunLifecycle,
  AceRunLineage,
} from '../../shared/schema/ace'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function normalizedLineage(value: unknown): AceRunLineage | undefined {
  const raw = record(value)
  if (Object.keys(raw).length === 0) return undefined
  const checkpointId = number(raw.checkpoint_id ?? raw.checkpointId, Number.NaN)
  return {
    ...(string(raw.relation) ? { relation: string(raw.relation) } : {}),
    ...(string(raw.parent_trace_uid ?? raw.parentTraceUid)
      ? { parentTraceUid: string(raw.parent_trace_uid ?? raw.parentTraceUid) }
      : {}),
    ...(string(raw.parent_source_trace_id ?? raw.parentSourceTraceId ?? raw.parent_trace)
      ? {
          parentSourceTraceId: string(
            raw.parent_source_trace_id ?? raw.parentSourceTraceId ?? raw.parent_trace,
          ),
        }
      : {}),
    ...(string(raw.parent_run_id ?? raw.parentRunId)
      ? { parentRunId: string(raw.parent_run_id ?? raw.parentRunId) }
      : {}),
    ...(Number.isFinite(checkpointId) ? { checkpointId } : {}),
    ...(string(raw.fork_message_id ?? raw.forkMessageId)
      ? { forkMessageId: string(raw.fork_message_id ?? raw.forkMessageId) }
      : {}),
    ...(string(raw.mode) ? { mode: string(raw.mode) } : {}),
    ...(string(raw.fidelity) ? { fidelity: string(raw.fidelity) } : {}),
    ...(boolean(raw.state_exact ?? raw.stateExact) !== undefined
      ? { stateExact: boolean(raw.state_exact ?? raw.stateExact) }
      : {}),
    ...(boolean(raw.config_exact ?? raw.configExact) !== undefined
      ? { configExact: boolean(raw.config_exact ?? raw.configExact) }
      : {}),
    ...(boolean(raw.llm_exact ?? raw.llmExact) !== undefined
      ? { llmExact: boolean(raw.llm_exact ?? raw.llmExact) }
      : {}),
    ...(boolean(raw.policy_changed ?? raw.policyChanged) !== undefined
      ? { policyChanged: boolean(raw.policy_changed ?? raw.policyChanged) }
      : {}),
  }
}

function lifecycle(value: unknown, complete: boolean): AceRunLifecycle {
  const allowed: AceRunLifecycle[] = [
    'queued',
    'running',
    'paused',
    'cancelling',
    'completed',
    'cancelled',
    'failed',
    'unknown',
  ]
  return allowed.includes(value as AceRunLifecycle)
    ? (value as AceRunLifecycle)
    : complete
      ? 'completed'
      : 'unknown'
}

function runKind(value: unknown, schemaVersion: number): AceRunKind {
  if (value === 'scored' || value === 'debug' || value === 'counterfactual') return value
  // Version 1/2 manifests predate run_kind; these are the sealed, formal
  // evaluation fixtures rather than exploratory cockpit launches.
  return schemaVersion < 3 ? 'scored' : 'unknown'
}

function outcome(row: Record<string, unknown>): AceEvaluationOutcome {
  if (row.invalid_user_sim === true) return 'invalid'
  const status = string(row.status)
  if (status === 'failed' || status === 'error') return 'runtime_error'
  if (status !== 'completed') return 'ungraded'
  const grade = record(row.grade)
  if (typeof grade.passed === 'boolean') return grade.passed ? 'pass' : 'fail'
  return 'ungraded'
}

function episodeOf(row: Record<string, unknown>, scheduleDigest: string): AceBatchEpisode | null {
  const scenarioId = string(row.scenario_id)
  const seed = number(row.environment_seed, number(row.seed, Number.NaN))
  const file = string(row.file)
  if (!scenarioId || !Number.isFinite(seed) || !file) return null
  const checks = Array.isArray(record(row.grade).checks) ? record(row.grade).checks : []
  const failedChecks = (checks as unknown[])
    .map(record)
    .filter((check) => check.gating === true && check.ok === false)
    .map((check) => string(check.name))
    .filter((name): name is string => name !== undefined)
  const flags = record(row.flag_summary)
  const environmentSeed = number(row.environment_seed, seed)
  return {
    scenarioId,
    seed,
    sourceTraceId: file.replace(/\.json$/i, ''),
    status: string(row.status) ?? 'unknown',
    ...(string(row.phase) ? { phase: string(row.phase) } : {}),
    ...(string(row.tool_name) ? { toolName: string(row.tool_name) } : {}),
    ...(Number.isFinite(number(row.message_count, Number.NaN))
      ? { messageCount: number(row.message_count) }
      : {}),
    ...(string(row.updated_at) ? { updatedAt: string(row.updated_at) } : {}),
    outcome: outcome(row),
    ...(string(row.termination) ? { termination: string(row.termination) } : {}),
    ...(typeof row.escalated === 'boolean' ? { escalated: row.escalated } : {}),
    failedChecks,
    flagsMajor: number(flags.major),
    flagsMinor: number(flags.minor),
    invalidUserSim: row.invalid_user_sim === true,
    ...(Number.isFinite(number(row.user_sim_attempts, Number.NaN))
      ? { userSimAttempts: number(row.user_sim_attempts) }
      : {}),
    ...(Number.isFinite(number(row.user_sim_invalid_attempts, Number.NaN))
      ? { userSimInvalidAttempts: number(row.user_sim_invalid_attempts) }
      : {}),
    environmentSeed,
    pairKey: `${scheduleDigest}:${scenarioId}:${environmentSeed}`,
  }
}

function counts(values: readonly string[]): Array<{ code: string; count: number }> {
  const grouped = new Map<string, number>()
  for (const value of values) grouped.set(value, (grouped.get(value) ?? 0) + 1)
  return [...grouped.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

export async function readAceBatch(manifestPath: string): Promise<AceBatchSummary> {
  const [text, stat] = await Promise.all([fs.readFile(manifestPath, 'utf8'), fs.stat(manifestPath)])
  const raw = record(JSON.parse(text))
  const schemaVersion = number(raw.schema_version, 1)
  const runId = string(raw.batch_id) ?? path.basename(path.dirname(manifestPath))
  const scheduleDigest = string(raw.schedule_digest) ?? 'schedule-unknown'
  const completedRows = Array.isArray(raw.episodes) ? raw.episodes.map(record) : []
  const stateRows = Array.isArray(raw.episode_states) ? raw.episode_states.map(record) : []
  const episodeKey = (row: Record<string, unknown>) =>
    `${String(row.scenario_id ?? '')}\0${String(row.environment_seed ?? row.seed ?? '')}\0${String(row.file ?? '')}`
  const mergedRows = new Map(stateRows.map((row) => [episodeKey(row), row]))
  for (const row of completedRows) {
    const key = episodeKey(row)
    mergedRows.set(key, { ...mergedRows.get(key), ...row })
  }
  const episodes = [...mergedRows.values()]
    .map((row) => episodeOf(row, scheduleDigest))
    .filter((row): row is AceBatchEpisode => row !== null)
  const totals = record(raw.totals)
  // A producer may atomically publish a syntactically valid but semantically
  // partial state array while retaining the intended total. Never let that
  // shrink the scheduled denominator or make an incomplete run look done.
  const expected = Math.max(
    0,
    number(totals.episodes),
    stateRows.length,
    completedRows.length,
    episodes.length,
  )
  const terminalEpisodes = episodes.filter((row) =>
    ['completed', 'cancelled', 'failed', 'error'].includes(row.status),
  )
  const finished = expected > 0 && terminalEpisodes.length >= expected
  const rawLifecycleRecord = record(raw.lifecycle)
  const rawLifecycle = rawLifecycleRecord.status ?? raw.status
  const passed = episodes.filter((row) => row.outcome === 'pass').length
  const failedGrade = episodes.filter((row) => row.outcome === 'fail').length
  const runtimeErrors = episodes.filter((row) => row.outcome === 'runtime_error').length
  const invalidUserSim = episodes.filter((row) => row.outcome === 'invalid').length
  const completeAttemptCounters =
    episodes.length > 0 &&
    episodes.every(
      (row) => row.userSimAttempts !== undefined && row.userSimInvalidAttempts !== undefined,
    )
  const userSimAttempts = completeAttemptCounters
    ? episodes.reduce((sum, row) => sum + (row.userSimAttempts ?? 0), 0)
    : null
  const invalidUserSimAttempts = completeAttemptCounters
    ? episodes.reduce((sum, row) => sum + (row.userSimInvalidAttempts ?? 0), 0)
    : null
  const executed = passed + failedGrade
  const usage = record(raw.usage)

  return {
    runId,
    runKind: runKind(raw.run_kind ?? record(raw.spec).run_kind, schemaVersion),
    schemaVersion,
    manifestAvailable: true,
    controlsAvailable: true,
    lifecycle: lifecycle(rawLifecycle, finished),
    updatedAt:
      string(rawLifecycleRecord.heartbeat_at) ??
      string(rawLifecycleRecord.updated_at) ??
      stat.mtime.toISOString(),
    ...(string(rawLifecycleRecord.error)
      ? { lifecycleError: string(rawLifecycleRecord.error) }
      : {}),
    ...(string(raw.config_digest) ? { configDigest: string(raw.config_digest) } : {}),
    ...(string(raw.schedule_digest) ? { scheduleDigest: string(raw.schedule_digest) } : {}),
    ...(string(raw.state_scope) ? { stateScope: string(raw.state_scope) } : {}),
    ...(normalizedLineage(raw.lineage) ? { lineage: normalizedLineage(raw.lineage) } : {}),
    spec: record(raw.spec),
    totals: {
      episodes: expected,
      // Episode rows, not the manifest's rolling counters, define mutually
      // exclusive outcomes. In particular, queued/cancelled work must never be
      // counted as a runtime failure merely because it is not completed.
      passed: episodes.length > 0 ? passed : number(totals.passed),
      failedGrade: episodes.length > 0 ? failedGrade : number(totals.failed_grade),
      runtimeErrors: episodes.length > 0 ? runtimeErrors : number(totals.error_state),
      invalidUserSim: episodes.length > 0 ? invalidUserSim : number(totals.invalid_user_sim),
      userSimAttempts,
      invalidUserSimAttempts,
      passRate:
        episodes.length > 0
          ? executed > 0
            ? passed / executed
            : null
          : nullableNumber(totals.pass_rate_executed ?? totals.pass_rate_all),
      userSimValidityRate:
        userSimAttempts !== null && userSimAttempts > 0 && invalidUserSimAttempts !== null
          ? (userSimAttempts - invalidUserSimAttempts) / userSimAttempts
          : null,
      userSimAttemptValidityRate:
        userSimAttempts !== null && userSimAttempts > 0 && invalidUserSimAttempts !== null
          ? (userSimAttempts - invalidUserSimAttempts) / userSimAttempts
          : null,
      avgUserTurns: nullableNumber(totals.avg_user_turns),
      avgToolCalls: nullableNumber(totals.avg_tool_calls),
      flagsMajor: number(totals.flags_major),
      flagsMinor: number(totals.flags_minor),
      costUsd: nullableNumber(totals.cost_usd ?? usage.cost_usd),
    },
    failureChecks: counts(episodes.flatMap((row) => row.failedChecks)),
    terminations: counts(episodes.flatMap((row) => (row.termination ? [row.termination] : []))),
    episodes,
  }
}

async function runDirectories(runRoot: string) {
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    entries = await fs.readdir(runRoot, { withFileTypes: true })
  } catch {
    return [] as string[]
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runRoot, entry.name, 'batch.json'))
}

export async function listAceBatches(runRoot: string): Promise<AceBatchSummary[]> {
  const manifests = await runDirectories(runRoot)
  const batches = await Promise.all(
    manifests.map(async (manifestPath) => {
      try {
        return await readAceBatch(manifestPath)
      } catch {
        return null
      }
    }),
  )
  return batches
    .filter((batch): batch is AceBatchSummary => batch !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.runId.localeCompare(b.runId))
}

/**
 * Request-local last-good batch catalog. Atomic producers normally make the
 * fallback unnecessary, but a manual/legacy partial rewrite must not make a
 * run disappear from an open cockpit page.
 */
export class AceRunCatalog {
  private readonly lastGood = new Map<string, AceBatchSummary>()

  async list(runRoot: string): Promise<AceBatchSummary[]> {
    const manifests = await runDirectories(runRoot)
    const live = new Set(manifests)
    for (const cached of this.lastGood.keys()) {
      if (!live.has(cached)) this.lastGood.delete(cached)
    }
    const batches = await Promise.all(
      manifests.map(async (manifestPath) => {
        try {
          const batch = await readAceBatch(manifestPath)
          this.lastGood.set(manifestPath, batch)
          return batch
        } catch (error) {
          const cached = this.lastGood.get(manifestPath)
          if (!cached) return null
          return {
            ...cached,
            staleManifest: true,
            manifestError: error instanceof Error ? error.message : String(error),
          }
        }
      }),
    )
    return batches
      .filter((batch): batch is AceBatchSummary => batch !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.runId.localeCompare(b.runId))
  }
}
