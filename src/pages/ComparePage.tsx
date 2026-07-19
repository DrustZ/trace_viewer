import { encodeFilterSet } from '@shared/filter/parse'
import type { Message, Trace, TraceSummary } from '@shared/schema/types'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTrace, useTraces } from '../api/hooks'
import { formatScore } from '../components/common/format'
import { MarkdownContent } from '../components/common/MarkdownContent'
import { ScoreBadge } from '../components/common/ScoreBadge'

const RUNS = ['run-a', 'run-b'] as const

const INPUT_CLASS =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400'

interface StepRow {
  step: number
  count: number
  avgScore: number | null
  best: TraceSummary
}

/** Groups one run's rollouts of an instance by checkpoint step, best rollout = highest score. */
export function buildStepRows(items: readonly TraceSummary[]): StepRow[] {
  const byStep = new Map<number, TraceSummary[]>()
  for (const s of items) {
    const group = byStep.get(s.meta.checkpointStep)
    if (group) group.push(s)
    else byStep.set(s.meta.checkpointStep, [s])
  }
  return [...byStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, group]) => {
      const scores = group.map((s) => s.stats.score).filter((v): v is number => v !== null)
      const best = group.reduce((acc, s) =>
        (s.stats.score ?? Number.NEGATIVE_INFINITY) > (acc.stats.score ?? Number.NEGATIVE_INFINITY)
          ? s
          : acc,
      )
      return {
        step,
        count: group.length,
        avgScore: scores.length > 0 ? scores.reduce((a, v) => a + v, 0) / scores.length : null,
        best,
      }
    })
}

function finalAssistantMessage(trace: Trace): Message | undefined {
  for (let i = trace.messages.length - 1; i >= 0; i--) {
    const m = trace.messages[i]
    if (m.role === 'assistant' && (m.channel === undefined || m.channel === 'final')) return m
  }
  return undefined
}

function instanceRunFilters(instance: string, run: string): string {
  return encodeFilterSet({
    conditions: [
      { key: 'instanceId', op: 'eq', value: instance },
      { key: 'run', op: 'eq', value: run },
    ],
  })
}

function itemsOf(data: unknown): TraceSummary[] {
  return data && typeof data === 'object' && 'items' in data
    ? (data as { items: TraceSummary[] }).items
    : []
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-xs text-slate-400">
      {children}
    </p>
  )
}

function StepTable({ rows }: { rows: StepRow[] }) {
  return (
    <table className="w-full border-collapse text-xs" data-testid="compare-step-table">
      <thead>
        <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-400">
          <th className="py-1 pr-2 font-medium">Step</th>
          <th className="py-1 pr-2 font-medium">Rollouts</th>
          <th className="py-1 pr-2 font-medium">Avg score</th>
          <th className="py-1 font-medium">Best</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.step} className="border-b border-slate-100">
            <td className="py-1 pr-2 font-mono tabular-nums text-slate-700">{r.step}</td>
            <td className="py-1 pr-2 tabular-nums text-slate-600">{r.count}</td>
            <td className="py-1 pr-2 font-mono tabular-nums text-slate-700">
              {formatScore(r.avgScore)}
            </td>
            <td className="py-1">
              <Link
                to={`/trace/${encodeURIComponent(r.best.meta.traceId)}`}
                className="text-blue-600 hover:underline"
              >
                <ScoreBadge score={r.best.stats.score} />
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FinalOutputCard({
  run,
  step,
  summary,
}: {
  run: string
  step: number
  summary: TraceSummary | undefined
}) {
  const trace = useTrace(summary?.meta.traceId)
  if (!summary) return <Note>No rollout for {run} at this step.</Note>
  const final = trace.data ? finalAssistantMessage(trace.data) : undefined
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3"
      data-testid={`final-output-${run}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">{run}</span>
        <span>step {step}</span>
        <ScoreBadge score={summary.stats.score} />
        <Link
          to={`/trace/${encodeURIComponent(summary.meta.traceId)}`}
          className="ml-auto text-blue-600 hover:underline"
        >
          Open trace →
        </Link>
      </div>
      {trace.isLoading && <p className="text-xs text-slate-400">Loading final output…</p>}
      {trace.isError && <p className="text-xs text-red-600">Failed to load trace.</p>}
      {trace.data &&
        (final && final.content.length > 0 ? (
          <MarkdownContent text={final.content} />
        ) : (
          <p className="text-xs text-slate-400 italic">No final assistant output.</p>
        ))}
    </div>
  )
}

/**
 * Cross-run comparison: pick an instance shared by two runs, see reward-by-step
 * per run side by side, plus the final output of the best rollout at the last
 * step both runs evaluated.
 */
export default function ComparePage() {
  const [search, setSearch] = useSearchParams()
  const instance = search.get('instance') ?? ''
  const runA = search.get('runA') ?? 'run-a'
  const runB = search.get('runB') ?? 'run-b'
  const [instanceInput, setInstanceInput] = useState(instance)

  const setQP = (key: string, value: string) => {
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === '') next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )
  }

  // Instance picker options: distinct instanceIds from a broad summaries query.
  const allTraces = useTraces({ limit: 500 })
  const instanceOptions = useMemo(
    () => [...new Set(itemsOf(allTraces.data).map((s) => s.meta.instanceId))].sort(),
    [allTraces.data],
  )

  const queryA = useTraces(
    instance === '' ? { limit: 0 } : { filters: instanceRunFilters(instance, runA), limit: 200 },
  )
  const queryB = useTraces(
    instance === '' ? { limit: 0 } : { filters: instanceRunFilters(instance, runB), limit: 200 },
  )
  const rowsA = useMemo(() => buildStepRows(itemsOf(queryA.data)), [queryA.data])
  const rowsB = useMemo(() => buildStepRows(itemsOf(queryB.data)), [queryB.data])

  const stepsB = new Set(rowsB.map((r) => r.step))
  const commonSteps = rowsA.map((r) => r.step).filter((s) => stepsB.has(s))
  const lastCommonStep = commonSteps.length > 0 ? commonSteps[commonSteps.length - 1] : undefined
  // Runs sample different checkpoint grids, so a shared step may not exist —
  // fall back to each run's own latest step to keep the comparison useful.
  const stepA = lastCommonStep ?? rowsA[rowsA.length - 1]?.step
  const stepB = lastCommonStep ?? rowsB[rowsB.length - 1]?.step
  const bestA = rowsA.find((r) => r.step === stepA)?.best
  const bestB = rowsB.find((r) => r.step === stepB)?.best

  const commitInstance = (value: string) => {
    setInstanceInput(value)
    setQP('instance', value.trim())
  }

  const loading = instance !== '' && (queryA.isLoading || queryB.isLoading)

  const runSelect = (label: string, value: string, key: 'runA' | 'runB') => (
    <label className="flex items-center gap-1 text-xs text-slate-500">
      {label}
      <select
        className={INPUT_CLASS}
        data-testid={`select-${key}`}
        value={value}
        onChange={(e) => setQP(key, e.target.value)}
      >
        {RUNS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </label>
  )

  const column = (run: string, rows: StepRow[], testId: string) => (
    <section className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <h2 className="text-sm font-semibold text-slate-700">{run}</h2>
      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <Note>No traces for {run} on this instance.</Note>
      ) : (
        <StepTable rows={rows} />
      )}
    </section>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-4">
        <header className="flex flex-wrap items-center gap-3">
          <Link to="/" className="text-xs text-blue-600 hover:underline">
            ← Traces
          </Link>
          <h1 className="text-base font-semibold text-slate-900">Compare runs</h1>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {runSelect('A', runA, 'runA')}
            {runSelect('B', runB, 'runB')}
          </div>
        </header>

        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Instance
          <input
            type="text"
            list="compare-instances"
            data-testid="compare-instance-input"
            value={instanceInput}
            onChange={(e) => {
              const v = e.target.value
              // Datalist picks commit immediately; typing commits on Enter/blur.
              if (instanceOptions.includes(v)) commitInstance(v)
              else setInstanceInput(v)
            }}
            onBlur={() => commitInstance(instanceInput)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitInstance(instanceInput)
            }}
            placeholder="instance id, e.g. leetcode-i01"
            className={`${INPUT_CLASS} w-full max-w-md normal-case`}
          />
          <datalist id="compare-instances">
            {instanceOptions.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>

        {instance === '' ? (
          <Note>Pick an instance above to compare its rollouts across runs.</Note>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
              {column(runA, rowsA, 'compare-col-a')}
              {column(runB, rowsB, 'compare-col-b')}
            </div>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-slate-700">
                Final output — best rollout
                {lastCommonStep !== undefined
                  ? ` @ last common step ${lastCommonStep}`
                  : " @ each run's latest step (no common checkpoint)"}
              </h2>
              {loading ? (
                <p className="text-xs text-slate-400">Loading…</p>
              ) : stepA === undefined && stepB === undefined ? (
                <Note>Neither run has rollouts for this instance.</Note>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {stepA !== undefined ? (
                    <FinalOutputCard run={runA} step={stepA} summary={bestA} />
                  ) : (
                    <Note>No rollouts for {runA}.</Note>
                  )}
                  {stepB !== undefined ? (
                    <FinalOutputCard run={runB} step={stepB} summary={bestB} />
                  ) : (
                    <Note>No rollouts for {runB}.</Note>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
