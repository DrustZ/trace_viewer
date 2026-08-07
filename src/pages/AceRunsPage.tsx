import type {
  AceBatchEpisode,
  AceBatchSummary,
  AceBatchTotals,
  AceRunLifecycle,
  AceRunTraceSummary,
} from '@shared/schema/ace'
import { type AceRunControlAction, aceRunControlDecision } from '@shared/schema/aceRunControl'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAceRun, useAceRuns, useControlAceRun } from '../api/ace'
import { AceRunLauncher } from '../components/ace/AceRunLauncher'
import Drawer from '../components/common/Drawer'
import { EmptyState, LoadingState } from '../components/common/EmptyState'
import { formatNumber, formatPercent } from '../components/common/format'

function Outcome({ value }: { value: string }) {
  const cls =
    value === 'pass'
      ? 'bg-emerald-50 text-emerald-700'
      : value === 'fail'
        ? 'bg-red-50 text-red-700'
        : value === 'invalid'
          ? 'bg-amber-50 text-amber-700'
          : value === 'runtime_error'
            ? 'bg-violet-50 text-violet-700'
            : 'bg-slate-100 text-slate-600'
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${cls}`}>
      {value}
    </span>
  )
}

const TERMINAL_EPISODE_STATUSES = new Set(['completed', 'cancelled', 'failed', 'error'])
const EPISODE_PAGE_SIZE = 100

export function aceRunControlDisabled(
  run: Pick<
    AceBatchSummary,
    'controlsAvailable' | 'lifecycle' | 'manifestAvailable' | 'staleManifest'
  >,
  action: AceRunControlAction,
  pending = false,
): boolean {
  return !aceRunControlDecision(run, action, pending).allowed
}

export function AceRunAccessStatus({
  manifestAvailable,
  controlsAvailable,
}: Pick<AceBatchSummary, 'manifestAvailable' | 'controlsAvailable'>) {
  if (manifestAvailable !== false && controlsAvailable !== false) return null
  return (
    <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
      {manifestAvailable === false && controlsAvailable === false
        ? 'trace-only · read-only'
        : manifestAvailable === false
          ? 'manifest pending'
          : 'controls unavailable'}
    </span>
  )
}

export function aceRunHeartbeat(
  updatedAt: string,
  lifecycle: AceRunLifecycle,
  now = Date.now(),
): { ageMs: number | null; stale: boolean } {
  const timestamp = Date.parse(updatedAt)
  const ageMs = Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null
  return {
    ageMs,
    stale:
      ageMs !== null &&
      ageMs > 120_000 &&
      ['queued', 'running', 'paused', 'cancelling'].includes(lifecycle),
  }
}

export function formatHeartbeatAge(ageMs: number | null): string {
  if (ageMs === null) return 'age unavailable'
  const seconds = Math.floor(ageMs / 1_000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

export function aceRunProgress(
  scheduledEpisodes: number,
  episodes: readonly Pick<AceBatchEpisode, 'status'>[],
): { terminal: number; inProgress: number; stateNotRepresented: number } {
  const terminal = episodes.filter((episode) =>
    TERMINAL_EPISODE_STATUSES.has(episode.status),
  ).length
  return {
    terminal,
    inProgress: Math.max(0, scheduledEpisodes - terminal),
    stateNotRepresented: Math.max(0, scheduledEpisodes - episodes.length),
  }
}

export interface AceRunIssue {
  key: string
  severity: 'error' | 'warning'
  text: string
}

/** Every run-level notice folded into one expandable "Issues (n)" block. */
export function collectRunIssues(
  run: Pick<
    AceBatchSummary,
    'runKind' | 'staleManifest' | 'manifestError' | 'lifecycleError' | 'reconciliation'
  >,
  controlError?: unknown,
): AceRunIssue[] {
  const issues: AceRunIssue[] = []
  if (run.lifecycleError) {
    issues.push({
      key: 'lifecycle',
      severity: 'error',
      text: `Harness error: ${run.lifecycleError}`,
    })
  }
  if (controlError) {
    issues.push({
      key: 'control',
      severity: 'error',
      text: `Control request failed: ${
        controlError instanceof Error ? controlError.message : String(controlError)
      }`,
    })
  }
  if (run.runKind !== 'scored') {
    issues.push({
      key: 'run-kind',
      severity: 'warning',
      text: `This is a ${run.runKind} run. It is available for exact analysis, but it is excluded from the default formal aggregate.`,
    })
  }
  if (run.staleManifest) {
    issues.push({
      key: 'stale-manifest',
      severity: 'warning',
      text: `The current batch.json is unreadable; showing the last successfully parsed snapshot. ${run.manifestError ?? ''}`.trim(),
    })
  }
  const reconciliation = run.reconciliation
  if (
    reconciliation &&
    (reconciliation.missingTerminalTraces > 0 ||
      reconciliation.orphanTraces > 0 ||
      reconciliation.manifestEpisodes < reconciliation.scheduledEpisodes)
  ) {
    issues.push({
      key: 'reconciliation',
      severity: 'warning',
      text: `Ingest reconciliation: ${reconciliation.missingTerminalTraces} terminal trace(s) missing · ${reconciliation.orphanTraces} orphan trace(s) · ${reconciliation.manifestEpisodes}/${reconciliation.scheduledEpisodes} scheduled states represented.`,
    })
  }
  return issues
}

/**
 * The six primary run tiles; everything secondary (traces loaded, runtime
 * errors, in-progress, attempt validity) folds into "More stats".
 */
export function RunStatTiles({
  totals,
  tracesLoaded,
  progress,
}: {
  totals: AceBatchTotals
  tracesLoaded: number
  progress: { inProgress: number; stateNotRepresented: number } | null
}) {
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-3 xl:grid-cols-6">
        <div>
          <span className="text-slate-400">Scheduled</span>
          <br />
          <b>{formatNumber(totals.episodes)}</b>
        </div>
        <div>
          <span className="text-slate-400">Pass</span>
          <br />
          <b className="text-emerald-700">{formatNumber(totals.passed)}</b>
        </div>
        <div>
          <span className="text-slate-400">Fail</span>
          <br />
          <b className="text-red-700">{formatNumber(totals.failedGrade)}</b>
        </div>
        <div>
          <span className="text-slate-400">Invalid</span>
          <br />
          <b className="text-amber-700">{formatNumber(totals.invalidUserSim)}</b>
        </div>
        <div>
          <span className="text-slate-400">Pass rate</span>
          <br />
          <b>{formatPercent(totals.passRate)}</b>
        </div>
        <div>
          <span className="text-slate-400">Cost</span>
          <br />
          <b>{totals.costUsd === null ? '—' : `$${totals.costUsd.toFixed(2)}`}</b>
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700">
          More stats
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <span className="text-slate-400">Traces loaded</span>
            <br />
            <b>{formatNumber(tracesLoaded)}</b>
          </div>
          <div>
            <span className="text-slate-400">Runtime</span>
            <br />
            <b className="text-violet-700">{formatNumber(totals.runtimeErrors)}</b>
          </div>
          <div>
            <span className="text-slate-400">In progress</span>
            <br />
            <b>{formatNumber(progress?.inProgress ?? 0)}</b>
            {(progress?.stateNotRepresented ?? 0) > 0 ? (
              <div className="text-[10px] text-amber-600">
                {formatNumber(progress?.stateNotRepresented ?? 0)} schedule states not yet
                represented
              </div>
            ) : null}
          </div>
          <div>
            <span className="text-slate-400">Attempt validity</span>
            <br />
            <b>{formatPercent(totals.userSimAttemptValidityRate)}</b>
            {totals.userSimAttempts !== null && totals.invalidUserSimAttempts !== null ? (
              <div className="text-[10px] text-slate-400">
                {totals.userSimAttempts - totals.invalidUserSimAttempts} / {totals.userSimAttempts}{' '}
                attempts
              </div>
            ) : null}
          </div>
        </div>
      </details>
    </>
  )
}

export function filterAceRunEpisodes(
  episodes: readonly AceBatchEpisode[],
  tracesByUid: ReadonlyMap<string, AceRunTraceSummary>,
  options: { query: string; status: string; failuresOnly: boolean },
): AceBatchEpisode[] {
  const query = options.query.trim().toLowerCase()
  return episodes.filter((episode) => {
    const trace = episode.traceUid ? tracesByUid.get(episode.traceUid) : undefined
    if (options.status && episode.status !== options.status) return false
    if (
      options.failuresOnly &&
      episode.outcome !== 'fail' &&
      episode.outcome !== 'invalid' &&
      episode.outcome !== 'runtime_error' &&
      episode.failedChecks.length === 0 &&
      !['failed', 'error', 'cancelled'].includes(episode.status) &&
      (trace?.failureCount ?? 0) === 0 &&
      trace?.judgeDisagreement !== true
    ) {
      return false
    }
    if (!query) return true
    return [
      episode.scenarioId,
      episode.sourceTraceId,
      String(episode.seed),
      episode.status,
      episode.outcome,
      ...episode.failedChecks,
      ...(trace?.failureCodes ?? []),
      ...(trace?.failureOrigins ?? []),
    ].some((value) => value.toLowerCase().includes(query))
  })
}

export default function AceRunsPage() {
  const [search, setSearch] = useSearchParams()
  const runs = useAceRuns()
  const selected = search.get('run') ?? runs.data?.items[0]?.runId
  const initialScenarioFile = search.get('scenarioFile') ?? undefined
  const initialScenarioId = search.get('scenarioId') ?? undefined
  const run = useAceRun(selected)
  const control = useControlAceRun(selected ?? '')
  const episodes = run.data?.episodes ?? []
  const runTraces = run.data?.traces ?? []
  const tracesByUid = useMemo(
    () => new Map(runTraces.map((trace) => [trace.traceUid, trace])),
    [runTraces],
  )
  const [episodeQuery, setEpisodeQuery] = useState('')
  const [episodeStatus, setEpisodeStatus] = useState('')
  const [failuresOnly, setFailuresOnly] = useState(false)
  const [episodePage, setEpisodePage] = useState(0)
  // Deep links from the task explorer carry scenario params: open the launcher
  // pre-filled instead of burying the intent behind the New run button.
  const [launcherOpen, setLauncherOpen] = useState(
    () => Boolean(initialScenarioFile) || Boolean(initialScenarioId),
  )
  const episodeStatuses = useMemo(
    () => [...new Set(episodes.map((episode) => episode.status))].sort(),
    [episodes],
  )
  const filteredEpisodes = useMemo(
    () =>
      filterAceRunEpisodes(episodes, tracesByUid, {
        query: episodeQuery,
        status: episodeStatus,
        failuresOnly,
      }),
    [episodes, tracesByUid, episodeQuery, episodeStatus, failuresOnly],
  )
  const pageCount = Math.max(1, Math.ceil(filteredEpisodes.length / EPISODE_PAGE_SIZE))
  const currentEpisodePage = Math.min(episodePage, pageCount - 1)
  const visibleEpisodes = filteredEpisodes.slice(
    currentEpisodePage * EPISODE_PAGE_SIZE,
    (currentEpisodePage + 1) * EPISODE_PAGE_SIZE,
  )
  const activeEpisodes = useMemo(
    () =>
      episodes.filter(
        (row) =>
          !TERMINAL_EPISODE_STATUSES.has(row.status) &&
          ['queued', 'pending', 'running', 'paused', 'cancelling'].includes(row.status),
      ),
    [episodes],
  )
  const terminalEpisodeCount = useMemo(
    () => episodes.filter((row) => TERMINAL_EPISODE_STATUSES.has(row.status)).length,
    [episodes],
  )
  const failures = useMemo(
    () =>
      episodes.filter((row) => {
        const trace = row.traceUid ? tracesByUid.get(row.traceUid) : undefined
        return (
          row.outcome === 'fail' ||
          row.outcome === 'invalid' ||
          row.outcome === 'runtime_error' ||
          ['failed', 'error', 'cancelled'].includes(row.status) ||
          (trace?.failureCount ?? 0) > 0 ||
          trace?.judgeDisagreement === true
        )
      }),
    [episodes, tracesByUid],
  )
  const heartbeat = run.data
    ? aceRunHeartbeat(run.data.updatedAt, run.data.lifecycle)
    : { ageMs: null, stale: false }
  const progress = run.data ? aceRunProgress(run.data.totals.episodes, episodes) : null
  const issues = run.data ? collectRunIssues(run.data, control.error) : []

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold text-slate-900">ACE runs</h1>
          <label className="flex min-w-0 items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Run
            </span>
            <select
              value={selected ?? ''}
              onChange={(event) => {
                setEpisodePage(0)
                // Merge instead of replace: dropping scenarioFile/scenarioId would
                // remount the launcher (keyed on them) and wipe a half-filled form.
                setSearch((current) => {
                  const next = new URLSearchParams(current)
                  next.set('run', event.target.value)
                  return next
                })
              }}
              className="max-w-[28rem] rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm font-semibold text-slate-900"
            >
              {(runs.data?.items ?? []).map((item) => (
                <option key={item.runId}>{item.runId}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setLauncherOpen(true)}
            className="ml-auto rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            New run
          </button>
        </header>
        <Drawer open={launcherOpen} onClose={() => setLauncherOpen(false)} title="New run">
          <AceRunLauncher
            key={`${initialScenarioFile ?? ''}:${initialScenarioId ?? ''}`}
            initialScenarioFile={initialScenarioFile}
            initialScenarioId={initialScenarioId}
            onStarted={(runId) => {
              setEpisodePage(0)
              setLauncherOpen(false)
              setSearch((current) => {
                const next = new URLSearchParams(current)
                next.set('run', runId)
                return next
              })
            }}
          />
        </Drawer>
        {runs.isLoading ? (
          <LoadingState label="Loading ACE runs…" />
        ) : runs.error ? (
          <EmptyState
            title="Run catalog unavailable"
            hint={runs.error instanceof Error ? runs.error.message : String(runs.error)}
          />
        ) : !selected ? (
          <EmptyState title="No ACE runs" hint="Start a run from the simulation controls." />
        ) : run.isLoading ? (
          <LoadingState label="Loading batch…" />
        ) : run.error || !run.data ? (
          <EmptyState
            title="Run not found"
            hint={
              run.error instanceof Error
                ? run.error.message
                : 'Choose an exact run ID from the catalog.'
            }
          />
        ) : (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-mono text-sm font-semibold">{run.data.runId}</h2>
                <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                  {run.data.lifecycle}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                  {run.data.runKind}
                </span>
                <AceRunAccessStatus
                  manifestAvailable={run.data.manifestAvailable}
                  controlsAvailable={run.data.controlsAvailable}
                />
                {heartbeat.stale ? (
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    heartbeat stale
                  </span>
                ) : null}
                <div className="ml-auto flex gap-1">
                  {(['pause', 'resume', 'cancel'] as const).map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => control.mutate(action)}
                      disabled={aceRunControlDisabled(run.data, action, control.isPending)}
                      title={aceRunControlDecision(run.data, action, control.isPending).reason}
                      className="rounded border border-slate-200 px-2 py-1 text-xs capitalize hover:bg-slate-50 disabled:opacity-40"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                {run.data.manifestAvailable === false
                  ? `Latest loaded trace ${new Date(run.data.updatedAt).toLocaleString()} · no batch manifest is available.`
                  : `Last durable manifest heartbeat ${new Date(run.data.updatedAt).toLocaleString()} · ${formatHeartbeatAge(heartbeat.ageMs)} · controls take effect at a safe turn boundary.`}
              </p>
              <RunStatTiles
                totals={run.data.totals}
                tracesLoaded={run.data.reconciliation?.ingestedTraces ?? runTraces.length}
                progress={progress}
              />
              {issues.length > 0 && (
                <details
                  open={issues.some((issue) => issue.severity === 'error')}
                  className="mt-3 rounded border border-amber-200 bg-amber-50"
                >
                  <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium text-amber-800">
                    Issues ({issues.length})
                  </summary>
                  <ul className="space-y-1 px-2 pb-2">
                    {issues.map((issue) => (
                      <li
                        key={issue.key}
                        role={issue.severity === 'error' ? 'alert' : undefined}
                        className={`rounded px-2 py-1.5 text-xs ${
                          issue.severity === 'error'
                            ? 'bg-red-50 text-red-800'
                            : 'bg-amber-100/60 text-amber-800'
                        }`}
                      >
                        {issue.text}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                {['bot', 'bot_model', 'agent_transport', 'reasoning_effort', 'prompt_source'].map(
                  (key) =>
                    run.data.spec[key] !== undefined ? (
                      <span key={key} className="rounded bg-slate-100 px-2 py-1">
                        {key}: {String(run.data.spec[key])}
                      </span>
                    ) : null,
                )}
                <Link
                  to={`/compare?runA=${encodeURIComponent(run.data.runId)}`}
                  className="ml-auto rounded border border-blue-200 px-2 py-1 text-blue-700 hover:bg-blue-50"
                >
                  Compare this run →
                </Link>
              </div>
              {run.data.failureChecks.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {run.data.failureChecks.map((item) => (
                    <span
                      key={item.code}
                      className="rounded bg-red-50 px-2 py-1 text-xs text-red-700"
                    >
                      {item.code} · {item.count}
                    </span>
                  ))}
                </div>
              )}
            </section>
            {activeEpisodes.length > 0 && (
              <section className="overflow-hidden rounded-lg border border-blue-200 bg-white">
                <div className="flex items-center border-b border-blue-100 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-900">
                  Current activity · {activeEpisodes.length}
                  <span className="ml-auto text-[11px] font-normal text-blue-600">
                    Message-level durable progress
                  </span>
                </div>
                <div className="max-h-52 overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Scenario</th>
                        <th>Seed</th>
                        <th>Status</th>
                        <th>Pending phase</th>
                        <th>Messages</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeEpisodes.map((row) => (
                        <tr
                          key={row.pairKey ?? row.sourceTraceId}
                          className="border-t border-slate-100"
                        >
                          <td className="px-3 py-2 font-mono">
                            {row.traceUid ? (
                              <Link
                                className="text-blue-600 hover:underline"
                                to={`/trace/${encodeURIComponent(row.traceUid)}`}
                              >
                                {row.scenarioId}
                              </Link>
                            ) : (
                              row.scenarioId
                            )}
                          </td>
                          <td>{row.seed}</td>
                          <td>{row.status}</td>
                          <td>
                            {row.phase ?? 'queued'}
                            {row.toolName ? ` · ${row.toolName}` : ''}
                          </td>
                          <td>{row.messageCount ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-medium">
                    All scheduled episodes · {filteredEpisodes.length}/{episodes.length}
                  </h2>
                  <span className="text-[11px] font-normal text-slate-400">
                    {terminalEpisodeCount} terminal · message-complete updates arrive over SSE
                  </span>
                  <label className="ml-auto flex items-center gap-1 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={failuresOnly}
                      onChange={(event) => {
                        setEpisodePage(0)
                        setFailuresOnly(event.target.checked)
                      }}
                    />
                    Problems only
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="search"
                    value={episodeQuery}
                    onChange={(event) => {
                      setEpisodePage(0)
                      setEpisodeQuery(event.target.value)
                    }}
                    placeholder="Search task, trace, failure, seed…"
                    className="min-w-64 flex-1 rounded border border-slate-200 px-2 py-1 text-xs"
                  />
                  <select
                    value={episodeStatus}
                    onChange={(event) => {
                      setEpisodePage(0)
                      setEpisodeStatus(event.target.value)
                    }}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                  >
                    <option value="">Every status</option>
                    {episodeStatuses.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </div>
              </div>
              {episodes.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-slate-500">
                  {run.data.manifestAvailable === false
                    ? 'No manifest schedule is available; use the durable trace list below.'
                    : 'Waiting for the first scheduled episode state…'}
                </p>
              ) : filteredEpisodes.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-slate-500">
                  No scheduled episodes match these local filters.
                </p>
              ) : (
                <div className="max-h-[36rem] overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Task / trace</th>
                        <th>Seed</th>
                        <th>Status</th>
                        <th>Phase</th>
                        <th>Outcome</th>
                        <th>Messages</th>
                        <th>Diagnosis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEpisodes.map((episode) => {
                        const trace = episode.traceUid
                          ? tracesByUid.get(episode.traceUid)
                          : undefined
                        return (
                          <tr
                            key={
                              episode.pairKey ??
                              `${episode.scenarioId}:${episode.environmentSeed}:${episode.sourceTraceId}`
                            }
                            className="border-t border-slate-100 align-top"
                          >
                            <td className="px-3 py-2">
                              <div className="font-mono text-slate-700">{episode.scenarioId}</div>
                              {episode.traceUid ? (
                                <Link
                                  className="font-mono text-[10px] text-blue-600 hover:underline"
                                  to={`/trace/${encodeURIComponent(episode.traceUid)}`}
                                >
                                  {episode.sourceTraceId}
                                </Link>
                              ) : (
                                <span className="font-mono text-[10px] text-slate-400">
                                  {TERMINAL_EPISODE_STATUSES.has(episode.status)
                                    ? `${episode.sourceTraceId} · trace missing`
                                    : 'trace not emitted yet'}
                                </span>
                              )}
                            </td>
                            <td>{episode.seed}</td>
                            <td>{episode.status}</td>
                            <td>
                              {episode.phase ?? trace?.phase ?? '—'}
                              {episode.toolName ? ` · ${episode.toolName}` : ''}
                            </td>
                            <td>
                              <Outcome value={trace?.outcome ?? episode.outcome} />
                            </td>
                            <td>{trace?.messageCount ?? episode.messageCount ?? 0}</td>
                            <td className="max-w-sm text-red-700">
                              {[
                                ...episode.failedChecks,
                                ...(trace?.failureCodes ?? []),
                                ...(trace?.judgeDisagreement ? ['judge disagreement'] : []),
                              ]
                                .filter((value, index, all) => all.indexOf(value) === index)
                                .join(', ') || '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {filteredEpisodes.length > EPISODE_PAGE_SIZE && (
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-3 py-2 text-xs">
                  <button
                    type="button"
                    disabled={currentEpisodePage === 0}
                    onClick={() => setEpisodePage((page) => Math.max(0, page - 1))}
                    className="rounded border px-2 py-1 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span>
                    Page {currentEpisodePage + 1}/{pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={currentEpisodePage + 1 >= pageCount}
                    onClick={() => setEpisodePage((page) => Math.min(pageCount - 1, page + 1))}
                    className="rounded border px-2 py-1 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
            <details open className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <summary className="cursor-pointer border-b border-slate-200 px-4 py-2 text-sm font-medium">
                Every durable trace · {runTraces.length} (uncapped exact-run API)
              </summary>
              {runTraces.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-slate-500">
                  Waiting for the first durable trace message…
                </p>
              ) : (
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Trace</th>
                        <th>Task</th>
                        <th>Status / outcome</th>
                        <th>Messages</th>
                        <th>Turns / tools</th>
                        <th>Root-cause signals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runTraces.map((trace) => (
                        <tr key={trace.traceUid} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2 font-mono">
                            <Link
                              className="text-blue-600 hover:underline"
                              to={`/trace/${encodeURIComponent(trace.traceUid)}?tab=evaluation`}
                            >
                              {trace.sourceTraceId}
                            </Link>
                          </td>
                          <td className="font-mono">{trace.scenarioId}</td>
                          <td>
                            {trace.status} · <Outcome value={trace.outcome} />
                          </td>
                          <td>{trace.messageCount}</td>
                          <td>
                            {trace.turns} / {trace.toolUses}
                          </td>
                          <td className="max-w-sm text-red-700">
                            {trace.failureCodes.join(', ') ||
                              (trace.judgeDisagreement ? 'judge disagreement' : '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium">
                Failure triage · {failures.length}
              </div>
              <div className="max-h-[65vh] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Scenario</th>
                      <th>Seed</th>
                      <th>Outcome</th>
                      <th>Diagnosis</th>
                      <th>Flags</th>
                      <th>Termination</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failures.map((row) => {
                      const trace = row.traceUid ? tracesByUid.get(row.traceUid) : undefined
                      const diagnosis = [
                        ...row.failedChecks,
                        ...(trace?.failureCodes ?? []),
                        ...(trace?.judgeDisagreement ? ['judge disagreement'] : []),
                      ].filter((value, index, all) => all.indexOf(value) === index)
                      return (
                        <tr
                          key={row.pairKey ?? row.sourceTraceId}
                          className="border-t border-slate-100"
                        >
                          <td className="px-3 py-2 font-mono">
                            {row.traceUid ? (
                              <Link
                                className="text-blue-600 hover:underline"
                                to={`/trace/${encodeURIComponent(row.traceUid)}?tab=evaluation`}
                              >
                                {row.scenarioId}
                              </Link>
                            ) : (
                              row.scenarioId
                            )}
                          </td>
                          <td>{row.seed}</td>
                          <td>
                            <Outcome value={trace?.outcome ?? row.outcome} />
                          </td>
                          <td className="max-w-sm text-red-700">
                            {diagnosis.join(', ') || row.status}
                          </td>
                          <td>
                            {row.flagsMajor}M/{row.flagsMinor}m
                          </td>
                          <td>{row.termination ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
