import { decodeFilterSet, encodeFilterSet } from '@shared/filter/parse'
import { useState } from 'react'
import { type ListParams, type RunAggregate, useRuns } from '../../../api/hooks'
import type { ListParamKey } from '../../../state/filterParams'
import { formatNumber, formatScore } from '../../common/format'

/** The currently loaded run, i.e. the single `run.eq.<run>` condition if any. */
function runFromFilters(filters: string | undefined): string {
  const cond = decodeFilterSet(filters).conditions.find((c) => c.key === 'run' && c.op === 'eq')
  return cond && !Array.isArray(cond.value) ? String(cond.value) : ''
}

export interface RunOption extends RunAggregate {
  /** False only for a run preserved from a deep link while it is absent from the catalog. */
  discovered: boolean
}

/** Preserve a deep-linked selection while the catalog loads or after the run disappears. */
export function runOptions(items: readonly RunAggregate[], selectedRun: string): RunOption[] {
  const options = items.map((item) => ({ ...item, discovered: true }))
  if (selectedRun !== '' && !options.some((item) => item.run === selectedRun)) {
    options.push({ run: selectedRun, count: 0, avgScore: null, discovered: false })
  }
  return options.sort((a, b) => a.run.localeCompare(b.run))
}

/** One run row: name + trace count + avg score from the metadata catalog. */
function RunRow({
  option,
  active,
  onSelect,
}: {
  option: RunOption
  active: boolean
  onSelect: (run: string) => void
}) {
  return (
    <button
      type="button"
      data-testid={`run-row-${option.run}`}
      onClick={() => onSelect(option.run)}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium ${
        active ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      <span className="truncate">{option.run}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-slate-400">
        {option.discovered ? formatNumber(option.count) : '—'}
        {option.discovered && option.avgScore !== null && (
          <>
            <span>·</span>
            {formatScore(option.avgScore)}
          </>
        )}
      </span>
    </button>
  )
}

/**
 * Flat RUNS list (file-explorer feel). Clicking a row loads that run
 * (`run.eq.<run>`, single-select); clicking the active row clears it. The input
 * is a local substring filter over run names only — component filtering lives in
 * the filters section below.
 */
export function RunTree({
  params,
  setParam,
}: {
  params: ListParams
  setParam: (key: ListParamKey, value: string | undefined) => void
}) {
  const [filter, setFilter] = useState('')
  const catalog = useRuns()
  const selectedRun = runFromFilters(params.filters)
  const q = filter.trim().toLowerCase()
  const runs = runOptions(catalog.data?.items ?? [], selectedRun).filter(
    (item) => q === '' || item.run.toLowerCase().includes(q),
  )

  const selectRun = (run: string) => {
    const others = decodeFilterSet(params.filters).conditions.filter(
      (c) => !(c.key === 'run' && c.op === 'eq'),
    )
    const next =
      run === selectedRun ? others : [...others, { key: 'run', op: 'eq' as const, value: run }]
    setParam('filters', encodeFilterSet({ conditions: next }) || undefined)
  }

  return (
    <section data-testid="runs-list" className="flex flex-col gap-1.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Runs</h2>
      <input
        type="text"
        data-testid="run-filter"
        aria-label="Filter runs"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="filter runs…"
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <div className="flex flex-col">
        {runs.map((option) => (
          <RunRow
            key={option.run}
            option={option}
            active={selectedRun === option.run}
            onSelect={selectRun}
          />
        ))}
        {catalog.isLoading && runs.length === 0 && (
          <p className="px-2 py-1 text-xs text-slate-400">Loading runs…</p>
        )}
        {catalog.isError && runs.length === 0 && (
          <p className="px-2 py-1 text-xs text-red-600">Could not load runs.</p>
        )}
        {!catalog.isLoading && !catalog.isError && runs.length === 0 && (
          <p className="px-2 py-1 text-xs text-slate-400">No runs match.</p>
        )}
      </div>
    </section>
  )
}
