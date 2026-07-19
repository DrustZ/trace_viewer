import { encodeFilterSet } from '@shared/filter/parse'
import type { Message, Trace, TraceSummary } from '@shared/schema/types'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTrace, useTraces } from '../api/hooks'
import { formatScore } from '../components/common/format'
import { MarkdownContent } from '../components/common/MarkdownContent'
import { ScoreBadge } from '../components/common/ScoreBadge'

const RUNS = ['run-a', 'run-b'] as const

const INSTANCE_SCAN_LIMIT = 5000
const PER_RUN_LIMIT = 1000

const PARTIAL_TOOLTIP = 'partial: computed on the loaded subset only'

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

// Alignment of one checkpoint step across the two runs. Dataset/revision
// mismatch classes from the reference project don't apply here — our runs share
// the generator schema, so 'matched' / 'A only' / 'B only' covers every case.
type AlignState = 'matched' | 'A only' | 'B only'

interface AlignedRow {
  step: number
  a: StepRow | undefined
  b: StepRow | undefined
  state: AlignState
}

export function alignStepRows(rowsA: StepRow[], rowsB: StepRow[]): AlignedRow[] {
  const byStepA = new Map(rowsA.map((r) => [r.step, r]))
  const byStepB = new Map(rowsB.map((r) => [r.step, r]))
  const steps = [...new Set([...byStepA.keys(), ...byStepB.keys()])].sort((x, y) => x - y)
  return steps.map((step) => {
    const a = byStepA.get(step)
    const b = byStepB.get(step)
    return { step, a, b, state: a && b ? 'matched' : a ? 'A only' : 'B only' }
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

function totalOf(data: unknown): number {
  return data && typeof data === 'object' && 'total' in data
    ? Number((data as { total: unknown }).total)
    : 0
}

/**
 * A derived number (avg/best/delta). Under a partial load every value gets a
 * '≈' prefix and a 'partial' tooltip — never a clean-looking number.
 */
function DerivedScore({
  value,
  partial,
  signed = false,
}: {
  value: number | null
  partial: boolean
  signed?: boolean
}) {
  if (value === null) return <span className="text-slate-400">—</span>
  const text = `${signed && value >= 0 ? '+' : ''}${formatScore(value)}`
  return (
    <span
      className="font-mono tabular-nums text-slate-700"
      title={partial ? PARTIAL_TOOLTIP : undefined}
    >
      {partial ? '≈' : ''}
      {text}
    </span>
  )
}

/** '≈' marker for badge-like derived values (best rollout scores) under partial data. */
function ApproxMark({ partial }: { partial: boolean }) {
  if (!partial) return null
  return (
    <span className="text-slate-500" title={PARTIAL_TOOLTIP}>
      ≈
    </span>
  )
}

/** Amber warning when the server holds more rollouts than the capped fetch returned. */
function TruncationNote({ shown, total, label }: { shown: number; total: number; label?: string }) {
  if (!(total > shown)) return null
  return (
    <p
      data-testid="truncation-note"
      className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800"
    >
      {label ? `${label}: ` : ''}showing first {shown} of {total} rollouts
    </p>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-xs text-slate-400">
      {children}
    </p>
  )
}

function OnlyTag({ run }: { run: string }) {
  return (
    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
      only in {run}
    </span>
  )
}

function BestCell({ row, partial }: { row: StepRow | undefined; partial: boolean }) {
  if (!row) return <span className="text-slate-400">—</span>
  return (
    <span className="inline-flex items-center gap-0.5">
      <ApproxMark partial={partial} />
      <Link
        to={`/trace/${encodeURIComponent(row.best.meta.traceId)}`}
        className="text-blue-600 hover:underline"
      >
        <ScoreBadge score={row.best.stats.score} />
      </Link>
    </span>
  )
}

/**
 * One table over the union of checkpoint steps: matched steps show both sides
 * plus Δ (B−A); one-sided steps get an 'only in run-X' tag instead of implying
 * a zero on the missing side.
 */
function AlignedStepTable({
  rows,
  runA,
  runB,
  partial,
}: {
  rows: AlignedRow[]
  runA: string
  runB: string
  partial: boolean
}) {
  const sideCells = (side: StepRow | undefined) => (
    <>
      <td className="py-1 pr-2 tabular-nums text-slate-600">
        {side ? side.count : <span className="text-slate-400">—</span>}
      </td>
      <td className="py-1 pr-2">
        {side ? (
          <DerivedScore value={side.avgScore} partial={partial} />
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="py-1 pr-2">
        <BestCell row={side} partial={partial} />
      </td>
    </>
  )
  return (
    <table className="w-full border-collapse text-xs" data-testid="compare-step-table">
      <thead>
        <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-400">
          <th className="py-1 pr-2 font-medium">Step</th>
          <th className="py-1 pr-2 font-medium">Match</th>
          <th className="py-1 pr-2 font-medium">A rollouts</th>
          <th className="py-1 pr-2 font-medium">A avg</th>
          <th className="py-1 pr-2 font-medium">A best</th>
          <th className="py-1 pr-2 font-medium">B rollouts</th>
          <th className="py-1 pr-2 font-medium">B avg</th>
          <th className="py-1 pr-2 font-medium">B best</th>
          <th className="py-1 font-medium normal-case">Δ avg (B−A)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          // Δ is defined as B − A, only when both sides have a graded avg.
          const delta =
            r.state === 'matched' && r.a?.avgScore != null && r.b?.avgScore != null
              ? r.b.avgScore - r.a.avgScore
              : null
          return (
            <tr key={r.step} className="border-b border-slate-100" data-align={r.state}>
              <td className="py-1 pr-2 font-mono tabular-nums text-slate-700">{r.step}</td>
              <td className="py-1 pr-2">
                {r.state === 'matched' ? (
                  <span className="text-[10px] text-slate-400">matched</span>
                ) : (
                  <OnlyTag run={r.state === 'A only' ? runA : runB} />
                )}
              </td>
              {sideCells(r.a)}
              {sideCells(r.b)}
              <td className="py-1">
                <DerivedScore value={delta} partial={partial} signed />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function FinalOutputCard({
  run,
  step,
  summary,
  partial,
}: {
  run: string
  step: number
  summary: TraceSummary | undefined
  partial: boolean
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
        <ApproxMark partial={partial} />
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
  const allTraces = useTraces({ limit: INSTANCE_SCAN_LIMIT })
  const instanceOptions = useMemo(
    () => [...new Set(itemsOf(allTraces.data).map((s) => s.meta.instanceId))].sort(),
    [allTraces.data],
  )

  const queryA = useTraces(
    instance === ''
      ? { limit: 0 }
      : { filters: instanceRunFilters(instance, runA), limit: PER_RUN_LIMIT },
  )
  const queryB = useTraces(
    instance === ''
      ? { limit: 0 }
      : { filters: instanceRunFilters(instance, runB), limit: PER_RUN_LIMIT },
  )
  const rowsA = useMemo(() => buildStepRows(itemsOf(queryA.data)), [queryA.data])
  const rowsB = useMemo(() => buildStepRows(itemsOf(queryB.data)), [queryB.data])

  // Honest-partial bookkeeping: the fetches above are capped, so track what the
  // server says exists (total) vs. what we actually loaded per side.
  const loadedA = itemsOf(queryA.data).length
  const loadedB = itemsOf(queryB.data).length
  const totalA = totalOf(queryA.data)
  const totalB = totalOf(queryB.data)
  const completeA = loadedA >= totalA
  const completeB = loadedB >= totalB
  const partial = instance !== '' && (!completeA || !completeB)

  const aligned = useMemo(() => alignStepRows(rowsA, rowsB), [rowsA, rowsB])

  const matchedSteps = aligned.filter((r) => r.state === 'matched').map((r) => r.step)
  const lastMatchedStep =
    matchedSteps.length > 0 ? matchedSteps[matchedSteps.length - 1] : undefined
  // Runs sample different checkpoint grids, so a shared step may not exist —
  // fall back to each run's own latest step to keep the comparison useful.
  const stepA = lastMatchedStep ?? rowsA[rowsA.length - 1]?.step
  const stepB = lastMatchedStep ?? rowsB[rowsB.length - 1]?.step
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
          <span className="font-normal normal-case tracking-normal text-slate-500">
            {instanceOptions.length} instances discovered (first {INSTANCE_SCAN_LIMIT} scanned) ·
            compares the two runs' policy checkpoints step by step · best rollout = highest score at
            the latest matched step
          </span>
        </label>

        <TruncationNote
          shown={itemsOf(allTraces.data).length}
          total={totalOf(allTraces.data)}
          label="instance list may be incomplete"
        />

        {instance === '' ? (
          <Note>Pick an instance above to compare its rollouts across runs.</Note>
        ) : (
          <>
            {partial && !loading && (
              <p
                data-testid="partial-banner"
                className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
              >
                Partial comparison — showing {loadedA} of {totalA} (A) / {loadedB} of {totalB} (B);
                aggregates below are computed on the loaded subset only
              </p>
            )}

            <section
              className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3"
              data-testid="compare-aligned"
            >
              <h2 className="text-sm font-semibold text-slate-700">
                {runA} (A) vs {runB} (B) by checkpoint step
              </h2>
              {loading ? (
                <p className="text-xs text-slate-400">Loading…</p>
              ) : aligned.length === 0 ? (
                <Note>No traces for either run on this instance.</Note>
              ) : (
                <AlignedStepTable rows={aligned} runA={runA} runB={runB} partial={partial} />
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-slate-700">
                Final output — best rollout
                {lastMatchedStep !== undefined
                  ? ` @ last matched step ${lastMatchedStep}`
                  : " @ each run's latest step (no matched checkpoint)"}
              </h2>
              {loading ? (
                <p className="text-xs text-slate-400">Loading…</p>
              ) : stepA === undefined && stepB === undefined ? (
                <Note>Neither run has rollouts for this instance.</Note>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {stepA !== undefined ? (
                    <FinalOutputCard run={runA} step={stepA} summary={bestA} partial={partial} />
                  ) : (
                    <Note>No rollouts for {runA}.</Note>
                  )}
                  {stepB !== undefined ? (
                    <FinalOutputCard run={runB} step={stepB} summary={bestB} partial={partial} />
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
