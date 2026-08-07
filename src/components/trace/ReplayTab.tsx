import type {
  AceCheckpointResponse,
  AceCheckpointSummary,
  AceReplayRequest,
} from '@shared/schema/ace'
import {
  type AceRegressionScenarioSnapshot,
  parseAceRegressionScenarioSnapshot,
} from '@shared/schema/aceRegression'
import type { Message, Trace } from '@shared/schema/types'
import { useMemo, useRef, useState } from 'react'
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

function chronologicalMessages(messages: readonly Message[]) {
  return messages
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
}

const ACE_TOOL_NAMES = new Set([
  'get_order_details',
  'check_valid_remediations',
  'cancel_order',
  'issue_refund',
  'issue_refund_as_human',
  'escalate_to_human',
  'get_store_info',
  'get_customer_orders',
])

function safeScenarioValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
  return /^[a-z0-9]/.test(normalized) ? normalized : fallback
}

function safeScenarioId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
  return /^[a-z0-9]/.test(normalized) ? normalized : 'production-regression'
}

function productionLanguage(value: unknown): 'en' | 'es' | 'ko' {
  if (typeof value !== 'string') return 'en'
  const normalized = value.trim().toLowerCase()
  if (normalized === 'ko' || normalized.startsWith('kor')) return 'ko'
  if (normalized === 'es' || normalized.startsWith('spa')) return 'es'
  return 'en'
}

function firstOrderId(trace: Trace): string {
  const extra = record(trace.meta.extra)
  for (const candidate of [extra.order_id, extra.orderId]) {
    if (typeof candidate === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) {
      return candidate
    }
  }
  for (const entry of trace.evaluation?.ledger ?? []) {
    const args = record(entry.args)
    const candidate = args.order_id ?? args.orderId
    if (typeof candidate === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) {
      return candidate
    }
  }
  for (const message of trace.messages) {
    for (const call of message.toolCalls ?? []) {
      let args = record(call.parsedArguments)
      if (Object.keys(args).length === 0) {
        try {
          args = record(JSON.parse(call.arguments))
        } catch {
          args = {}
        }
      }
      const candidate = args.order_id ?? args.orderId
      if (typeof candidate === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) {
        return candidate
      }
    }
  }
  const transcript = trace.messages.map((message) => message.content).join(' ')
  return transcript.match(/\border[_ -]?\d+\b/i)?.[0]?.replace(/[ -]/g, '_') ?? ''
}

function productionExpectedOutcome(
  issue: string,
): AceRegressionScenarioSnapshot['expected_outcome'] {
  if (issue.includes('cancel')) return 'cancel'
  if (issue.includes('refund') || issue.includes('damaged') || issue.includes('missing')) {
    return 'refund'
  }
  if (issue.includes('escalat') || issue.includes('human')) return 'escalate'
  return 'info'
}

/** Build an editable draft from evidence only; missing ground truth stays visibly blank. */
export function productionRegressionScenarioSeed(trace: Trace): AceRegressionScenarioSnapshot {
  const extra = record(trace.meta.extra)
  const issue = safeScenarioValue(extra.issue ?? extra.issue_type, 'other')
  const orderId = firstOrderId(trace)
  const userTurns = chronologicalMessages(trace.messages)
    .map(({ message }) => message)
    .filter((message) => message.role === 'user')
  const firstUser = userTurns[0]?.content.trim()
  const observedTools = [
    ...new Set(
      trace.messages
        .flatMap((message) => message.toolCalls ?? [])
        .map((call) => call.name)
        .filter((name) => ACE_TOOL_NAMES.has(name)),
    ),
  ]
  const expectedActions = observedTools.map((name) => ({
    name,
    ...(orderId && name !== 'escalate_to_human' && name !== 'get_customer_orders'
      ? { args_subset: { order_id: orderId } }
      : {}),
  }))
  const userTranscript = userTurns.map((message) => message.content).join(' ')
  return {
    scenario_id: safeScenarioId(`production-${trace.meta.sourceTraceId ?? trace.meta.traceId}`),
    suite: 'regression',
    card: {
      issue,
      language: productionLanguage(extra.language),
      id_knowledge: orderId && userTranscript.includes(orderId) ? 'exact' : 'partial',
      patience: Math.max(4, Math.min(100, userTurns.length + 2)),
      persistence: 'accepts_refusal',
      style: [],
      order_id: orderId,
      goal: (firstUser || 'Reproduce and investigate this production support request.').slice(
        0,
        4096,
      ),
    },
    expected_actions: expectedActions,
    forbidden_actions: [],
    expected_outcome: productionExpectedOutcome(issue),
    reward_basis: expectedActions.length > 0 ? ['ACTIONS', 'OUTCOME'] : ['OUTCOME'],
  }
}

export type RegressionScenarioDraftValidation =
  | { ok: true; scenario: AceRegressionScenarioSnapshot }
  | { ok: false; error: string }

export function validateRegressionScenarioDraft(text: string): RegressionScenarioDraftValidation {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      error: `Scenario JSON is invalid: ${error instanceof Error ? error.message : 'parse failed'}`,
    }
  }
  try {
    return { ok: true, scenario: parseAceRegressionScenarioSnapshot(value) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Scenario is invalid' }
  }
}

/** Resolve the exact last message contained in a checkpoint prefix. */
export function checkpointForkMessageId(
  checkpoint: AceCheckpointSummary | undefined,
  messages: readonly Message[],
): string | undefined {
  if (!checkpoint) return undefined
  const provided = checkpoint.fork_message_id ?? checkpoint.forkMessageId
  if (typeof provided === 'string' && provided.length > 0) return provided
  const count = checkpoint.message_count
  if (count === undefined || !Number.isSafeInteger(count) || count <= 0) return undefined
  const ordered = chronologicalMessages(messages)
  if (count > ordered.length) return undefined
  return ordered[count - 1]?.message.id
}

export interface HistoricalReplayRow {
  tool: string
  chronologicalIndex?: number
  rawIndex?: number
  stratum: string
  kind: string
  detail: string
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function displayText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Prefer the complete record set, while remaining compatible with residual-only bridge output. */
export function historicalReplayRows(
  bridgeResult: Record<string, unknown>,
  informativeOnly: boolean,
): HistoricalReplayRow[] {
  const candidates = Array.isArray(bridgeResult.records)
    ? bridgeResult.records
    : Array.isArray(bridgeResult.residuals)
      ? bridgeResult.residuals
      : []
  return candidates
    .map(record)
    .map((row) => ({
      tool: displayText(row.tool) || 'unknown tool',
      chronologicalIndex: finiteNumber(
        row.chronological_index ?? row.chronologicalIndex ?? row.index,
      ),
      rawIndex: finiteNumber(row.raw_index ?? row.rawIndex),
      stratum: displayText(row.stratum) || 'unclassified',
      kind: displayText(row.kind) || 'unknown',
      detail: displayText(row.detail),
    }))
    .filter(
      (row) =>
        !informativeOnly ||
        row.stratum === 'informative_read' ||
        row.stratum === 'informative_write',
    )
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
  const forkInFlight = useRef(false)
  const [requestedChildRunId, setRequestedChildRunId] = useState('')
  const [nextUserMessage, setNextUserMessage] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState('')
  const [regressionId, setRegressionId] = useState('')
  const [boundaryMessageId, setBoundaryMessageId] = useState('')
  const [informativeOnly, setInformativeOnly] = useState(true)
  const [scenarioDraft, setScenarioDraft] = useState(() =>
    JSON.stringify(productionRegressionScenarioSeed(trace), null, 2),
  )

  const defaultCheckpoint = useMemo(() => {
    if (rows.length === 0) return undefined
    const branchable = [...rows].reverse().find((row) => row.branchable)
    return branchable ?? rows[rows.length - 1]
  }, [rows])
  const selected = useMemo(
    () => rows.find((row) => row.id === checkpointId) ?? defaultCheckpoint,
    [rows, checkpointId, defaultCheckpoint],
  )
  const selectedCheckpointId = selected?.id
  const selectedForkMessageId = useMemo(
    () => checkpointForkMessageId(selected, trace.messages),
    [selected, trace.messages],
  )
  const missing = checkpoints.data?.missing ?? []
  const result = record(replay.data)
  const bridgeResult = record(result.result)
  const resultLineage = record(bridgeResult.lineage)
  const resultChildRunId =
    typeof bridgeResult.child_run_id === 'string' ? bridgeResult.child_run_id : undefined
  const resultForkMessageId =
    typeof (resultLineage.fork_message_id ?? resultLineage.forkMessageId) === 'string'
      ? String(resultLineage.fork_message_id ?? resultLineage.forkMessageId)
      : undefined
  const resultCheckpointId = finiteNumber(resultLineage.checkpoint_id ?? resultLineage.checkpointId)
  const allHistoricalRows = historicalReplayRows(bridgeResult, false)
  const visibleHistoricalRows = informativeOnly
    ? allHistoricalRows.filter(
        (row) => row.stratum === 'informative_read' || row.stratum === 'informative_write',
      )
    : allHistoricalRows
  const historicalRowsSource = Array.isArray(bridgeResult.records) ? 'records' : 'residuals'
  const orderedMessages = useMemo(() => chronologicalMessages(trace.messages), [trace.messages])
  const needsProductionScenario =
    trace.meta.corpusId === 'production' &&
    regressionCapability.data?.scenarioSnapshotAvailable === false
  const scenarioDraftValidation = useMemo(
    () => validateRegressionScenarioDraft(scenarioDraft),
    [scenarioDraft],
  )

  const historical = () => replay.mutate(historicalReplayRequest(trace))
  const restore = () =>
    replay.mutate({ sourceTraceUid: traceUid, mode: 'restore', checkpointId: selectedCheckpointId })
  // Forks spend real money: hold this path to the same 0.01–100000 cost-cap
  // bounds every other launch path validates (an empty box is Number('') === 0,
  // and NaN would serialize to null).
  const costCapValue = Number(costCap)
  const costCapInvalid =
    costCap.trim() === '' ||
    !Number.isFinite(costCapValue) ||
    costCapValue < 0.01 ||
    costCapValue > 100_000
  const temperatureValue = Number(temperature)
  const temperatureInvalid =
    temperature.trim() !== '' &&
    (!Number.isFinite(temperatureValue) || temperatureValue < 0 || temperatureValue > 2)
  const fork = (mode: 'exact' | 'counterfactual') => {
    if (costCapInvalid || (mode === 'counterfactual' && temperatureInvalid)) return
    // Forks spend money; replay.isPending only disables the button after a
    // re-render, so a fast double-click would otherwise start two forks. The
    // ref closes that window synchronously.
    if (forkInFlight.current) return
    forkInFlight.current = true
    replay.mutate(
      {
        sourceTraceUid: traceUid,
        mode,
        checkpointId: selectedCheckpointId,
        ...(selectedForkMessageId ? { forkMessageId: selectedForkMessageId } : {}),
        costCapUsd: costCapValue,
        ...(requestedChildRunId.trim() ? { childRunId: requestedChildRunId.trim() } : {}),
        ...(mode === 'counterfactual' && nextUserMessage.trim()
          ? { nextUserMessage: nextUserMessage.trim() }
          : {}),
        ...(mode === 'counterfactual' && prompt.trim() ? { prompt: prompt.trim() } : {}),
        ...(mode === 'counterfactual' && model.trim() ? { model: model.trim() } : {}),
        ...(mode === 'counterfactual' && temperature.trim() !== ''
          ? { temperature: temperatureValue }
          : {}),
      },
      {
        onSettled: () => {
          forkInFlight.current = false
        },
      },
    )
  }
  const saveAsRegression = () => {
    if (needsProductionScenario && !scenarioDraftValidation.ok) return
    saveRegression.mutate({
      sourceTraceUid: traceUid,
      ...(boundaryMessageId ? { boundaryMessageId } : {}),
      ...(regressionId.trim() ? { regressionId: regressionId.trim() } : {}),
      ...(needsProductionScenario && scenarioDraftValidation.ok
        ? { scenarioSnapshot: scenarioDraftValidation.scenario }
        : {}),
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
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
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
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-500">
                Showing {visibleHistoricalRows.length}/{allHistoricalRows.length}{' '}
                {historicalRowsSource}
              </span>
              <label className="inline-flex items-center gap-1.5 text-slate-700">
                <input
                  type="checkbox"
                  checked={informativeOnly}
                  onChange={(event) => setInformativeOnly(event.target.checked)}
                />
                Informative reads/writes only
              </label>
            </div>
            {visibleHistoricalRows.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Tool</th>
                      <th className="px-2 py-1.5 font-medium">Indices</th>
                      <th className="px-2 py-1.5 font-medium">Stratum</th>
                      <th className="px-2 py-1.5 font-medium">Result</th>
                      <th className="px-2 py-1.5 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleHistoricalRows.map((row) => (
                      <tr
                        key={`${row.tool}:${row.chronologicalIndex ?? 'unknown'}:${row.rawIndex ?? 'unknown'}:${row.stratum}:${row.kind}`}
                        className={row.kind === 'match' ? 'text-slate-600' : 'bg-amber-50/60'}
                      >
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono">{row.tool}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          chrono {row.chronologicalIndex ?? '—'} · raw {row.rawIndex ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">{row.stratum}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-medium">{row.kind}</td>
                        <td className="max-w-lg px-2 py-1.5">{row.detail || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                No replay rows match this filter.
              </p>
            )}
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
                value={selectedCheckpointId ?? ''}
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
              disabled={selectedCheckpointId === undefined || replay.isPending}
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
        {selected && (
          <p
            data-testid="fork-lineage-boundary"
            className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600"
          >
            Fork lineage · checkpoint <b>#{selected.id}</b> · boundary message{' '}
            {selectedForkMessageId ? (
              <code className="font-mono text-slate-800">{selectedForkMessageId}</code>
            ) : selected.message_count === 0 ? (
              <span>before the first recorded message</span>
            ) : (
              <span className="text-amber-700">
                unavailable (prefix does not map to this trace)
              </span>
            )}
          </p>
        )}
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
            {costCapInvalid && (
              <span className="mt-1 block text-[11px] text-rose-600">
                Cost cap (USD) must be between 0.01 and 100000.
              </span>
            )}
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => fork('exact')}
              disabled={!selected?.branchable || replay.isPending || costCapInvalid}
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
            {temperatureInvalid && (
              <span className="mt-1 block text-[11px] text-rose-600">
                Temperature must be between 0 and 2.
              </span>
            )}
          </label>
        </div>
        <button
          type="button"
          onClick={() => fork('counterfactual')}
          disabled={
            !selected?.counterfactual_branchable ||
            replay.isPending ||
            costCapInvalid ||
            temperatureInvalid ||
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
            {needsProductionScenario && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-amber-900">
                      Complete production evidence as a Scenario
                    </h3>
                    <p className="mt-1 text-[11px] text-amber-800">
                      Transcript and metadata seed this draft. Verify the simulator world order ID,
                      persona, target actions, outcome, and reward basis before saving.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-800"
                    onClick={() =>
                      setScenarioDraft(
                        JSON.stringify(productionRegressionScenarioSeed(trace), null, 2),
                      )
                    }
                  >
                    Reset from trace
                  </button>
                </div>
                <textarea
                  data-testid="production-scenario-json"
                  rows={22}
                  spellCheck={false}
                  className={`${INPUT} mt-2 font-mono leading-5`}
                  value={scenarioDraft}
                  onChange={(event) => setScenarioDraft(event.target.value)}
                />
                {scenarioDraftValidation.ok ? (
                  <p className="mt-1 text-[11px] text-emerald-700">
                    Scenario contract valid · save creates a synthetic rerun artifact.
                  </p>
                ) : (
                  <p
                    data-testid="scenario-validation-error"
                    className="mt-1 text-[11px] text-red-700"
                  >
                    {scenarioDraftValidation.error}
                  </p>
                )}
                <p className="mt-1 text-[11px] font-medium text-amber-900">
                  Synthetic reruns are always Debug/Counterfactual and excluded from formal metrics.
                </p>
              </div>
            )}
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
              disabled={
                !regressionCapability.data.available ||
                saveRegression.isPending ||
                (needsProductionScenario && !scenarioDraftValidation.ok)
              }
              className="mt-3 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800 disabled:opacity-40"
            >
              {saveRegression.isPending
                ? 'Saving immutable artifact…'
                : needsProductionScenario
                  ? 'Save runnable synthetic scenario'
                  : 'Save regression artifact'}
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
                ? 'Runnable synthetic scenario saved · formal metrics excluded'
                : 'Regression draft saved'}
              {saveRegression.data.deduplicated ? ' · existing identical artifact reused' : ''}
            </b>
            <span className="mt-1 block font-mono">ACE runs/{saveRegression.data.artifact}</span>
            {saveRegression.data.runnable && (
              <Link
                to={`/ace?${new URLSearchParams({
                  scenarioFile: `regression:${saveRegression.data.regressionId}`,
                  ...(saveRegression.data.scenarioId
                    ? { scenarioId: saveRegression.data.scenarioId }
                    : {}),
                }).toString()}`}
                className="mt-2 inline-block rounded border border-blue-200 px-2.5 py-1.5 font-medium text-blue-700 hover:bg-blue-50"
              >
                Configure synthetic rerun (Debug/Counterfactual)
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
            <div className="mt-2 space-y-1 text-slate-500">
              <p>
                Immutable branch <span className="font-mono">{resultChildRunId}</span> was created.
                The source trace and checkpoint archive were not modified.
              </p>
              <p data-testid="result-fork-lineage">
                Recorded lineage · checkpoint{' '}
                <b>#{resultCheckpointId ?? selectedCheckpointId ?? 'unknown'}</b> · boundary message{' '}
                <code className="font-mono text-slate-700">
                  {resultForkMessageId ?? selectedForkMessageId ?? 'unavailable'}
                </code>
              </p>
            </div>
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
