import { decodeFilterSet, encodeFilterSet } from '@shared/filter/parse'
import type { ComponentAggregate } from '@shared/schema/types'
import { useMemo, useState } from 'react'
import { type ListParams, useComponentAggregates } from '../../../api/hooks'
import {
  type ListParamKey,
  type ListParamPatch,
  selectedComponents,
  toggleComponentPatch,
} from '../../../state/filterParams'
import { formatNumber, formatScore } from '../../common/format'

/** Known training runs. Static, time-boxed: the corpus is generated with exactly these. */
const RUNS = ['run-a', 'run-b']

interface CompNode {
  component: string
  count: number
  avgScore: number | null
}

function runFromFilters(filters: string | undefined): string {
  const cond = decodeFilterSet(filters).conditions.find((c) => c.key === 'run' && c.op === 'eq')
  return cond && !Array.isArray(cond.value) ? String(cond.value) : ''
}

/** Merge split-level aggregates into one node per component (count + weighted avgScore). */
function mergeComponents(aggregates: ComponentAggregate[]): CompNode[] {
  const byComponent = new Map<string, ComponentAggregate[]>()
  for (const a of aggregates) {
    const list = byComponent.get(a.component) ?? []
    list.push(a)
    byComponent.set(a.component, list)
  }
  return [...byComponent.entries()]
    .map(([component, rows]) => {
      const count = rows.reduce((s, r) => s + r.count, 0)
      let sum = 0
      let weight = 0
      for (const r of rows) {
        if (r.avgScore === null || r.count === 0) continue
        sum += r.avgScore * r.count
        weight += r.count
      }
      return { component, count, avgScore: weight === 0 ? null : sum / weight }
    })
    .sort((a, b) => a.component.localeCompare(b.component))
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** One run node (label + total + avg score) with its component children. */
function RunNode({
  run,
  filter,
  runSelected,
  selected,
  onSelectRun,
  onToggleComponent,
}: {
  run: string
  filter: string
  runSelected: boolean
  selected: ReadonlySet<string>
  onSelectRun: (run: string) => void
  onToggleComponent: (component: string) => void
}) {
  // Scope aggregates to this run only, so the tree always mirrors the full corpus.
  const runParams: ListParams = {
    filters: encodeFilterSet({ conditions: [{ key: 'run', op: 'eq', value: run }] }) || undefined,
  }
  const aggregates = useComponentAggregates(runParams)
  const nodes = useMemo(() => mergeComponents(aggregates.data ?? []), [aggregates.data])
  const [open, setOpen] = useState(true)

  const total = nodes.reduce((s, n) => s + n.count, 0)
  const avg = useMemo(() => {
    let sum = 0
    let weight = 0
    for (const n of nodes) {
      if (n.avgScore === null || n.count === 0) continue
      sum += n.avgScore * n.count
      weight += n.count
    }
    return weight === 0 ? null : sum / weight
  }, [nodes])

  const runMatches = filter === '' || run.toLowerCase().includes(filter)
  const children = runMatches
    ? nodes
    : nodes.filter((n) => n.component.toLowerCase().includes(filter))
  if (!runMatches && children.length === 0) return null

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded-md px-1 py-1 ${
          runSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
        }`}
      >
        <button
          type="button"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${run}`}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-slate-400 hover:text-slate-700"
        >
          <Chevron open={open} />
        </button>
        <button
          type="button"
          data-testid={`run-node-${run}`}
          onClick={() => onSelectRun(run)}
          className={`flex flex-1 items-center gap-1.5 truncate text-left text-xs font-medium ${
            runSelected ? 'text-blue-700' : 'text-slate-700'
          }`}
        >
          <span className="truncate">{run}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-slate-400">
            {formatNumber(total)}
            <span>·</span>
            {formatScore(avg)}
          </span>
        </button>
      </div>
      {open &&
        children.map((child) => {
          const isSelected = selected.has(child.component)
          const short = child.component.split('/').slice(1).join('/') || child.component
          return (
            <button
              key={child.component}
              type="button"
              data-testid={`run-component-${child.component}`}
              title={child.component}
              onClick={() => onToggleComponent(child.component)}
              className={`ml-5 flex w-[calc(100%-1.25rem)] items-center gap-1.5 rounded-md px-1 py-0.5 text-left ${
                isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
              }`}
            >
              <span
                className={`truncate text-xs ${isSelected ? 'text-blue-700' : 'text-slate-600'}`}
              >
                {short}
              </span>
              <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-400">
                {formatNumber(child.count)}
              </span>
            </button>
          )
        })}
    </div>
  )
}

/**
 * Run-directory browser: runs → components. Replaces the old global search box.
 * Clicking a run applies `run.eq.<run>`; clicking a component toggles it in the
 * filter selection. The top input is a local substring filter over the tree —
 * not full-text search.
 */
export function RunTree({
  params,
  setParam,
  setParams,
}: {
  params: ListParams
  setParam: (key: ListParamKey, value: string | undefined) => void
  setParams: (patch: ListParamPatch) => void
}) {
  const [filter, setFilter] = useState('')
  const selectedRun = runFromFilters(params.filters)
  const selected = useMemo(() => selectedComponents(params), [params])

  const selectRun = (run: string) => {
    const others = decodeFilterSet(params.filters).conditions.filter(
      (c) => !(c.key === 'run' && c.op === 'eq'),
    )
    const next =
      run === selectedRun ? others : [...others, { key: 'run', op: 'eq' as const, value: run }]
    setParam('filters', encodeFilterSet({ conditions: next }) || undefined)
  }

  const toggleComponent = (component: string) => setParams(toggleComponentPatch(params, component))

  return (
    <section data-testid="run-tree" className="flex flex-col gap-1.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Runs</h2>
      <input
        type="text"
        data-testid="run-tree-filter"
        aria-label="Filter runs"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="filter runs…"
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <div className="flex flex-col">
        {RUNS.map((run) => (
          <RunNode
            key={run}
            run={run}
            filter={filter.trim().toLowerCase()}
            runSelected={selectedRun === run}
            selected={selected}
            onSelectRun={selectRun}
            onToggleComponent={toggleComponent}
          />
        ))}
      </div>
    </section>
  )
}
