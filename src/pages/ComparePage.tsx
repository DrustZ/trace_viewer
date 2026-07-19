import type { TraceSummary } from '@shared/schema/types'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTraces } from '../api/hooks'
import { EmptyState } from '../components/common/EmptyState'
import { DualEvolutionChart } from '../components/compare/DualEvolutionChart'
import { RunColumn } from '../components/compare/RunColumn'
import { CollapsibleSection } from '../components/home/CollapsibleSection'

const INSTANCE_SCAN_LIMIT = 5000
// Fallback when the corpus scan yields no distinct extra.run values.
const DEFAULT_RUNS = ['run-a', 'run-b'] as const

const INPUT_CLASS =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400'

function itemsOf(data: unknown): TraceSummary[] {
  return data && typeof data === 'object' && 'items' in data
    ? (data as { items: TraceSummary[] }).items
    : []
}
function totalOf(data: unknown): number {
  return data && typeof data === 'object' && 'total' in data
    ? Number((data as { total: number }).total)
    : 0
}

/**
 * Diff-style cross-run view: pick an instance, overlay both runs' reward curves,
 * then browse each run's rollouts + full message view side by side. All state
 * (instance, runs, selected trace per side) lives in the URL for sharing.
 */
export default function ComparePage() {
  const [search, setSearch] = useSearchParams()
  const instance = search.get('instance') ?? ''
  const runA = search.get('runA') ?? DEFAULT_RUNS[0]
  const runB = search.get('runB') ?? DEFAULT_RUNS[1]
  const traceA = search.get('traceA') ?? ''
  const traceB = search.get('traceB') ?? ''
  const [instanceInput, setInstanceInput] = useState(instance)

  const setQP = (patch: Record<string, string>) => {
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(patch)) {
          if (value === '') next.delete(key)
          else next.set(key, value)
        }
        return next
      },
      { replace: true },
    )
  }

  // Distinct instanceIds + runs from a broad scan (used for the pickers).
  const allTraces = useTraces({ limit: INSTANCE_SCAN_LIMIT })
  const scanned = itemsOf(allTraces.data)
  const instanceOptions = useMemo(
    () => [...new Set(scanned.map((s) => s.meta.instanceId))].sort(),
    [scanned],
  )
  const runOptions = useMemo(() => {
    const runs = new Set<string>()
    for (const s of scanned) {
      const r = s.meta.extra?.run
      if (typeof r === 'string') runs.add(r)
    }
    return runs.size > 0 ? [...runs].sort() : [...DEFAULT_RUNS]
  }, [scanned])
  const scanPartial = totalOf(allTraces.data) > scanned.length

  const commitInstance = (value: string) => {
    const v = value.trim()
    setInstanceInput(v)
    // Switching instances invalidates the selected traces on both sides.
    setQP({ instance: v, traceA: '', traceB: '' })
  }

  const runSelect = (label: string, value: string, key: 'runA' | 'runB', clear: string) => (
    <label className="flex items-center gap-1 text-xs text-slate-500">
      {label}
      <select
        className={INPUT_CLASS}
        data-testid={`select-${key}`}
        value={value}
        onChange={(e) => setQP({ [key]: e.target.value, [clear]: '' })}
      >
        {runOptions.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4">
        <header className="flex flex-wrap items-center gap-3">
          <Link to="/" className="text-xs text-blue-600 hover:underline">
            ← Traces
          </Link>
          <h1 className="text-base font-semibold text-slate-900">Compare runs</h1>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {runSelect('A', runA, 'runA', 'traceA')}
            {runSelect('B', runB, 'runB', 'traceB')}
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
            placeholder="instance id, e.g. swebench-i01"
            className={`${INPUT_CLASS} w-full max-w-md normal-case`}
          />
          <datalist id="compare-instances">
            {instanceOptions.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          <span className="font-normal normal-case tracking-normal text-slate-500">
            {instanceOptions.length} instances discovered
            {scanPartial ? ` (first ${INSTANCE_SCAN_LIMIT} scanned — list may be partial)` : ''} ·
            diff an instance across two runs
          </span>
        </label>

        {instance === '' ? (
          <EmptyState
            title="Pick an instance to compare"
            hint="Choose an instance above to overlay both runs' reward curves and browse rollouts side by side."
          />
        ) : (
          <>
            <CollapsibleSection id="compare-curves" title="Reward curves — A vs B" defaultOpen>
              <DualEvolutionChart instanceId={instance} runA={runA} runB={runB} />
            </CollapsibleSection>
            <div className="grid grid-cols-2 gap-4">
              <RunColumn
                run={runA}
                instanceId={instance}
                selectedTraceId={traceA}
                onSelect={(id) => setQP({ traceA: id })}
              />
              <RunColumn
                run={runB}
                instanceId={instance}
                selectedTraceId={traceB}
                onSelect={(id) => setQP({ traceB: id })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
