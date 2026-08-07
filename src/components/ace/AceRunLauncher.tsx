import type { AceRunRequest } from '@shared/schema/ace'
import { useMemo, useState } from 'react'
import { useAceCapabilities, useAceScenarios, useStartAceRun } from '../../api/ace'

const INPUT =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400'
const SAFE_SCENARIO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

type BotChoice = '' | NonNullable<AceRunRequest['bot']>
type BotOpensChoice = '' | 'true' | 'false'
type ReasoningChoice = '' | NonNullable<AceRunRequest['reasoningEffort']>

export interface AceRunFormValues {
  scenarioFile: string
  scenarioIds: string
  issue: string
  language: string
  idKnowledge: string
  persistence: string
  limit: string
  seeds: string
  runKind: AceRunRequest['runKind']
  prompt: string
  promptText: string
  transport: AceRunRequest['transport']
  model: string
  userModel: string
  temperature: string
  userTemperature: string
  reasoningEffort: ReasoningChoice
  bot: BotChoice
  botOpens: BotOpensChoice
  maxMessages: string
  costCap: string
  concurrency: string
  stateScope: NonNullable<AceRunRequest['stateScope']>
  judge: NonNullable<AceRunRequest['judge']>
  judgeSample: string
  semantic: NonNullable<AceRunRequest['semanticVerify']>
  semanticSample: string
  latentRefundBlockRate: string
  failBefore: string
  responseLost: string
}

export const DEFAULT_ACE_RUN_FORM: AceRunFormValues = {
  scenarioFile: 'atomic.json',
  scenarioIds: '',
  issue: '',
  language: '',
  idKnowledge: '',
  persistence: '',
  limit: '',
  seeds: '1',
  runKind: 'scored',
  prompt: 'optimized',
  promptText: '',
  transport: 'chat',
  model: '',
  userModel: '',
  temperature: '0',
  userTemperature: '',
  reasoningEffort: '',
  bot: '',
  botOpens: '',
  maxMessages: '40',
  costCap: '5',
  concurrency: '4',
  stateScope: 'episode',
  judge: 'off',
  judgeSample: '10',
  semantic: 'off',
  semanticSample: '10',
  latentRefundBlockRate: '0',
  failBefore: '0',
  responseLost: '0',
}

export type AceRunFormResult = { ok: true; request: AceRunRequest } | { ok: false; error: string }

export interface AceRunBuildContext {
  /** Canonical parent trace for a fresh same-task rerun, never a checkpoint restore. */
  sourceTraceUid?: string
}

function tokensOf(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function numberValue(
  text: string,
  label: string,
  min: number,
  max: number,
  options: { integer?: boolean; required?: boolean } = {},
): number | undefined | string {
  const normalized = text.trim()
  if (normalized === '') {
    return options.required ? `${label} is required.` : undefined
  }
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < min || value > max) {
    return `${label} must be between ${min} and ${max}.`
  }
  if (options.integer && !Number.isSafeInteger(value)) {
    return `${label} must be a whole number between ${min} and ${max}.`
  }
  return value
}

function parseSeeds(text: string): number[] | string {
  const tokens = tokensOf(text)
  if (tokens.length === 0) return 'Seeds must include at least one non-negative integer.'
  if (tokens.length > 1_000) return 'Seeds may contain at most 1000 values.'
  const seeds: number[] = []
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) return `Seed “${token}” must be a non-negative integer.`
    const seed = Number(token)
    if (!Number.isSafeInteger(seed)) return `Seed “${token}” is outside the supported range.`
    if (!seeds.includes(seed)) seeds.push(seed)
  }
  return seeds
}

function parseScenarioIds(text: string): string[] | undefined | string {
  const tokens = tokensOf(text)
  if (tokens.length === 0) return undefined
  const scenarioIds: string[] = []
  for (const token of tokens) {
    if (!SAFE_SCENARIO_ID.test(token)) {
      return `Scenario ID “${token}” may only use letters, numbers, dot, underscore, or hyphen.`
    }
    if (!scenarioIds.includes(token)) scenarioIds.push(token)
  }
  return scenarioIds
}

/** Builds the exact API payload without starting a run. Exported for contract tests. */
export function buildAceRunRequest(
  values: AceRunFormValues,
  context: AceRunBuildContext = {},
): AceRunFormResult {
  const seeds = parseSeeds(values.seeds)
  if (typeof seeds === 'string') return { ok: false, error: seeds }

  const scenarioIds = parseScenarioIds(values.scenarioIds)
  if (typeof scenarioIds === 'string') return { ok: false, error: scenarioIds }

  const numericFields = [
    ['Temperature', values.temperature, 0, 2, false, false],
    ['User temperature', values.userTemperature, 0, 2, false, false],
    ['Max messages', values.maxMessages, 2, 500, true, true],
    ['Cost cap (USD)', values.costCap, 0.01, 100_000, false, true],
    ['Concurrency', values.concurrency, 1, 128, true, false],
    ['Scenario limit', values.limit, 1, 10_000, true, false],
    ['Latent refund block rate', values.latentRefundBlockRate, 0, 1, false, false],
    ['Write fail-before rate', values.failBefore, 0, 1, false, false],
    ['Response-lost rate', values.responseLost, 0, 1, false, false],
  ] as const
  const parsed: Record<string, number | undefined> = {}
  for (const [label, text, min, max, integer, required] of numericFields) {
    const result = numberValue(text, label, min, max, { integer, required })
    if (typeof result === 'string') return { ok: false, error: result }
    parsed[label] = result
  }

  let judgeSample: number | undefined
  if (values.judge === 'sample') {
    const result = numberValue(values.judgeSample, 'Judge sample count', 0, 1_000, {
      integer: true,
      required: true,
    })
    if (typeof result === 'string') return { ok: false, error: result }
    judgeSample = result
  }

  let semanticVerifySample: number | undefined
  if (values.semantic === 'sample') {
    const result = numberValue(values.semanticSample, 'Semantic verify sample count', 0, 1_000, {
      integer: true,
      required: true,
    })
    if (typeof result === 'string') return { ok: false, error: result }
    semanticVerifySample = result
  }

  const filters = {
    ...(values.issue.trim() ? { issue: values.issue.trim() } : {}),
    ...(values.language.trim() ? { language: values.language.trim() } : {}),
    ...(values.idKnowledge.trim() ? { idKnowledge: values.idKnowledge.trim() } : {}),
    ...(values.persistence.trim() ? { persistence: values.persistence.trim() } : {}),
  }

  const promptText = values.promptText.trim()
  if (promptText.length > 1_000_000) {
    return { ok: false, error: 'Custom prompt may contain at most 1000000 characters.' }
  }
  if (promptText && values.runKind === 'scored') {
    return {
      ok: false,
      error: 'Custom prompts require a Debug or Counterfactual run so scored metrics stay clean.',
    }
  }
  if (context.sourceTraceUid) {
    if (values.runKind === 'scored') {
      return {
        ok: false,
        error: 'Trace-derived fresh reruns must be Debug or Counterfactual, never Scored.',
      }
    }
    if (scenarioIds?.length !== 1 || seeds.length !== 1) {
      return {
        ok: false,
        error: 'A trace-derived branch requires exactly one Scenario ID and one seed.',
      }
    }
  }

  return {
    ok: true,
    request: {
      scenarioFile: values.scenarioFile,
      ...(scenarioIds ? { scenarioIds } : {}),
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      ...(parsed['Scenario limit'] !== undefined ? { limit: parsed['Scenario limit'] } : {}),
      seeds,
      runKind: values.runKind,
      prompt: values.prompt,
      ...(promptText ? { promptText } : {}),
      transport: values.transport,
      ...(values.model.trim() ? { model: values.model.trim() } : {}),
      ...(values.userModel.trim() ? { userModel: values.userModel.trim() } : {}),
      ...(parsed.Temperature !== undefined ? { temperature: parsed.Temperature } : {}),
      ...(parsed['User temperature'] !== undefined
        ? { userTemperature: parsed['User temperature'] }
        : {}),
      ...(values.reasoningEffort ? { reasoningEffort: values.reasoningEffort } : {}),
      ...(values.bot ? { bot: values.bot } : {}),
      ...(values.botOpens ? { botOpens: values.botOpens === 'true' } : {}),
      maxMessages: parsed['Max messages'] as number,
      costCapUsd: parsed['Cost cap (USD)'] as number,
      ...(parsed.Concurrency !== undefined ? { concurrency: parsed.Concurrency } : {}),
      stateScope: values.stateScope,
      ...(parsed['Latent refund block rate'] !== undefined
        ? { latentRefundBlockRate: parsed['Latent refund block rate'] }
        : {}),
      ...(parsed['Write fail-before rate'] !== undefined
        ? { toolFailBeforeRate: parsed['Write fail-before rate'] }
        : {}),
      ...(parsed['Response-lost rate'] !== undefined
        ? { toolResponseLostRate: parsed['Response-lost rate'] }
        : {}),
      judge: values.judge,
      ...(judgeSample !== undefined ? { judgeSample } : {}),
      semanticVerify: values.semantic,
      ...(semanticVerifySample !== undefined ? { semanticVerifySample } : {}),
      checkpoints: true,
      ...(context.sourceTraceUid ? { sourceTraceUid: context.sourceTraceUid } : {}),
    },
  }
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="contents">
      <legend className="col-span-full mt-2 border-b border-slate-100 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

export function AceRunLauncher({
  initialScenarioFile,
  initialScenarioId,
  initialSeed,
  initialRunKind,
  sourceTraceUid,
  title,
  onStarted,
}: {
  initialScenarioFile?: string
  initialScenarioId?: string
  initialSeed?: number
  initialRunKind?: 'debug' | 'counterfactual'
  sourceTraceUid?: string
  title?: string
  onStarted?: (runId: string) => void
}) {
  const capabilities = useAceCapabilities()
  const scenarios = useAceScenarios()
  const start = useStartAceRun()
  const [values, setValues] = useState<AceRunFormValues>(() => ({
    ...DEFAULT_ACE_RUN_FORM,
    ...(initialScenarioFile ? { scenarioFile: initialScenarioFile } : {}),
    ...(initialScenarioId ? { scenarioIds: initialScenarioId } : {}),
    ...(initialSeed !== undefined ? { seeds: String(initialSeed) } : {}),
    ...(initialRunKind ? { runKind: initialRunKind } : {}),
  }))
  const [validationError, setValidationError] = useState<string | null>(null)
  const seedCount = useMemo(() => new Set(tokensOf(values.seeds)).size, [values.seeds])
  const selectedScenarioCount = useMemo(() => {
    const explicit = new Set(tokensOf(values.scenarioIds)).size
    if (explicit > 0) return explicit
    return scenarios.data?.items.find((pack) => pack.file === values.scenarioFile)?.count ?? 1
  }, [scenarios.data?.items, values.scenarioFile, values.scenarioIds])
  const plannedEpisodeCount = Math.max(1, seedCount) * selectedScenarioCount
  const available = capabilities.data?.available === true

  const setField = <Key extends keyof AceRunFormValues>(key: Key, value: AceRunFormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setValidationError(null)
  }

  const setPromptText = (value: string) => {
    setValues((current) => ({
      ...current,
      promptText: value,
      ...(value.trim() && current.runKind === 'scored'
        ? { runKind: 'counterfactual' as const }
        : {}),
    }))
    setValidationError(null)
  }

  const submit = async () => {
    if (!available) return
    const result = buildAceRunRequest(values, { sourceTraceUid })
    if (!result.ok) {
      setValidationError(result.error)
      return
    }
    try {
      const response = await start.mutateAsync(result.request)
      onStarted?.(response.runId)
    } catch {
      // React Query exposes the server error below the controls.
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            {title ?? 'Start simulation / evaluation'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Every viewer-launched run records checkpoints and immutable config snapshots.
          </p>
        </div>
        <span
          className={`rounded px-2 py-1 text-[10px] font-medium ${available ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
        >
          {available
            ? 'ACE bridge ready'
            : capabilities.isLoading
              ? 'Checking bridge…'
              : (capabilities.data?.message ?? 'Bridge unavailable')}
        </span>
      </div>

      {sourceTraceUid && (
        <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
          <b>Fresh same-task rerun</b> · parent <span className="font-mono">{sourceTraceUid}</span>
          <span className="mt-1 block text-violet-700">
            This creates a new immutable debug/counterfactual run. Scenario and seed are reused, but
            DB, RNG, transcript, tools, and model output start fresh; it is not checkpoint replay.
          </span>
        </div>
      )}

      <div className="mt-2 grid gap-3 md:grid-cols-3 lg:grid-cols-4">
        <FieldGroup title="Tasks & schedule">
          <label className="text-xs text-slate-600">
            Scenario pack
            <select
              className={INPUT}
              value={values.scenarioFile}
              onChange={(event) => setField('scenarioFile', event.target.value)}
            >
              {!(scenarios.data?.items ?? []).some((pack) => pack.file === values.scenarioFile) && (
                <option value={values.scenarioFile}>
                  {values.scenarioFile.startsWith('regression:')
                    ? `Saved ${values.scenarioFile}`
                    : values.scenarioFile}
                </option>
              )}
              {(scenarios.data?.items ?? []).map((pack) => (
                <option key={pack.file} value={pack.file}>
                  {pack.file} ({pack.count})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Scenario IDs
            <input
              className={INPUT}
              value={values.scenarioIds}
              onChange={(event) => setField('scenarioIds', event.target.value)}
              placeholder="cancel-late-01, refund-02"
            />
            <span className="mt-0.5 block text-[10px] text-slate-400">
              Comma-separated; blank selects the pack.
            </span>
          </label>
          <label className="text-xs text-slate-600">
            Seeds
            <input
              className={INPUT}
              value={values.seeds}
              onChange={(event) => setField('seeds', event.target.value)}
              placeholder="1, 2, 3"
            />
          </label>
          <label className="text-xs text-slate-600">
            Scenario limit
            <input
              type="number"
              min="1"
              max="10000"
              className={INPUT}
              value={values.limit}
              onChange={(event) => setField('limit', event.target.value)}
              placeholder="No limit"
            />
          </label>
          <label className="text-xs text-slate-600">
            Issue filter
            <input
              className={INPUT}
              value={values.issue}
              onChange={(event) => setField('issue', event.target.value)}
              placeholder="refund"
            />
          </label>
          <label className="text-xs text-slate-600">
            Language filter
            <input
              className={INPUT}
              value={values.language}
              onChange={(event) => setField('language', event.target.value)}
              placeholder="en"
            />
          </label>
          <label className="text-xs text-slate-600">
            ID knowledge filter
            <input
              className={INPUT}
              value={values.idKnowledge}
              onChange={(event) => setField('idKnowledge', event.target.value)}
              placeholder="known / unknown"
            />
          </label>
          <label className="text-xs text-slate-600">
            Persistence filter
            <input
              className={INPUT}
              value={values.persistence}
              onChange={(event) => setField('persistence', event.target.value)}
              placeholder="persistent"
            />
          </label>
        </FieldGroup>

        <FieldGroup title="Policy, models & harness">
          <label className="text-xs text-slate-600">
            Run kind
            <select
              className={INPUT}
              value={values.runKind}
              onChange={(event) =>
                setField('runKind', event.target.value as AceRunRequest['runKind'])
              }
            >
              <option value="scored" disabled={Boolean(sourceTraceUid)}>
                Scored{sourceTraceUid ? ' (unavailable for trace branches)' : ''}
              </option>
              <option value="debug">Debug</option>
              <option value="counterfactual">Counterfactual</option>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Prompt preset
            <select
              className={INPUT}
              value={values.prompt}
              onChange={(event) => setField('prompt', event.target.value)}
            >
              <option>baseline</option>
              <option>improved</option>
              <option>optimized</option>
            </select>
          </label>
          <label className="text-xs text-slate-600 md:col-span-2">
            Custom prompt (optional)
            <textarea
              rows={5}
              className={INPUT}
              value={values.promptText}
              onChange={(event) => setPromptText(event.target.value)}
              placeholder="Paste a full assistant policy prompt; this overrides the preset."
            />
            <span className="mt-0.5 block text-[10px] text-slate-400">
              Entering text switches a scored run to counterfactual so it cannot contaminate formal
              metrics.
            </span>
          </label>
          <label className="text-xs text-slate-600">
            Transport
            <select
              className={INPUT}
              value={values.transport}
              onChange={(event) =>
                setField('transport', event.target.value as AceRunRequest['transport'])
              }
            >
              <option value="chat">Chat</option>
              <option value="responses">Responses</option>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Assistant model
            <input
              className={INPUT}
              value={values.model}
              onChange={(event) => setField('model', event.target.value)}
              placeholder="Runner default"
            />
          </label>
          <label className="text-xs text-slate-600">
            User-simulator model
            <input
              className={INPUT}
              value={values.userModel}
              onChange={(event) => setField('userModel', event.target.value)}
              placeholder="Runner default"
            />
          </label>
          <label className="text-xs text-slate-600">
            Assistant temperature
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              className={INPUT}
              value={values.temperature}
              onChange={(event) => setField('temperature', event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-600">
            User temperature
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              className={INPUT}
              value={values.userTemperature}
              onChange={(event) => setField('userTemperature', event.target.value)}
              placeholder="Runner default"
            />
          </label>
          <label className="text-xs text-slate-600">
            Reasoning effort
            <select
              className={INPUT}
              value={values.reasoningEffort}
              onChange={(event) =>
                setField('reasoningEffort', event.target.value as ReasoningChoice)
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
          <label className="text-xs text-slate-600">
            Bot harness
            <select
              className={INPUT}
              value={values.bot}
              onChange={(event) => setField('bot', event.target.value as BotChoice)}
            >
              <option value="">Runner default</option>
              <option value="baseline">Baseline</option>
              <option value="playbook">Playbook</option>
              <option value="workflow">Workflow</option>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Conversation opener
            <select
              className={INPUT}
              value={values.botOpens}
              onChange={(event) => setField('botOpens', event.target.value as BotOpensChoice)}
            >
              <option value="">Runner default</option>
              <option value="false">User opens</option>
              <option value="true">Bot opens</option>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            State scope
            <select
              className={INPUT}
              value={values.stateScope}
              onChange={(event) =>
                setField('stateScope', event.target.value as AceRunFormValues['stateScope'])
              }
            >
              <option value="episode">Episode</option>
              <option value="journey">Journey</option>
            </select>
          </label>
        </FieldGroup>

        <FieldGroup title="Budget, evaluation & fault knobs">
          <label className="text-xs text-slate-600">
            Max messages *
            <input
              required
              type="number"
              min="2"
              max="500"
              className={INPUT}
              value={values.maxMessages}
              onChange={(event) => setField('maxMessages', event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-600">
            Cost cap (USD) *
            <input
              required
              type="number"
              min="0.01"
              max="100000"
              step="0.25"
              className={INPUT}
              value={values.costCap}
              onChange={(event) => setField('costCap', event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-600">
            Concurrency
            <input
              type="number"
              min="1"
              max="128"
              className={INPUT}
              value={values.concurrency}
              onChange={(event) => setField('concurrency', event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-600">
            Judge
            <select
              className={INPUT}
              value={values.judge}
              onChange={(event) =>
                setField('judge', event.target.value as AceRunFormValues['judge'])
              }
            >
              <option value="off">Off</option>
              <option value="all">All</option>
              <option value="sample">Sample</option>
            </select>
          </label>
          {values.judge === 'sample' && (
            <label className="text-xs text-slate-600">
              Judge sample count *
              <input
                required
                type="number"
                min="0"
                max="1000"
                className={INPUT}
                value={values.judgeSample}
                onChange={(event) => setField('judgeSample', event.target.value)}
              />
            </label>
          )}
          <label className="text-xs text-slate-600">
            Semantic verify
            <select
              className={INPUT}
              value={values.semantic}
              onChange={(event) =>
                setField('semantic', event.target.value as AceRunFormValues['semantic'])
              }
            >
              <option value="off">Off</option>
              <option value="all">All</option>
              <option value="sample">Sample</option>
            </select>
          </label>
          {values.semantic === 'sample' && (
            <label className="text-xs text-slate-600">
              Semantic verify sample count *
              <input
                required
                type="number"
                min="0"
                max="1000"
                className={INPUT}
                value={values.semanticSample}
                onChange={(event) => setField('semanticSample', event.target.value)}
              />
            </label>
          )}
          <label className="text-xs text-slate-600">
            Latent refund block rate
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              className={INPUT}
              value={values.latentRefundBlockRate}
              onChange={(event) => setField('latentRefundBlockRate', event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-600">
            Write fail-before rate
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              className={INPUT}
              value={values.failBefore}
              onChange={(event) => setField('failBefore', event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-600">
            Response-lost rate
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              className={INPUT}
              value={values.responseLost}
              onChange={(event) => setField('responseLost', event.target.value)}
            />
          </label>
        </FieldGroup>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-500">
          Scored runs always use the fixed ACE manifest of exactly 8 tools; tool toggles are
          unavailable. This launch schedules {selectedScenarioCount}{' '}
          {selectedScenarioCount === 1 ? 'task' : 'tasks'} × {Math.max(1, seedCount)}{' '}
          {Math.max(1, seedCount) === 1 ? 'seed' : 'seeds'}.
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!available || start.isPending}
          className="ml-auto rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {start.isPending
            ? 'Starting…'
            : plannedEpisodeCount > 1
              ? `Run batch · ${plannedEpisodeCount} episodes`
              : 'Run one'}
        </button>
      </div>
      {validationError && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {validationError}
        </p>
      )}
      {start.error && !validationError && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {start.error instanceof Error ? start.error.message : 'Run could not start'}
        </p>
      )}
    </section>
  )
}
