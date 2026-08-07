import type { AceCheckpointResponse, AceReplayRequest } from '@shared/schema/ace'
import type { Trace } from '@shared/schema/types'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAceCheckpoints,
  useAceRegressionCapability,
  useAceReplay,
  useSaveAceRegression,
} from '../../api/ace'
import { EmptyState, LoadingState } from '../common/EmptyState'

const INPUT =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function replayTraceUid(trace: Trace): string {
  return trace.meta.traceUid ?? trace.meta.traceId
}

export function historicalReplayRequest(trace: Trace): AceReplayRequest {
  return { sourceTraceUid: replayTraceUid(trace), mode: 'historical_tools' }
}

export function historicalReplayUnavailableMessage(
  capability: AceCheckpointResponse,
): string | null {
  if (capability.historicalReplayAvailable) return null
  return 'Historical replay is unavailable: no compatible source trace and tool ledger were found.'
}

export function ReplayTab({ trace }: { trace: Trace }) {
  const traceUid = replayTraceUid(trace)
  const checkpoints = useAceCheckpoints(traceUid)
  const replay = useAceReplay()
  const regressionCapability = useAceRegressionCapability(traceUid)
  const saveRegression = useSaveAceRegression()
  const rows = checkpoints.data?.checkpoints ?? []
  const [checkpointId, setCheckpointId] = useState<number | undefined>()
  const [costCap, setCostCap] = useState('2')
  const [requestedChildRunId, setRequestedChildRunId] = useState('')
  const [nextUserMessage, setNextUserMessage] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState('')
  const [regressionId, setRegressionId] = useState('')
  const [boundaryMessageId, setBoundaryMessageId] = useState('')

  useEffect(() => {
    if (checkpointId !== undefined || rows.length === 0) return
    const branchable = [...rows].reverse().find((row) => row.branchable)
    setCheckpointId((branchable ?? rows[rows.length - 1])?.id)
  }, [checkpointId, rows])

  const selected = useMemo(() => rows.find((row) => row.id === checkpointId), [rows, checkpointId])
  const missing = checkpoints.data?.missing ?? []
  const result = record(replay.data)
  const bridgeResult = record(result.result)
  const resultChildRunId =
    typeof bridgeResult.child_run_id === 'string' ? bridgeResult.child_run_id : undefined
  const orderedMessages = useMemo(
    () =>
      trace.messages
        .map((message, position) => ({
          message,
          position,
          chronologicalIndex: message.chronologicalIndex ?? position,
          rawIndex: message.rawIndex ?? position,
        }))
        .sort(
          (left, right) =>
            left.chronologicalIndex - right.chronologicalIndex || left.position - right.position,
        ),
    [trace.messages],
  )

  const historical = () => replay.mutate(historicalReplayRequest(trace))
  const restore = () => replay.mutate({ sourceTraceUid: traceUid, mode: 'restore', checkpointId })
  const fork = (mode: 'exact' | 'counterfactual') => {
    replay.mutate({
      sourceTraceUid: traceUid,
      mode,
      checkpointId,
      costCapUsd: Number(costCap),
      ...(requestedChildRunId.trim() ? { childRunId: requestedChildRunId.trim() } : {}),
      ...(mode === 'counterfactual' && nextUserMessage.trim()
        ? { nextUserMessage: nextUserMessage.trim() }
        : {}),
      ...(mode === 'counterfactual' && prompt.trim() ? { prompt: prompt.trim() } : {}),
      ...(mode === 'counterfactual' && model.trim() ? { model: model.trim() } : {}),
      ...(mode === 'counterfactual' && temperature !== ''
        ? { temperature: Number(temperature) }
        : {}),
    })
  }
  const saveAsRegression = () => {
    saveRegression.mutate({
      sourceTraceUid: traceUid,
      ...(boundaryMessageId ? { boundaryMessageId } : {}),
      ...(regressionId.trim() ? { regressionId: regressionId.trim() } : {}),
    })
  }

  if (checkpoints.isLoading) return <LoadingState label="Inspecting replay capabilities…" />
  if (checkpoints.isError || !checkpoints.data) {
    return (
      <EmptyState
        title="Replay capability unavailable"
        hint="The source trace could not be inspected. No replay or fork was started."
      />
    )
  }

  const historicalUnavailable = historicalReplayUnavailableMessage(checkpoints.data)

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Historical tool replay</h2>
        <p className="mt-1 text-xs text-slate-500">
          Replays informative tool reads/writes against the current ACE world. This is compatibility
          evidence, not an exact LLM replay.
        </p>
        <button
          type="button"
          data-testid="historical-tool-replay"
          onClick={historical}
          disabled={!checkpoints.data.historicalReplayAvailable || replay.isPending}
          className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Run historical tool replay
        </button>
        {historicalUnavailable && (
          <p data-testid="historical-replay-unavailable" className="mt-2 text-xs text-amber-700">
            {historicalUnavailable}
          </p>
        )}
        {bridgeResult.fidelity === 'historical_tool_replay' && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div>
              Informative
              <br />
              <b>{String(bridgeResult.informative ?? 0)}</b>
            </div>
            <div>
              Matches
              <br />
              <b>{String(bridgeResult.informative_matches ?? 0)}</b>
            </div>
            <div>
              Orphans skipped
              <br />
              <b>{String(bridgeResult.skipped_orphans ?? 0)}</b>
            </div>
            <div>
              Fidelity
              <br />
              <b>tool-only</b>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">State-exact checkpoint restore</h2>
        <p className="mt-1 text-xs text-slate-500">
          Restores the recorded prefix, DB, RNG, ledger, and component state without calling a model
          or tool.
        </p>
        {!checkpoints.data.available ? (
          <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Unavailable: {missing.join(', ') || 'checkpoint archive was not recorded'}.
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-600">
              Safe boundary
              <select
                className={INPUT}
                value={checkpointId ?? ''}
                onChange={(event) => setCheckpointId(Number(event.target.value))}
              >
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    #{row.id} · {row.phase} · {row.message_count ?? '?'} messages
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={restore}
              disabled={checkpointId === undefined || replay.isPending}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              Restore snapshot (no execution)
            </button>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Immutable checkpoint fork</h2>
        <p className="mt-1 text-xs text-slate-500">
          The original archive is never modified. Exact keeps configuration fixed; counterfactual
          restores exact environment/tool state but marks future generation nondeterministic.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-slate-600">
            Child run ID (optional)
            <input
              className={INPUT}
              value={requestedChildRunId}
              onChange={(event) => setRequestedChildRunId(event.target.value)}
              placeholder="generated automatically"
            />
          </label>
          <label className="text-xs text-slate-600">
            Cost cap (USD)
            <input
              type="number"
              min="0.01"
              step="0.25"
              className={INPUT}
              value={costCap}
              onChange={(event) => setCostCap(event.target.value)}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => fork('exact')}
              disabled={!selected?.branchable || replay.isPending}
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
            >
              Fork exact config
            </button>
          </div>
          <label className="text-xs text-slate-600 sm:col-span-2">
            Replace next user message
            <textarea
              rows={2}
              className={INPUT}
              value={nextUserMessage}
              onChange={(event) => setNextUserMessage(event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-600">
            Model override
            <input
              className={INPUT}
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-600 sm:col-span-2">
            Prompt override
            <textarea
              rows={3}
              className={INPUT}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
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
              value={temperature}
              onChange={(event) => setTemperature(event.target.value)}
              placeholder="unchanged"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => fork('counterfactual')}
          disabled={
            !selected?.counterfactual_branchable ||
            replay.isPending ||
            ![nextUserMessage, prompt, model, temperature].some((value) => value.trim() !== '')
          }
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 disabled:opacity-40"
        >
          Fork counterfactual · policy changed
        </button>
        {selected?.capability_error && (
          <p className="mt-2 text-xs text-amber-700">{selected.capability_error}</p>
        )}
        {trace.meta.corpusId === 'simulation' && (
          <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
            Different bot harness, transport, user simulator, fault physics, or evaluators require a{' '}
            <b>fresh task rerun</b>, not a checkpoint fork.
            <Link
              to={`/ace/lab?${new URLSearchParams({ trace: traceUid }).toString()}`}
              className="ml-2 font-medium underline"
            >
              Configure in Interactive Lab
            </Link>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Save as regression scenario</h2>
        <p className="mt-1 text-xs text-slate-500">
          Saves an immutable, user-readable artifact under ACE <code>runs/regressions</code>. This
          does not call a model or tool, modify the source trace, or edit canonical scenario packs.
        </p>
        {regressionCapability.isLoading ? (
          <p className="mt-3 text-xs text-slate-500">Inspecting regression capability…</p>
        ) : regressionCapability.data ? (
          <>
            <div
              className={`mt-3 rounded-md px-3 py-2 text-xs ${
                regressionCapability.data.scenarioSnapshotAvailable
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'bg-amber-50 text-amber-800'
              }`}
            >
              <b>
                {regressionCapability.data.expectedArtifactKind === 'runnable_scenario_pack'
                  ? 'Runnable scenario rerun'
                  : 'Non-runnable regression draft'}
              </b>
              <span className="mt-0.5 block">{regressionCapability.data.explanation}</span>
              {!regressionCapability.data.available && (
                <span className="mt-1 block">
                  Unavailable: {regressionCapability.data.missing.join(', ')}
                </span>
              )}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-600">
                Transcript boundary (inclusive)
                <select
                  className={INPUT}
                  value={boundaryMessageId}
                  onChange={(event) => setBoundaryMessageId(event.target.value)}
                >
                  <option value="">Full trace · {orderedMessages.length} messages</option>
                  {orderedMessages.map(({ message, chronologicalIndex, rawIndex }) => (
                    <option key={message.id} value={message.id}>
                      chrono {chronologicalIndex} · raw {rawIndex} · {message.role} ·{' '}
                      {message.content.replace(/\s+/g, ' ').slice(0, 64) || '(empty)'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Immutable regression ID (optional)
                <input
                  className={INPUT}
                  value={regressionId}
                  onChange={(event) => setRegressionId(event.target.value)}
                  placeholder="content-derived ID"
                />
              </label>
            </div>
            <button
              type="button"
              data-testid="save-regression"
              onClick={saveAsRegression}
              disabled={!regressionCapability.data.available || saveRegression.isPending}
              className="mt-3 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800 disabled:opacity-40"
            >
              {saveRegression.isPending ? 'Saving immutable artifact…' : 'Save regression artifact'}
            </button>
          </>
        ) : (
          <p className="mt-3 text-xs text-red-700">Regression capability could not be inspected.</p>
        )}
        {saveRegression.error && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {saveRegression.error instanceof Error
              ? saveRegression.error.message
              : 'Regression save failed'}
          </p>
        )}
        {saveRegression.data && (
          <div className="mt-3 rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700">
            <b>
              {saveRegression.data.runnable
                ? 'Runnable scenario pack saved'
                : 'Regression draft saved'}
              {saveRegression.data.deduplicated ? ' · existing identical artifact reused' : ''}
            </b>
            <span className="mt-1 block font-mono">ACE runs/{saveRegression.data.artifact}</span>
            {saveRegression.data.runnable && (
              <Link
                to={`/ace?${new URLSearchParams({
                  scenarioFile: `regression:${saveRegression.data.regressionId}`,
                }).toString()}`}
                className="mt-2 inline-block rounded border border-blue-200 px-2.5 py-1.5 font-medium text-blue-700 hover:bg-blue-50"
              >
                Configure a run from this regression
              </Link>
            )}
            {!saveRegression.data.runnable &&
              saveRegression.data.missingRequiredFields.length > 0 && (
                <span className="mt-1 block text-amber-700">
                  Required before runnable: {saveRegression.data.missingRequiredFields.join(', ')}
                </span>
              )}
          </div>
        )}
      </section>

      {replay.isPending && <p className="text-xs text-slate-500">Replay operation running…</p>}
      {replay.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {replay.error instanceof Error ? replay.error.message : 'Replay failed'}
        </p>
      )}
      {replay.data && bridgeResult.fidelity !== 'historical_tool_replay' && (
        <section className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-slate-700">Replay result</h3>
            {resultChildRunId && (
              <>
                <Link
                  to={`/ace?run=${encodeURIComponent(resultChildRunId)}`}
                  className="rounded bg-blue-600 px-2.5 py-1.5 font-medium text-white hover:bg-blue-700"
                >
                  Open child run
                </Link>
                {trace.meta.runId && (
                  <Link
                    to={`/compare?${new URLSearchParams({
                      runA: trace.meta.runId,
                      runB: resultChildRunId,
                      instance: trace.meta.instanceId,
                    }).toString()}`}
                    className="rounded border border-blue-200 px-2.5 py-1.5 text-blue-700 hover:bg-blue-50"
                  >
                    Compare parent ↔ child
                  </Link>
                )}
              </>
            )}
          </div>
          {resultChildRunId && (
            <p className="mt-2 text-slate-500">
              Immutable branch <span className="font-mono">{resultChildRunId}</span> was created.
              The source trace and checkpoint archive were not modified.
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-slate-500">Raw bridge result</summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600">
              {JSON.stringify(replay.data, null, 2)}
            </pre>
          </details>
        </section>
      )}
    </div>
  )
}
