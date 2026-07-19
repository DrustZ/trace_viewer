import { decodeFilterSet, encodeFilterSet } from '@shared/filter/parse'
import { useState } from 'react'
import { type ListParams, useTiles } from '../../../api/hooks'
import type { ListParamKey } from '../../../state/filterParams'
import { formatNumber, formatScore } from '../../common/format'

/**
 * Known training runs, in corpus order. Static and time-boxed: the generator
 * produces exactly these under data/runs. `imported` is the catch-all bucket
 * for traces imported via the dialog / drag-and-drop; it only renders when it
 * actually holds traces.
 */
const KNOWN_RUNS = ['run-a', 'run-b', 'run-c', 'run-d'] as const
const IMPORTED_RUN = 'imported'
const ALL_RUNS = [...KNOWN_RUNS, IMPORTED_RUN]

/** A filter scoped to a single run — used both to count a row and to load it. */
function runFilter(run: string): ListParams {
  return {
    filters: encodeFilterSet({ conditions: [{ key: 'run', op: 'eq', value: run }] }) || undefined,
  }
}

/** The currently loaded run, i.e. the single `run.eq.<run>` condition if any. */
function runFromFilters(filters: string | undefined): string {
  const cond = decodeFilterSet(filters).conditions.find((c) => c.key === 'run' && c.op === 'eq')
  return cond && !Array.isArray(cond.value) ? String(cond.value) : ''
}

/** One run row: name + trace count + avg score. Counts always reflect the full
 * run (own filter), not the current selection, so the list mirrors the corpus. */
function RunRow({
  run,
  active,
  hideWhenEmpty,
  onSelect,
}: {
  run: string
  active: boolean
  hideWhenEmpty: boolean
  onSelect: (run: string) => void
}) {
  const tiles = useTiles(runFilter(run))
  const total = tiles.data?.total ?? 0
  const avg = tiles.data?.avgScore ?? null
  // The imported bucket is hidden until it holds traces; known runs always show.
  if (hideWhenEmpty && total === 0) return null

  return (
    <button
      type="button"
      data-testid={`run-row-${run}`}
      onClick={() => onSelect(run)}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium ${
        active ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      <span className="truncate">{run}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-slate-400">
        {formatNumber(total)}
        {avg !== null && (
          <>
            <span>·</span>
            {formatScore(avg)}
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
  const selectedRun = runFromFilters(params.filters)
  const q = filter.trim().toLowerCase()
  const runs = ALL_RUNS.filter((r) => q === '' || r.toLowerCase().includes(q))

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
        {runs.map((run) => (
          <RunRow
            key={run}
            run={run}
            active={selectedRun === run}
            hideWhenEmpty={run === IMPORTED_RUN}
            onSelect={selectRun}
          />
        ))}
        {runs.length === 0 && <p className="px-2 py-1 text-xs text-slate-400">No runs match.</p>}
      </div>
    </section>
  )
}
