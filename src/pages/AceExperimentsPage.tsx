import type { AceRunRequest } from '@shared/schema/ace'
import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAceCapabilities, useAceScenarios, useStartAceRun } from '../api/ace'
import {
  buildExperimentMatrix,
  defaultExperimentMatrixValues,
  type ExperimentMatrixValues,
  type ExperimentVariantValues,
  experimentCompareHref,
} from '../components/ace/experimentMatrix'

const INPUT =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-400'

type VariantKey = keyof ExperimentVariantValues

interface LaunchResult {
  experimentId: string
  instanceId: string
  a?: string
  b?: string
  errors: string[]
}

function initialValues(search: URLSearchParams): ExperimentMatrixValues {
  const defaults = defaultExperimentMatrixValues()
  return {
    ...defaults,
    experimentId: search.get('experimentId')?.trim() || defaults.experimentId,
    scenarioFile: search.get('scenarioFile')?.trim() || defaults.scenarioFile,
    scenarioId: search.get('scenarioId')?.trim() || defaults.scenarioId,
    seeds: search.get('seeds')?.trim() || defaults.seeds,
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'Run could not be started.'
}

function VariantCard({
  label,
  values,
  onChange,
}: {
  label: 'A' | 'B'
  values: ExperimentVariantValues
  onChange: <Key extends VariantKey>(key: Key, value: ExperimentVariantValues[Key]) => void
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span
          className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${label === 'A' ? 'bg-slate-900 text-white' : 'bg-blue-600 text-white'}`}
        >
          {label}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Variant {label}</h2>
          <p className="text-[10px] text-slate-500">Independent agent policy configuration</p>
        </div>
        {values.promptMode === 'custom' && (
          <span className="ml-auto rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">
            policy changed
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-600">
          Bot harness
          <select
            className={INPUT}
            value={values.bot}
            onChange={(event) =>
              onChange('bot', event.target.value as ExperimentVariantValues['bot'])
            }
          >
            <option value="baseline">Baseline</option>
            <option value="playbook">Playbook</option>
            <option value="workflow">Workflow</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Assistant model
          <input
            className={INPUT}
            value={values.model}
            onChange={(event) => onChange('model', event.target.value)}
            placeholder="Runner default"
          />
        </label>
        <label className="text-xs text-slate-600">
          Prompt source
          <select
            className={INPUT}
            value={values.promptMode}
            onChange={(event) =>
              onChange('promptMode', event.target.value as ExperimentVariantValues['promptMode'])
            }
          >
            <option value="preset">Versioned preset</option>
            <option value="custom">Inline custom prompt</option>
          </select>
        </label>
        {values.promptMode === 'preset' && (
          <label className="text-xs text-slate-600">
            Prompt preset
            <select
              className={INPUT}
              value={values.promptPreset}
              onChange={(event) =>
                onChange(
                  'promptPreset',
                  event.target.value as ExperimentVariantValues['promptPreset'],
                )
              }
            >
              <option value="baseline">Baseline</option>
              <option value="improved">Improved</option>
              <option value="optimized">Optimized</option>
              <option value="v3">v3</option>
              <option value="v4">v4 · canonical</option>
            </select>
          </label>
        )}
        {values.promptMode === 'custom' && (
          <label className="text-xs text-slate-600 sm:col-span-2">
            Inline custom prompt
            <textarea
              className={`${INPUT} min-h-36 resize-y font-mono leading-4`}
              value={values.promptText}
              onChange={(event) => onChange('promptText', event.target.value)}
              placeholder="Enter the complete policy prompt for this debug experiment…"
            />
            <span className="mt-1 block text-[10px] text-amber-700">
              This variant is explicitly tagged policy-changed and is excluded from scored runs.
            </span>
          </label>
        )}
        <label className="text-xs text-slate-600">
          Temperature
          <input
            type="number"
            min="0"
            max="2"
            step="0.1"
            className={INPUT}
            value={values.temperature}
            onChange={(event) => onChange('temperature', event.target.value)}
          />
        </label>
        <label className="text-xs text-slate-600">
          Transport
          <select
            className={INPUT}
            value={values.transport}
            onChange={(event) =>
              onChange('transport', event.target.value as AceRunRequest['transport'])
            }
          >
            <option value="chat">Chat</option>
            <option value="responses">Responses</option>
          </select>
        </label>
        <label className="text-xs text-slate-600 sm:col-span-2">
          Reasoning effort
          <select
            className={INPUT}
            value={values.reasoningEffort}
            onChange={(event) =>
              onChange(
                'reasoningEffort',
                event.target.value as ExperimentVariantValues['reasoningEffort'],
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
      </div>
    </section>
  )
}

export default function AceExperimentsPage() {
  const [search] = useSearchParams()
  const capabilities = useAceCapabilities()
  const scenarios = useAceScenarios()
  const startA = useStartAceRun()
  const startB = useStartAceRun()
  const [values, setValues] = useState<ExperimentMatrixValues>(() => initialValues(search))
  const [validationError, setValidationError] = useState<string | null>(null)
  const [launch, setLaunch] = useState<LaunchResult | null>(null)
  const available = capabilities.data?.available === true
  const preview = useMemo(() => buildExperimentMatrix(values), [values])
  const pending = startA.isPending || startB.isPending
  const priorLaunch = launch?.experimentId === values.experimentId.trim() ? launch : null
  // Lock the button only once BOTH variants started; a partial failure keeps
  // the retry path open, and the retry skips the variant that already ran.
  const alreadySubmitted = Boolean(priorLaunch?.a && priorLaunch?.b)

  const setShared = <Key extends keyof Omit<ExperimentMatrixValues, 'a' | 'b'>>(
    key: Key,
    value: ExperimentMatrixValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }))
    setValidationError(null)
  }
  const setVariant = <Side extends 'a' | 'b', Key extends VariantKey>(
    side: Side,
    key: Key,
    value: ExperimentVariantValues[Key],
  ) => {
    setValues((current) => ({
      ...current,
      [side]: { ...current[side], [key]: value },
    }))
    setValidationError(null)
  }

  // isPending flips only on re-render; the ref closes the double-click window
  // synchronously so a second click cannot start a second paid batch.
  const launchInFlight = useRef(false)
  const launchPair = async () => {
    if (launchInFlight.current) return
    const result = buildExperimentMatrix(values)
    if (!result.ok) {
      setValidationError(result.error)
      return
    }
    setValidationError(null)
    launchInFlight.current = true
    try {
      // A variant that already started for this experiment id keeps its run;
      // only the missing side is (re)launched, so a retry never double-spends.
      const [a, b] = await Promise.allSettled([
        priorLaunch?.a
          ? Promise.resolve({ runId: priorLaunch.a })
          : startA.mutateAsync(result.plan.requests.a),
        priorLaunch?.b
          ? Promise.resolve({ runId: priorLaunch.b })
          : startB.mutateAsync(result.plan.requests.b),
      ])
      setLaunch({
        experimentId: result.plan.experimentId,
        instanceId: result.plan.instanceId,
        ...(a.status === 'fulfilled' ? { a: a.value.runId } : {}),
        ...(b.status === 'fulfilled' ? { b: b.value.runId } : {}),
        errors: [
          ...(a.status === 'rejected' ? [`Variant A: ${errorMessage(a.reason)}`] : []),
          ...(b.status === 'rejected' ? [`Variant B: ${errorMessage(b.reason)}`] : []),
        ],
      })
    } finally {
      launchInFlight.current = false
    }
  }

  const packOptions = [
    ...new Set([values.scenarioFile, ...(scenarios.data?.items.map((pack) => pack.file) ?? [])]),
  ]

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold text-slate-900">ACE Experiment Matrix</h1>
          <span
            className={`rounded px-2 py-1 text-[10px] font-medium ${available ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
          >
            {available
              ? 'ACE bridge ready'
              : capabilities.isLoading
                ? 'Checking bridge…'
                : (capabilities.data?.message ?? 'Bridge unavailable')}
          </span>
        </header>

        <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
          <h2 className="text-sm font-semibold text-blue-950">Matched experiment invariant</h2>
          <p className="mt-1 text-xs leading-5 text-blue-800">
            A and B use the same scenario pack, task ID, seeds, limits, state scope, and fault
            physics. Only the agent policy columns below differ. Each result is written as a new
            immutable run with checkpoints enabled.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-xs text-slate-600 md:col-span-2">
              Experiment ID
              <input
                className={INPUT}
                value={values.experimentId}
                onChange={(event) => setShared('experimentId', event.target.value)}
              />
              <span className="mt-1 block text-[10px] text-slate-400">
                Run IDs are exactly this value plus -a and -b. Submitted IDs are immutable.
              </span>
            </label>
            <label className="text-xs text-slate-600">
              Scenario pack
              <select
                className={INPUT}
                value={values.scenarioFile}
                onChange={(event) => setShared('scenarioFile', event.target.value)}
              >
                {packOptions.map((file) => (
                  <option key={file} value={file}>
                    {file}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Task ID
              <input
                className={INPUT}
                value={values.scenarioId}
                onChange={(event) => setShared('scenarioId', event.target.value)}
                placeholder="s-refund-00"
              />
            </label>
            <label className="text-xs text-slate-600 md:col-span-2">
              Matched seeds
              <input
                className={INPUT}
                value={values.seeds}
                onChange={(event) => setShared('seeds', event.target.value)}
                placeholder="1, 2, 3"
              />
            </label>
            <label className="text-xs text-slate-600">
              Run kind
              <select
                className={INPUT}
                value={values.runKind}
                onChange={(event) =>
                  setShared('runKind', event.target.value as ExperimentMatrixValues['runKind'])
                }
              >
                <option value="debug">Debug</option>
                <option value="counterfactual">Counterfactual</option>
              </select>
              <span className="mt-1 block text-[10px] text-slate-400">
                Experiment matrices never enter scored aggregates.
              </span>
            </label>
            <label className="text-xs text-slate-600">
              State scope
              <select
                className={INPUT}
                value={values.stateScope}
                onChange={(event) =>
                  setShared(
                    'stateScope',
                    event.target.value as ExperimentMatrixValues['stateScope'],
                  )
                }
              >
                <option value="episode">Episode</option>
                <option value="journey">Journey</option>
              </select>
            </label>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <VariantCard
            label="A"
            values={values.a}
            onChange={(key, value) => setVariant('a', key, value)}
          />
          <VariantCard
            label="B"
            values={values.b}
            onChange={(key, value) => setVariant('b', key, value)}
          />
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Shared harness, budget, and faults
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-xs text-slate-600">
              Max messages
              <input
                type="number"
                min="2"
                max="500"
                className={INPUT}
                value={values.maxMessages}
                onChange={(event) => setShared('maxMessages', event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-600">
              Per-run cost cap (USD)
              <input
                type="number"
                min="0.01"
                max="100000"
                step="0.25"
                className={INPUT}
                value={values.costCapUsd}
                onChange={(event) => setShared('costCapUsd', event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-600">
              Latent refund block
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                className={INPUT}
                value={values.latentRefundBlockRate}
                onChange={(event) => setShared('latentRefundBlockRate', event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-600">
              Write fail-before
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                className={INPUT}
                value={values.toolFailBeforeRate}
                onChange={(event) => setShared('toolFailBeforeRate', event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-600">
              Response-lost
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                className={INPUT}
                value={values.toolResponseLostRate}
                onChange={(event) => setShared('toolResponseLostRate', event.target.value)}
              />
            </label>
          </div>
        </section>

        {preview.ok && preview.plan.identicalVariants && (
          <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
            A and B currently have identical policy settings. The pair is valid for replication, but
            it does not isolate a policy change.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">
            Maximum authorized spend is two independent caps; launching never edits an existing
            trace or run.
          </p>
          <button
            type="button"
            disabled={!available || pending || alreadySubmitted}
            onClick={() => void launchPair()}
            className="ml-auto rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending
              ? 'Launching matched pair…'
              : alreadySubmitted
                ? 'Experiment ID submitted'
                : 'Launch matched A/B'}
          </button>
        </div>

        {validationError && (
          <p role="alert" className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
            {validationError}
          </p>
        )}

        {launch && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Experiment launch</h2>
            <p className="mt-1 font-mono text-xs text-slate-500">{launch.experimentId}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {launch.a && (
                <Link
                  to={`/ace?run=${encodeURIComponent(launch.a)}`}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-blue-700 hover:bg-slate-50"
                >
                  Open run A · {launch.a}
                </Link>
              )}
              {launch.b && (
                <Link
                  to={`/ace?run=${encodeURIComponent(launch.b)}`}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-blue-700 hover:bg-slate-50"
                >
                  Open run B · {launch.b}
                </Link>
              )}
              {launch.a && launch.b && (
                <Link
                  to={experimentCompareHref({ a: launch.a, b: launch.b }, launch.instanceId)}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Compare matched results →
                </Link>
              )}
            </div>
            {launch.errors.map((error) => (
              <p key={error} role="alert" className="mt-2 text-xs text-red-700">
                {error}
              </p>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
