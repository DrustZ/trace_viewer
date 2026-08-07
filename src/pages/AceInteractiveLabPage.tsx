import { encodeFilterSet } from '@shared/filter/parse'
import type { AceBatchSummary } from '@shared/schema/ace'
import { ACE_RUN_CONTROL_ACTIONS, aceRunControlDecision } from '@shared/schema/aceRunControl'
import type { TracesListResponse } from '@shared/schema/api'
import type { Trace } from '@shared/schema/types'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAceCheckpoints, useAceRun, useAceRuns, useControlAceRun } from '../api/ace'
import { useAceTask } from '../api/aceTasks'
import { useTrace, useTraces } from '../api/hooks'
import { AceRunLauncher } from '../components/ace/AceRunLauncher'
import {
  taskScenarioFiles,
  traceEnvironmentSeed,
  traceRunFormOverrides,
  traceRunRecordedConfig,
} from '../components/ace/interactiveLab'
import { ErrorState, LoadingState } from '../components/common/EmptyState'
import { formatNumber, formatPercent } from '../components/common/format'

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
  const run = useAceRun(runId)
  const runs = useAceRuns()
  const control = useControlAceRun(runId)
  const filters = useMemo(
    () => encodeFilterSet({ conditions: [{ key: 'run', op: 'eq', value: runId }] }),
    [runId],
  )
  const traces = useTraces({ filters, sort: 'timestamp', order: 'desc', limit: 50 })
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

export default function AceInteractiveLabPage() {
  const [search, setSearch] = useSearchParams()
  const requestedTraceUid = search.get('trace')?.trim() || undefined
  const selectedRunId = search.get('run')?.trim() || undefined
  const trace = useTrace(requestedTraceUid)
  const sourceTrace = trace.data
  const scenarioId = sourceTrace?.meta.instanceId ?? search.get('scenarioId')?.trim() ?? ''
  const task = useAceTask(scenarioId || undefined)
  const scenarioFiles = taskScenarioFiles(task.data)
  const requestedScenarioFile = search.get('scenarioFile')?.trim()
  const scenarioFile =
    requestedScenarioFile && scenarioFiles.includes(requestedScenarioFile)
      ? requestedScenarioFile
      : scenarioFiles[0]
  const recordedSeed = sourceTrace ? traceEnvironmentSeed(sourceTrace) : undefined
  const rawRequestedSeed = search.get('seed')
  const requestedSeed = rawRequestedSeed === null ? Number.NaN : Number(rawRequestedSeed)
  const seed =
    recordedSeed ?? (Number.isSafeInteger(requestedSeed) && requestedSeed >= 0 ? requestedSeed : 1)
  const checkpoints = useAceCheckpoints(requestedTraceUid)
  const sourceIsSimulation = sourceTrace?.meta.corpusId === 'simulation'
  const sourceInitialValues =
    sourceTrace && sourceIsSimulation ? traceRunFormOverrides(sourceTrace) : undefined
  const sourceRecordedConfig =
    sourceTrace && sourceIsSimulation ? traceRunRecordedConfig(sourceTrace) : undefined
  const traceBranchReady = Boolean(
    requestedTraceUid && sourceIsSimulation && scenarioFile && recordedSeed !== undefined,
  )
  const checkpointBranchable = Boolean(
    checkpoints.data?.available &&
      checkpoints.data.forkAvailable &&
      checkpoints.data.checkpoints.some((checkpoint) => checkpoint.branchable),
  )

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

  const updateRun = (runId: string) => {
    const next = new URLSearchParams(search)
    next.set('run', runId)
    setSearch(next)
  }

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <Link to="/" className="text-xs text-blue-600 hover:underline">
            ← Traces
          </Link>
          <Link to="/ace" className="text-xs text-blue-600 hover:underline">
            ACE runs
          </Link>
          <Link to="/ace/experiments" className="text-xs text-blue-600 hover:underline">
            A/B matrix
          </Link>
          <h1 className="text-base font-semibold text-slate-900">ACE Interactive Lab</h1>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <b>Fresh task rerun · full ACE harness</b>
            <p className="mt-1 text-blue-700">
              Runs models, bot harness, tools, grader, faults, and optional evaluators from a fresh
              world. This is the configurable path below.
            </p>
          </div>
          <div
            className={`rounded-lg border p-3 text-xs ${checkpointBranchable ? 'border-violet-200 bg-violet-50 text-violet-900' : 'border-slate-200 bg-slate-100 text-slate-500'}`}
          >
            <b>Checkpoint fork · restored prefix/state</b>
            <p className="mt-1">
              Exact/counterfactual continuation is available only at recorded safe boundaries with
              scenario and config snapshots.
            </p>
            {sourceTrace && (
              <Link
                to={`/trace/${encodeURIComponent(sourceTrace.meta.traceUid ?? sourceTrace.meta.traceId)}?tab=replay`}
                className={`mt-2 inline-block underline ${checkpointBranchable ? 'text-violet-700' : 'pointer-events-none text-slate-400'}`}
              >
                {checkpointBranchable
                  ? 'Open checkpoint fork controls'
                  : `Unavailable: ${(checkpoints.data?.missing ?? ['no branchable checkpoint']).join(', ')}`}
              </Link>
            )}
          </div>
          <div
            className={`rounded-lg border p-3 text-xs ${sourceTrace ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-100 text-slate-500'}`}
          >
            <b>LLM-only continuation · no ACE execution</b>
            <p className="mt-1">
              Sends a transcript prefix to a stand-in model. It does not restore DB/RNG, execute
              tools, run the user simulator, or grade a task.
            </p>
            {sourceTrace && (
              <Link
                to={`/trace/${encodeURIComponent(sourceTrace.meta.traceUid ?? sourceTrace.meta.traceId)}?tab=playground`}
                className="mt-2 inline-block text-amber-700 underline"
              >
                Open LLM-only continuation
              </Link>
            )}
          </div>
        </section>

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
              <span>task {scenarioId}</span>
              <span>run {sourceTrace.meta.runId ?? 'unknown'}</span>
              <span>seed {recordedSeed ?? 'unavailable'}</span>
            </div>
            {!sourceIsSimulation && (
              <p className="mt-2 text-amber-700">
                Production traces have no task-grade scenario contract. Save this trace as a
                runnable regression scenario before a fresh ACE rerun.
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

        {task.isLoading ? (
          <LoadingState label="Resolving authoritative task definition…" />
        ) : !scenarioId || task.isError || !task.data || !scenarioFile ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
            <b>Fresh task rerun unavailable.</b> Open the lab from a simulation trace or task
            definition with an authoritative <code>configs/scenarios/*.json</code> source. No run
            has been started.
          </section>
        ) : (
          <>
            {scenarioFiles.length > 1 && (
              <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
                This task ID has definitions in multiple packs ({scenarioFiles.join(', ')}). Review
                the task conflict and explicitly choose the intended pack below.
              </p>
            )}
            <AceRunLauncher
              key={`${requestedTraceUid ?? 'task'}:${scenarioFile}:${scenarioId}:${seed}`}
              title="Interactive task configuration"
              initialValues={sourceInitialValues}
              recordedConfig={sourceRecordedConfig}
              initialScenarioFile={scenarioFile}
              initialScenarioId={scenarioId}
              initialSeed={seed}
              initialRunKind="debug"
              sourceTraceUid={traceBranchReady ? requestedTraceUid : undefined}
              onStarted={updateRun}
            />
          </>
        )}

        {selectedRunId && (
          <LiveRunMonitor runId={selectedRunId} sourceTrace={sourceTrace} instanceId={scenarioId} />
        )}
      </div>
    </div>
  )
}
