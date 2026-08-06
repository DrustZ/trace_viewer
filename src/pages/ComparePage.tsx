import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useRunInstances, useRuns } from '../api/hooks'
import { EmptyState } from '../components/common/EmptyState'
import { DualEvolutionChart } from '../components/compare/DualEvolutionChart'
import { RunColumn } from '../components/compare/RunColumn'
import { CollapsibleSection } from '../components/home/CollapsibleSection'

const INSTANCE_RESULT_LIMIT = 200

const INPUT_CLASS =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400'

/** Keep deep-linked runs selectable while the catalog is loading or no longer contains them. */
export function selectableRuns(
  discovered: readonly string[],
  selected: readonly string[],
): string[] {
  return [...new Set([...discovered, ...selected.filter(Boolean)])].sort()
}

export interface CompareRuns {
  runA: string
  runB: string
}

/** Resolve missing run params deterministically while preserving every explicit deep-link value. */
export function resolveCompareRuns(
  discovered: readonly string[],
  selectedA: string | null | undefined,
  selectedB: string | null | undefined,
): CompareRuns {
  const explicitA = selectedA || undefined
  const explicitB = selectedB || undefined
  const ordered = [...new Set(discovered.filter(Boolean))].sort()
  const runA = explicitA ?? ordered.find((run) => run !== explicitB) ?? explicitB ?? ''
  const runB = explicitB ?? ordered.find((run) => run !== runA) ?? runA
  return { runA, runB }
}

/** Fill missing run params without touching any explicit value or other shareable state. */
export function materializeCompareRuns(
  search: URLSearchParams,
  discovered: readonly string[],
): URLSearchParams {
  const next = new URLSearchParams(search)
  const { runA, runB } = resolveCompareRuns(discovered, next.get('runA'), next.get('runB'))
  if (!next.get('runA') && runA !== '') next.set('runA', runA)
  if (!next.get('runB') && runB !== '') next.set('runB', runB)
  return next
}

/**
 * Diff-style cross-run view: pick an instance, overlay both runs' reward curves,
 * then browse each run's rollouts + full message view side by side. All state
 * (instance, runs, selected trace per side) lives in the URL for sharing.
 */
export default function ComparePage() {
  const [search, setSearch] = useSearchParams()
  const instance = search.get('instance') ?? ''
  const traceA = search.get('traceA') ?? ''
  const traceB = search.get('traceB') ?? ''
  const [instanceInput, setInstanceInput] = useState(instance)

  const runCatalog = useRuns()
  const discoveredRuns = useMemo(
    () => runCatalog.data?.items.map((item) => item.run) ?? [],
    [runCatalog.data?.items],
  )
  const runAParam = search.get('runA')
  const runBParam = search.get('runB')
  const { runA, runB } = resolveCompareRuns(discoveredRuns, runAParam, runBParam)
  const runOptions = selectableRuns(discoveredRuns, [runA, runB])
  const deferredInstanceInput = useDeferredValue(instanceInput)
  const instances = useRunInstances(
    [runA, runB],
    deferredInstanceInput,
    INSTANCE_RESULT_LIMIT,
    runCatalog.data?.dataVersion,
  )
  const instanceOptions = instances.data?.items ?? []

  useEffect(() => setInstanceInput(instance), [instance])

  // Freeze catalog-derived defaults into the shareable URL once. Subsequent
  // progressive-scan updates cannot silently change the runs being compared.
  useEffect(() => {
    const missingA = !runAParam
    const missingB = !runBParam
    if (runCatalog.data === undefined || (!missingA && !missingB) || runA === '' || runB === '') {
      return
    }
    setSearch((prev) => materializeCompareRuns(prev, discoveredRuns), { replace: true })
  }, [runAParam, runBParam, runA, runB, discoveredRuns, runCatalog.data, setSearch])

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
        disabled={runOptions.length === 0}
        onChange={(e) => setQP({ [key]: e.target.value, [clear]: '' })}
      >
        {runOptions.length === 0 && <option value="">No runs</option>}
        {runOptions.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="h-screen overflow-hidden bg-slate-50">
      <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 px-5 py-4">
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
            {instances.isFetching
              ? 'Searching instances…'
              : `${instances.data?.total ?? 0} matching instances`}
            {(instances.data?.total ?? 0) > instanceOptions.length
              ? ` · showing first ${instanceOptions.length}`
              : ''}{' '}
            · diff an instance across two runs
          </span>
        </label>

        {runA === '' || runB === '' ? (
          <EmptyState
            title={runCatalog.isLoading ? 'Loading runs' : 'No runs available'}
            hint="Load or import traces before comparing runs."
          />
        ) : instance === '' ? (
          <EmptyState
            title="Pick an instance to compare"
            hint="Choose an instance above to overlay both runs' reward curves and browse rollouts side by side."
          />
        ) : (
          <>
            <div className="shrink-0">
              {/* Collapsed by default so the two trace views get the full height;
                  the state persists per-id, and it's one click to compare curves. */}
              <CollapsibleSection
                id="compare-curves"
                title="Reward curves — A vs B"
                defaultOpen={false}
              >
                <DualEvolutionChart instanceId={instance} runA={runA} runB={runB} />
              </CollapsibleSection>
            </div>
            <div className="flex min-h-0 flex-1 gap-4">
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
