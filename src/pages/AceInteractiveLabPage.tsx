import { encodeFilterSet } from '@shared/filter/parse'
import type { AceBatchSummary } from '@shared/schema/ace'
import { ACE_RUN_CONTROL_ACTIONS, aceRunControlDecision } from '@shared/schema/aceRunControl'
import type { TracesListResponse } from '@shared/schema/api'
import type { Trace } from '@shared/schema/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  useAceCapabilities,
  useAceRun,
  useAceRuns,
  useAceScenarios,
  useControlAceRun,
  useStartAceRun,
} from '../api/ace'
import { useAceTasks } from '../api/aceTasks'
import { useTrace, useTraces } from '../api/hooks'
import { traceEnvironmentSeed } from '../components/ace/interactiveLab'
import {
  EpisodeConversation,
  EpisodeResultCard,
  PlaygroundActions,
  type SessionPhaseKind,
  sessionPhase,
} from '../components/ace/PlaygroundSession'
import {
  buildPlaygroundRunRequest,
  episodePollInterval,
  episodeSettled,
  initialPlaygroundConfig,
  isExistingRunConflict,
  type PlaygroundRunConfig,
  quickRunSelection,
  resolveScenarioPack,
  runtimeErrorSummary,
  shouldAutorun,
} from '../components/ace/playgroundRun'
import { ErrorState, LoadingState } from '../components/common/EmptyState'
import { formatNumber, formatPercent } from '../components/common/format'

const INPUT =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400'

function compareHref(runA: string, runB: string, instanceId: string): string {
  return `/compare?${new URLSearchParams({ runA, runB, instance: instanceId }).toString()}`
}

function LiveRunMonitor({
  runId,
  sourceTrace,
  instanceId,
}: {
  runId: string
  sourceTrace?: Trace
  instanceId: string
}) {
  // Session semantics: this run was just started here, so a 404 means "the
  // manifest is not durable yet" — poll through it instead of parking on the
  // first error (the default useAceRun behavior for stale shared URLs).
  const run = useAceRun(runId, {
    refetchInterval: (query) =>
      episodePollInterval({ lifecycle: query.state.data?.lifecycle }),
  })
  const runs = useAceRuns()
  const control = useControlAceRun(runId)
  const filters = useMemo(
    () => encodeFilterSet({ conditions: [{ key: 'run', op: 'eq', value: runId }] }),
    [runId],
  )
  // SSE is the fast path; the interval is the fallback that keeps the live
  // table honest when the event channel silently dies (see episodePollInterval).
  const traces = useTraces(
    { filters, sort: 'timestamp', order: 'desc', limit: 50 },
    { refetchInterval: episodePollInterval({ lifecycle: run.data?.lifecycle }) },
  )
  const traceItems =
    traces.data && 'items' in traces.data ? (traces.data as TracesListResponse).items : []
  const parentTraceUid = sourceTrace?.meta.traceUid ?? sourceTrace?.meta.traceId
  const siblings = (runs.data?.items ?? []).filter(
    (candidate) =>
      candidate.runId !== runId &&
      parentTraceUid !== undefined &&
      candidate.lineage?.parentTraceUid === parentTraceUid,
  )
  const summary: AceBatchSummary | undefined = run.data
  const parentRunId = sourceTrace?.meta.runId
  const active = summary
    ? ['queued', 'running', 'paused', 'cancelling'].includes(summary.lifecycle)
    : true
  const controlDecisions = ACE_RUN_CONTROL_ACTIONS.map((action) => ({
    action,
    decision: summary
      ? aceRunControlDecision(summary, action, control.isPending)
      : {
          allowed: false,
          reason: 'Waiting for an authoritative run lifecycle before controls are enabled.',
        },
  }))
  const enabledActions = controlDecisions
    .filter(({ decision }) => decision.allowed)
    .map(({ action }) => action)
  const controlStatus = control.isPending
    ? 'A run control request is in progress.'
    : enabledActions.length > 0
      ? `Available now: ${enabledActions.join(', ')}. Changes apply at a safe turn boundary.`
      : controlDecisions[0]?.decision.reason

  return (
    <section className="rounded-lg border border-blue-200 bg-white p-4" data-testid="lab-live-run">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-sm font-semibold text-slate-900">{runId}</h2>
        <span className="rounded bg-blue-50 px-2 py-1 text-[10px] font-medium uppercase text-blue-700">
          {summary?.lifecycle ?? 'discovering'}
        </span>
        {active && (
          <span className="rounded bg-emerald-50 px-2 py-1 text-[10px] text-emerald-700">
            SSE + durable message refresh
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {controlDecisions.map(({ action, decision }) => (
            <button
              key={action}
              type="button"
              disabled={!decision.allowed}
              title={decision.reason}
              onClick={() => control.mutate(action)}
              className="rounded border border-slate-200 px-2 py-1 text-[10px] capitalize hover:bg-slate-50 disabled:opacity-40"
            >
              {action}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[10px] text-slate-500" data-testid="lab-control-status">
        {controlStatus}
      </p>

      {run.isLoading && <p className="mt-3 text-xs text-slate-500">Waiting for batch manifest…</p>}
      {run.isError && (
        <p className="mt-3 text-xs text-amber-700">
          The bridge accepted the run; its first durable manifest has not appeared yet.
        </p>
      )}
      {control.error && (
        <p role="alert" className="mt-3 text-xs text-red-700">
          Control request failed:{' '}
          {control.error instanceof Error ? control.error.message : String(control.error)}
        </p>
      )}
      {summary && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-6">
            <div>
              <span className="text-slate-400">Episodes</span>
              <br />
              <b>{formatNumber(summary.totals.episodes)}</b>
            </div>
            <div>
              <span className="text-slate-400">Pass</span>
              <br />
              <b className="text-emerald-700">{formatNumber(summary.totals.passed)}</b>
            </div>
            <div>
              <span className="text-slate-400">Fail</span>
              <br />
              <b className="text-red-700">{formatNumber(summary.totals.failedGrade)}</b>
            </div>
            <div>
              <span className="text-slate-400">Invalid</span>
              <br />
              <b>{formatNumber(summary.totals.invalidUserSim)}</b>
            </div>
            <div>
              <span className="text-slate-400">Pass rate</span>
              <br />
              <b>{formatPercent(summary.totals.passRate)}</b>
            </div>
            <div>
              <span className="text-slate-400">Cost</span>
              <br />
              <b>
                {summary.totals.costUsd === null ? '—' : `$${summary.totals.costUsd.toFixed(3)}`}
              </b>
            </div>
          </div>
          {summary.lineage && (
            <div className="mt-3 rounded bg-violet-50 px-3 py-2 text-xs text-violet-800">
              <b>{summary.lineage.relation ?? 'run ancestry'}</b> ·{' '}
              {summary.lineage.fidelity ?? 'fidelity unspecified'}
              <span className="mt-1 block">
                state exact: {String(summary.lineage.stateExact ?? false)} · config exact:{' '}
                {String(summary.lineage.configExact ?? false)} · LLM exact:{' '}
                {String(summary.lineage.llmExact ?? false)}
              </span>
            </div>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={`/ace?run=${encodeURIComponent(runId)}`}
          className="rounded border border-blue-200 px-2.5 py-1.5 text-xs text-blue-700 hover:bg-blue-50"
        >
          Open full run diagnosis
        </Link>
        {parentRunId && parentRunId !== runId && (
          <Link
            to={compareHref(parentRunId, runId, instanceId)}
            className="rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Compare parent run ↔ branch
          </Link>
        )}
        {siblings.map((sibling) => (
          <Link
            key={sibling.runId}
            to={compareHref(sibling.runId, runId, instanceId)}
            className="rounded border border-violet-200 px-2.5 py-1.5 text-xs text-violet-700 hover:bg-violet-50"
          >
            Compare with sibling {sibling.runId}
          </Link>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded border border-slate-200">
        <div className="flex items-center bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
          Durable live traces · {traceItems.length}
          <span className="ml-auto text-[10px] font-normal text-slate-400">
            refreshes after each completed message
          </span>
        </div>
        {traceItems.length === 0 ? (
          <p className="px-3 py-5 text-center text-xs text-slate-500">
            Waiting for the first durable message…
          </p>
        ) : (
          <div className="max-h-64 overflow-auto">
            {traceItems.map((trace) => {
              const uid = trace.meta.traceUid ?? trace.meta.traceId
              return (
                <Link
                  key={uid}
                  to={`/trace/${encodeURIComponent(uid)}`}
                  className="flex items-center gap-3 border-t border-slate-100 px-3 py-2 text-xs hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-blue-700">
                    {trace.meta.sourceTraceId ?? trace.meta.traceId}
                  </span>
                  <span>{trace.evaluation?.lifecycle.pendingPhase ?? trace.meta.status}</span>
                  <span>{trace.stats.turns} turns</span>
                  <span>{trace.stats.toolUses} tools</span>
                  <span>
                    {trace.stats.score === null
                      ? 'ungraded'
                      : trace.stats.score > 0
                        ? 'pass'
                        : 'fail'}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

const BOT_HINTS: Record<string, string> = {
  '': 'Runner default harness.',
  baseline: 'Plain policy prompt, no extra structure.',
  playbook: 'Policy prompt plus the support playbook guidance.',
  workflow: 'Structured workflow harness drives each turn.',
}

const PHASE_PILL_STYLE: Record<SessionPhaseKind, string> = {
  starting: 'bg-blue-50 text-blue-700',
  running: 'bg-blue-100 text-blue-800',
  grading: 'bg-violet-100 text-violet-800',
  complete: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
}

/** Episode session: bubbles from the run's single trace, then grade + actions. */
function EpisodeSession({
  runId,
  onChildRun,
}: {
  runId: string
  onChildRun: (id: string) => void
}) {
  // Poll the run summary through pre-manifest 404s (see LiveRunMonitor note);
  // the episode trace queries below relay in parallel, so leaving "starting"
  // never depends on the run index alone.
  const run = useAceRun(runId, {
    refetchInterval: (query) =>
      episodePollInterval({ lifecycle: query.state.data?.lifecycle }),
  })
  const control = useControlAceRun(runId)
  const lifecycle = run.data?.lifecycle
  const filters = useMemo(
    () => encodeFilterSet({ conditions: [{ key: 'run', op: 'eq', value: runId }] }),
    [runId],
  )
  // Active polling is the safety net under SSE: a starved event channel (dev
  // proxy restart, browser connection limit) must never freeze the session.
  // The list polls only until the episode's durable trace exists; from then on
  // the detail query below carries the live updates.
  const traces = useTraces(
    { filters, sort: 'timestamp', order: 'asc', limit: 5 },
    {
      refetchInterval: (query) => {
        const data = query.state.data
        const found = data !== undefined && 'items' in data && data.items.length > 0
        return found ? false : episodePollInterval({ lifecycle })
      },
    },
  )
  const items =
    traces.data && 'items' in traces.data ? (traces.data as TracesListResponse).items : []
  const episodeUid = items[0] ? (items[0].meta.traceUid ?? items[0].meta.traceId) : undefined
  const episode = useTrace(episodeUid, {
    refetchInterval: (query) =>
      episodePollInterval({ lifecycle, episodeSettled: episodeSettled(query.state.data) }),
  })

  const phase = sessionPhase(
    lifecycle,
    episode.data?.messages.length ?? 0,
    episode.data?.evaluation?.lifecycle.pendingPhase,
    episodeSettled(episode.data),
  )
  const stopDecision = run.data
    ? aceRunControlDecision(run.data, 'cancel', control.isPending)
    : { allowed: false, reason: 'Waiting for the run manifest before Stop is possible.' }
  // The actual runner/provider message for a runtime error — nobody should
  // have to open batch.json to learn why an episode died.
  const runtimeError = runtimeErrorSummary(run.data?.lifecycleError, episode.data)

  return (
    <div className="space-y-3" data-testid="playground-session">
      <div
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
        data-testid="playground-session-status"
      >
        {phase.active && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
        )}
        <span
          className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${PHASE_PILL_STYLE[phase.kind]}`}
          data-testid="playground-session-phase"
        >
          {phase.label}
        </span>
        {phase.active && (
          <button
            type="button"
            data-testid="playground-stop"
            onClick={() => control.mutate('cancel')}
            disabled={!stopDecision.allowed}
            title={stopDecision.reason}
            className="ml-auto rounded-md border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
          >
            {control.isPending ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>
      {runtimeError && (
        <p
          className="whitespace-pre-wrap break-words rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
          data-testid="playground-runtime-error"
        >
          {runtimeError}
        </p>
      )}
      {episode.data ? (
        <>
          <EpisodeConversation trace={episode.data} />
          <EpisodeResultCard trace={episode.data} costUsd={run.data?.totals.costUsd} />
          <PlaygroundActions trace={episode.data} onChildRun={onChildRun} />
        </>
      ) : (
        <p className="rounded-md bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          {run.data?.lifecycle === 'failed'
            ? 'The run failed before producing a durable trace.'
            : 'Waiting for the first durable message…'}
        </p>
      )}
    </div>
  )
}

function PlaygroundWorkbench({
  sourceTrace,
  requestedTraceUid,
  selectedRunId,
  initialConfig,
  autorunRequested = false,
  onAutorunConsumed,
  onRunSelected,
}: {
  sourceTrace?: Trace
  requestedTraceUid?: string
  selectedRunId?: string
  initialConfig: PlaygroundRunConfig
  /** `?autorun=1` deep link: start the prefilled run once after mount. */
  autorunRequested?: boolean
  /** Strips autorun from the URL so a reload can never re-trigger it. */
  onAutorunConsumed?: () => void
  onRunSelected: (runId: string) => void
}) {
  const sourceIsSimulation = sourceTrace?.meta.corpusId === 'simulation'
  const recordedSeed = sourceTrace ? traceEnvironmentSeed(sourceTrace) : undefined

  const capabilities = useAceCapabilities()
  const scenarios = useAceScenarios()
  const tasks = useAceTasks({})
  const start = useStartAceRun()

  const [config, setConfig] = useState<PlaygroundRunConfig>(initialConfig)
  const [validationError, setValidationError] = useState<string | null>(null)

  const packFiles = (scenarios.data?.items ?? []).map((pack) => pack.file)
  const packScenarios = useMemo(() => {
    const base = config.scenarioFile.split('/').at(-1)
    return (tasks.data?.items ?? []).filter((task) =>
      task.sourceFiles.some((file) => file.split('/').at(-1) === base),
    )
  }, [tasks.data?.items, config.scenarioFile])

  // A trace deep link prefills the scenario id without its pack file. Correct
  // the pack from the task catalog once it loads, or a Replicate of any
  // non-default-pack scenario would POST an unknown scenarioFile/Id pair.
  const scenarioPackFix = resolveScenarioPack(
    config.scenarioId,
    config.scenarioFile,
    tasks.data?.items ?? [],
  )
  useEffect(() => {
    if (scenarioPackFix !== undefined) {
      setConfig((current) => ({ ...current, scenarioFile: scenarioPackFix }))
    }
  }, [scenarioPackFix])

  // Matched fresh rerun lineage only when scenario+seed still equal the recorded ones.
  const sourceTraceUidForRun =
    requestedTraceUid &&
    sourceIsSimulation &&
    recordedSeed !== undefined &&
    config.scenarioId === sourceTrace?.meta.instanceId &&
    config.seed.trim() === String(recordedSeed)
      ? requestedTraceUid
      : undefined

  const available = capabilities.data?.available === true
  const setField = <Key extends keyof PlaygroundRunConfig>(
    key: Key,
    value: PlaygroundRunConfig[Key],
  ) => {
    setConfig((current) => ({ ...current, [key]: value }))
    setValidationError(null)
  }

  // Same double-submit + idempotent-batchId discipline as the batch launcher:
  // the id persists in sessionStorage so a remount (e.g. source-trace change
  // mid-retry) cannot mint a fresh id and start a second paid episode.
  const submitInFlight = useRef(false)
  const pendingBatchIdKey = `ace-playground-pending-batch:${requestedTraceUid ?? 'blank'}`
  const pendingBatchIdFallback = useRef<string | null>(null)
  const takePendingBatchId = (): string => {
    let stored: string | null = null
    try {
      stored = window.sessionStorage.getItem(pendingBatchIdKey)
    } catch {
      stored = pendingBatchIdFallback.current
    }
    const batchId = stored ?? `viewer-${crypto.randomUUID()}`
    pendingBatchIdFallback.current = batchId
    try {
      window.sessionStorage.setItem(pendingBatchIdKey, batchId)
    } catch {
      // sessionStorage unavailable: the in-memory fallback still guards retries.
    }
    return batchId
  }
  const clearPendingBatchId = () => {
    pendingBatchIdFallback.current = null
    try {
      window.sessionStorage.removeItem(pendingBatchIdKey)
    } catch {
      // Already cleared in memory.
    }
  }
  const runEpisode = async (override?: PlaygroundRunConfig) => {
    if (!available || submitInFlight.current) return
    const effective = override ?? config
    const result = buildPlaygroundRunRequest({
      ...effective,
      ...(sourceTraceUidForRun ? { sourceTraceUid: sourceTraceUidForRun } : {}),
    })
    if (!result.ok) {
      setValidationError(result.error)
      return
    }
    submitInFlight.current = true
    const batchId = takePendingBatchId()
    try {
      const response = await start.mutateAsync({ ...result.request, batchId })
      clearPendingBatchId()
      onRunSelected(response.runId)
    } catch (error) {
      // The persisted batchId makes retries idempotent: if this rejection says
      // the batch already exists, the earlier POST (whose response was lost —
      // e.g. a wedged proxy socket) did start the run. Attach to it instead of
      // leaving the tab permanently poisoned with an unusable pending id.
      if (isExistingRunConflict(error)) {
        clearPendingBatchId()
        onRunSelected(batchId)
        start.reset()
      }
      // Other errors stay visible below the button via React Query.
    } finally {
      submitInFlight.current = false
    }
  }

  // Autorun evaluates exactly once per mount, as soon as the bridge capability
  // is known. The guard ref survives StrictMode's double effect, the URL param
  // is stripped immediately (a reload never re-runs), and runEpisode's own
  // in-flight + persisted-batchId idempotency backstops everything else.
  const autorunFired = useRef(false)
  const capabilitiesKnown = !capabilities.isLoading
  // Hold autorun until the scenario's pack is authoritative: the task catalog
  // has loaded (or failed — then the server rejection stays visible) and any
  // pending pack correction from the effect above has been applied.
  const scenarioPackSettled = tasks.isError || (!tasks.isLoading && scenarioPackFix === undefined)
  useEffect(() => {
    if (!autorunRequested || autorunFired.current || !capabilitiesKnown) return
    if (!scenarioPackSettled) return
    autorunFired.current = true
    onAutorunConsumed?.()
    if (
      shouldAutorun({
        requested: autorunRequested,
        alreadyFired: false,
        capabilitiesKnown,
        bridgeAvailable: available,
        scenarioId: config.scenarioId,
        seed: config.seed,
        selectedRunId,
      })
    ) {
      void runEpisode()
    }
  })

  // One primary CTA whose semantics follow the config: with no scenario picked
  // it is a zero-config Quick run (first scenario of the current/default pack,
  // seed 1); with a scenario it is the plain Run episode.
  const quick = quickRunSelection(
    scenarios.data?.items ?? [],
    tasks.data?.items ?? [],
    config.scenarioFile,
  )
  const needsQuickPick = config.scenarioId.trim() === ''
  const sessionRef = useRef<HTMLElement | null>(null)
  const launchEpisode = () => {
    if (needsQuickPick) {
      if (!quick) return
      const merged: PlaygroundRunConfig = {
        ...config,
        scenarioFile: quick.scenarioFile,
        scenarioId: quick.scenarioId,
        ...(config.seed.trim() === '' ? { seed: quick.seed } : {}),
      }
      setConfig(merged)
      void runEpisode(merged)
    } else {
      void runEpisode()
    }
    sessionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold text-slate-900">Playground</h1>
          <p className="text-xs text-slate-500">
            Interactive experiments against the real simulated world: one episode at a time — full
            harness, tools, grading. Batches live in Runs → New run.
          </p>
          <span
            className={`ml-auto rounded px-2 py-1 text-[10px] font-medium ${
              available ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {available
              ? 'ACE bridge ready'
              : capabilities.isLoading
                ? 'Checking bridge…'
                : (capabilities.data?.message ?? 'Bridge unavailable')}
          </span>
        </header>

        {sourceTrace && (
          <section className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
            <div className="flex flex-wrap items-center gap-2">
              <b>Source trace</b>
              <Link
                to={`/trace/${encodeURIComponent(sourceTrace.meta.traceUid ?? sourceTrace.meta.traceId)}`}
                className="font-mono text-blue-700 hover:underline"
              >
                {sourceTrace.meta.sourceTraceId ?? sourceTrace.meta.traceId}
              </Link>
              <span>task {sourceTrace.meta.instanceId}</span>
              <span>run {sourceTrace.meta.runId ?? 'unknown'}</span>
              <span>seed {recordedSeed ?? 'unavailable'}</span>
              {sourceTraceUidForRun && (
                <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">
                  matched fresh rerun · lineage recorded
                </span>
              )}
            </div>
            {!sourceIsSimulation && (
              <p className="mt-2 text-amber-700">
                Production traces have no task-grade scenario contract. Save this trace as a
                runnable regression scenario first (trace → Rerun &amp; Fork tab).
              </p>
            )}
            {sourceIsSimulation && recordedSeed === undefined && (
              <p className="mt-2 text-amber-700">
                This trace did not record an environment seed, so matched trace ancestry is disabled
                instead of guessing one.
              </p>
            )}
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* Left: configuration panel */}
          <section
            className="space-y-3 self-start rounded-lg border border-slate-200 bg-white p-4"
            data-testid="playground-config"
          >
            <h2 className="text-sm font-semibold text-slate-800">Configuration</h2>

            <label className="block text-xs text-slate-600">
              Prompt preset
              <select
                className={INPUT}
                data-testid="playground-prompt-preset"
                value={config.promptPreset}
                onChange={(event) => setField('promptPreset', event.target.value)}
              >
                <option>baseline</option>
                <option>improved</option>
                <option>optimized</option>
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              Custom prompt (optional)
              <textarea
                rows={6}
                className={INPUT}
                data-testid="playground-prompt-text"
                value={config.promptText}
                onChange={(event) => setField('promptText', event.target.value)}
                placeholder="Paste a full assistant policy prompt; overrides the preset."
              />
              <span className="mt-0.5 block text-[10px] text-slate-400">
                Editing the prompt makes this a counterfactual run — formal metrics stay clean.
              </span>
            </label>

            <label className="block text-xs text-slate-600">
              Bot harness
              <select
                className={INPUT}
                data-testid="playground-bot"
                value={config.bot}
                onChange={(event) =>
                  setField('bot', event.target.value as PlaygroundRunConfig['bot'])
                }
              >
                <option value="">Runner default</option>
                <option value="baseline">Baseline</option>
                <option value="playbook">Playbook</option>
                <option value="workflow">Workflow</option>
              </select>
              <span className="mt-0.5 block text-[10px] text-slate-400">
                {BOT_HINTS[config.bot] ?? BOT_HINTS['']}
              </span>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600">
                Model
                <input
                  className={INPUT}
                  value={config.model}
                  onChange={(event) => setField('model', event.target.value)}
                  placeholder="Runner default"
                />
              </label>
              <label className="text-xs text-slate-600">
                Temperature
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  className={INPUT}
                  value={config.temperature}
                  onChange={(event) => setField('temperature', event.target.value)}
                />
              </label>
            </div>
            <label className="block text-xs text-slate-600">
              Reasoning effort
              <select
                className={INPUT}
                value={config.reasoningEffort}
                onChange={(event) =>
                  setField(
                    'reasoningEffort',
                    event.target.value as PlaygroundRunConfig['reasoningEffort'],
                  )
                }
              >
                <option value="">Runner default</option>
                <option value="none">None</option>
                <option value="minimal">Minimal</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">XHigh</option>
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              Transport
              <select
                className={INPUT}
                data-testid="playground-transport"
                value={config.transport}
                onChange={(event) =>
                  setField('transport', event.target.value as PlaygroundRunConfig['transport'])
                }
              >
                <option value="responses">Responses (canonical)</option>
                <option value="chat">Chat completions</option>
              </select>
              <span className="mt-0.5 block text-[10px] text-slate-400">
                All formal batches run Responses. Chat supports function tools only with reasoning
                effort none.
              </span>
            </label>

            <label className="block text-xs text-slate-600">
              Scenario pack
              <select
                className={INPUT}
                data-testid="playground-scenario-pack"
                value={config.scenarioFile}
                onChange={(event) => setField('scenarioFile', event.target.value)}
              >
                {!packFiles.includes(config.scenarioFile) && (
                  <option value={config.scenarioFile}>{config.scenarioFile}</option>
                )}
                {(scenarios.data?.items ?? []).map((pack) => (
                  <option key={pack.file} value={pack.file}>
                    {pack.file} ({pack.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              Scenario
              <select
                className={INPUT}
                data-testid="playground-scenario-id"
                value={config.scenarioId}
                onChange={(event) => setField('scenarioId', event.target.value)}
              >
                <option value="">Auto — Quick run picks the first scenario</option>
                {config.scenarioId !== '' &&
                  !packScenarios.some((task) => task.scenarioId === config.scenarioId) && (
                    <option value={config.scenarioId}>{config.scenarioId}</option>
                  )}
                {packScenarios.map((task) => (
                  <option key={task.scenarioId} value={task.scenarioId}>
                    {task.scenarioId}
                    {task.issue ? ` · ${task.issue}` : ''}
                  </option>
                ))}
              </select>
              <span className="mt-0.5 block text-[10px] text-slate-400">
                One scenario × one seed; the full ACE harness (world, tools, user simulator, grader)
                runs fresh.
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600">
                Seed
                <input
                  type="number"
                  min="0"
                  className={INPUT}
                  data-testid="playground-seed"
                  value={config.seed}
                  onChange={(event) => setField('seed', event.target.value)}
                />
              </label>
              <label className="text-xs text-slate-600">
                Cost cap (USD)
                <input
                  type="number"
                  min="0.01"
                  step="0.25"
                  className={INPUT}
                  value={config.costCap}
                  onChange={(event) => setField('costCap', event.target.value)}
                />
              </label>
            </div>
          </section>

          {/* Right: session area */}
          <section ref={sessionRef} className="min-w-0 space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
              <button
                type="button"
                data-testid="playground-run-episode"
                onClick={launchEpisode}
                disabled={!available || start.isPending || (needsQuickPick && !quick)}
                className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
              >
                {start.isPending ? 'Starting…' : needsQuickPick ? 'Quick run' : 'Run episode'}
              </button>
              <span className="text-[11px] text-slate-500">
                {needsQuickPick
                  ? quick
                    ? `Auto-picks ${quick.scenarioId} from ${quick.scenarioFile} · seed ${quick.seed} — everything stays editable on the left.`
                    : 'Loading the scenario catalog…'
                  : config.promptText.trim()
                    ? 'Counterfactual run (custom prompt) · excluded from formal metrics.'
                    : 'Debug run · excluded from formal metrics.'}
              </span>
            </div>
            {validationError && (
              <p role="alert" className="text-xs text-red-600">
                {validationError}
              </p>
            )}
            {start.error && !validationError && (
              <p role="alert" className="text-xs text-red-600">
                {start.error instanceof Error ? start.error.message : 'Run could not start'}
              </p>
            )}

            {selectedRunId ? (
              <EpisodeSession runId={selectedRunId} onChildRun={onRunSelected} />
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-xs text-slate-400">
                Pick a scenario or just hit Quick run — messages stream in as the episode executes.
              </p>
            )}

            {selectedRunId && (
              <LiveRunMonitor
                runId={selectedRunId}
                sourceTrace={sourceTrace}
                instanceId={config.scenarioId || (sourceTrace?.meta.instanceId ?? '')}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export default function AceInteractiveLabPage() {
  const [search, setSearch] = useSearchParams()
  const requestedTraceUid = search.get('trace')?.trim() || undefined
  const selectedRunId = search.get('run')?.trim() || undefined
  const autorunRequested = search.get('autorun') === '1'
  const trace = useTrace(requestedTraceUid)
  const sourceTrace = trace.data

  if (requestedTraceUid && trace.isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <LoadingState label="Loading source trace…" />
      </div>
    )
  }
  if (requestedTraceUid && (trace.isError || !sourceTrace)) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <ErrorState message="The source trace could not be resolved. No run was started." />
      </div>
    )
  }

  const onRunSelected = (runId: string) => {
    const next = new URLSearchParams(search)
    next.set('run', runId)
    // Belt and braces: a URL that names a live run must never still say
    // autorun — copying or reloading it would start a second paid episode.
    next.delete('autorun')
    setSearch(next)
  }

  const onAutorunConsumed = () => {
    const next = new URLSearchParams(search)
    next.delete('autorun')
    setSearch(next, { replace: true })
  }

  return (
    <PlaygroundWorkbench
      // Keyed remount: the config panel re-derives from a new source trace.
      key={requestedTraceUid ?? 'blank'}
      sourceTrace={sourceTrace}
      requestedTraceUid={requestedTraceUid}
      selectedRunId={selectedRunId}
      initialConfig={initialPlaygroundConfig(
        {
          scenarioFile: search.get('scenarioFile') ?? undefined,
          scenarioId: search.get('scenarioId') ?? undefined,
          seed: search.get('seed') ?? undefined,
        },
        sourceTrace,
      )}
      autorunRequested={autorunRequested}
      onAutorunConsumed={onAutorunConsumed}
      onRunSelected={onRunSelected}
    />
  )
}
