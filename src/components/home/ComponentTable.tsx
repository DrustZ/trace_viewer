import type { ComponentAggregate, Split } from '@shared/schema/types'
import { useMemo, useState } from 'react'
import { type ListParams, useComponentAggregates } from '../../api/hooks'
import { selectedComponents, toggleComponentPatch, useListParams } from '../../state/filterParams'
import { formatDuration, formatNumber, formatPercent, formatScore } from '../common/format'
import { useColumnWidths } from '../common/useColumnWidths'
import { Sparkline } from './Sparkline'

const DEFAULT_WIDTHS: Record<string, number> = { component: 240 }

type SplitMode = Split | 'all'

/** ComponentAggregate minus split — the shape after merging splits or rolling up a category. */
interface Row {
  component: string
  count: number
  completed: number
  failed: number
  executing: number
  unknown: number
  avgScore: number | null
  successRate: number | null
  truncatedRate: number
  avgTurns: number
  avgToolUses: number
  avgDurationMs: number | null
  avgOutputTokens: number
  avgThinkingTokens: number
  scoreByStep: Array<{ step: number; avgScore: number; count: number }>
}

interface CategoryGroup {
  category: string
  rollup: Row
  children: Row[]
}

function toRow(a: ComponentAggregate): Row {
  return { ...a }
}

function weightedMean(rows: Row[], value: (r: Row) => number | null): number | null {
  let sum = 0
  let weight = 0
  for (const r of rows) {
    const v = value(r)
    if (v === null || r.count === 0) continue
    sum += v * r.count
    weight += r.count
  }
  return weight === 0 ? null : sum / weight
}

function mergeScoreByStep(rows: Row[]): Row['scoreByStep'] {
  const byStep = new Map<number, { sum: number; count: number }>()
  for (const r of rows) {
    for (const p of r.scoreByStep) {
      const acc = byStep.get(p.step) ?? { sum: 0, count: 0 }
      acc.sum += p.avgScore * p.count
      acc.count += p.count
      byStep.set(p.step, acc)
    }
  }
  return [...byStep.entries()]
    .map(([step, { sum, count }]) => ({ step, avgScore: count === 0 ? 0 : sum / count, count }))
    .sort((a, b) => a.step - b.step)
}

/** Count-weighted merge, used both for All-splits rows and category rollups. */
function mergeRows(component: string, rows: Row[]): Row {
  return {
    component,
    count: rows.reduce((s, r) => s + r.count, 0),
    completed: rows.reduce((s, r) => s + r.completed, 0),
    failed: rows.reduce((s, r) => s + r.failed, 0),
    executing: rows.reduce((s, r) => s + r.executing, 0),
    unknown: rows.reduce((s, r) => s + r.unknown, 0),
    avgScore: weightedMean(rows, (r) => r.avgScore),
    successRate: weightedMean(rows, (r) => r.successRate),
    truncatedRate: weightedMean(rows, (r) => r.truncatedRate) ?? 0,
    avgTurns: weightedMean(rows, (r) => r.avgTurns) ?? 0,
    avgToolUses: weightedMean(rows, (r) => r.avgToolUses) ?? 0,
    avgDurationMs: weightedMean(rows, (r) => r.avgDurationMs),
    avgOutputTokens: weightedMean(rows, (r) => r.avgOutputTokens) ?? 0,
    avgThinkingTokens: weightedMean(rows, (r) => r.avgThinkingTokens) ?? 0,
    scoreByStep: mergeScoreByStep(rows),
  }
}

function buildGroups(aggregates: ComponentAggregate[], splitMode: SplitMode): CategoryGroup[] {
  let rows: Row[]
  if (splitMode === 'all') {
    const byComponent = new Map<string, ComponentAggregate[]>()
    for (const a of aggregates) {
      const list = byComponent.get(a.component) ?? []
      list.push(a)
      byComponent.set(a.component, list)
    }
    rows = [...byComponent.entries()].map(([component, list]) =>
      mergeRows(component, list.map(toRow)),
    )
  } else {
    rows = aggregates.filter((a) => a.split === splitMode).map(toRow)
  }

  const byCategory = new Map<string, Row[]>()
  for (const row of rows) {
    const category = row.component.split('/')[0]
    const list = byCategory.get(category) ?? []
    list.push(row)
    byCategory.set(category, list)
  }
  return [...byCategory.entries()]
    .map(([category, children]) => ({
      category,
      rollup: mergeRows(category, children),
      children: children.sort((a, b) => a.component.localeCompare(b.component)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category))
}

const NUM_CELL = 'px-2 py-1.5 text-right tabular-nums'

function MetricCells({ row }: { row: Row }) {
  return (
    <>
      <td className={NUM_CELL}>{formatNumber(row.count)}</td>
      <td className={NUM_CELL}>{formatNumber(row.completed)}</td>
      <td className={`${NUM_CELL} ${row.failed > 0 ? 'font-medium text-red-600' : ''}`}>
        {formatNumber(row.failed)}
      </td>
      <td className={NUM_CELL}>{formatNumber(row.executing)}</td>
      <td className={`${NUM_CELL} ${row.unknown > 0 ? 'font-medium text-amber-700' : ''}`}>
        {formatNumber(row.unknown)}
      </td>
      <td className={NUM_CELL}>{formatPercent(row.successRate)}</td>
      <td className={NUM_CELL}>{formatScore(row.avgScore)}</td>
      <td className={NUM_CELL}>{formatPercent(row.truncatedRate)}</td>
      <td className={NUM_CELL}>{row.avgTurns.toFixed(1)}</td>
      <td className={NUM_CELL}>{row.avgToolUses.toFixed(1)}</td>
      <td className={NUM_CELL}>{formatNumber(Math.round(row.avgOutputTokens))}</td>
      <td className={NUM_CELL}>{formatNumber(Math.round(row.avgThinkingTokens))}</td>
      <td className={NUM_CELL}>{formatDuration(row.avgDurationMs)}</td>
      <td className="px-2 py-1.5 text-right">
        <Sparkline points={row.scoreByStep} />
      </td>
    </>
  )
}

const HEADERS = [
  'Count',
  'Completed',
  'Failed',
  'In progress',
  'Unknown',
  'Success %',
  'Avg score',
  'Trunc %',
  'Avg turns',
  'Avg tools',
  'Out tok (avg)',
  'Think tok (avg)',
  'Avg duration',
  'Trend',
]

/**
 * Per-component performance table: category rollup rows (count-weighted across
 * children) expand into dataset rows; dataset click applies the component filter.
 */
export function ComponentTable({ params }: { params: ListParams }) {
  const aggregates = useComponentAggregates(params)
  const { setParams } = useListParams()
  const { widths, startResize, resetCol } = useColumnWidths('components', DEFAULT_WIDTHS)
  const nameWidth = widths.component ?? DEFAULT_WIDTHS.component
  const [splitMode, setSplitMode] = useState<SplitMode>('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // Active rows come from the decoded filters DSL (plus legacy ?component deep links).
  const selected = useMemo(() => selectedComponents(params), [params])

  const groups = useMemo(
    () => buildGroups(aggregates.data ?? [], splitMode),
    [aggregates.data, splitMode],
  )

  const isExpanded = (g: CategoryGroup) => expanded[g.category] ?? g.children.length === 1

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="flex rounded-md border border-slate-200 p-0.5">
          {(['train', 'test', 'unknown', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`component-split-${s}`}
              aria-pressed={splitMode === s}
              onClick={() => setSplitMode(s)}
              className={`rounded px-2 py-0.5 text-xs capitalize ${
                splitMode === s
                  ? 'bg-slate-100 font-medium text-slate-800'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-400">click a dataset row to filter</span>
      </div>
      {groups.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">
          {aggregates.isLoading
            ? 'Loading aggregates…'
            : 'No component aggregates for the current selection'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-xs" data-testid="component-table">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] text-slate-400">
                <th className="relative px-2 py-1.5 text-left font-medium">
                  <div className="truncate" style={{ width: nameWidth }}>
                    Component
                  </div>
                  <div
                    data-testid="col-resize-component"
                    aria-hidden="true"
                    title="Drag to resize · double-click to reset"
                    onPointerDown={(e) => startResize('component', e)}
                    onDoubleClick={() => resetCol('component')}
                    className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize touch-none hover:bg-blue-300"
                  />
                </th>
                {HEADERS.map((h) => (
                  <th key={h} className="px-2 py-1.5 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <CategoryRows
                  key={group.category}
                  group={group}
                  nameWidth={nameWidth}
                  open={isExpanded(group)}
                  selected={selected}
                  onToggle={() =>
                    setExpanded((prev) => ({ ...prev, [group.category]: !isExpanded(group) }))
                  }
                  // Same DSL helper the sidebar CategoryTree uses — toggle semantics preserved.
                  onSelect={(component) => setParams(toggleComponentPatch(params, component))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CategoryRows({
  group,
  nameWidth,
  open,
  selected,
  onToggle,
  onSelect,
}: {
  group: CategoryGroup
  nameWidth: number
  open: boolean
  selected: ReadonlySet<string>
  onToggle: () => void
  onSelect: (component: string) => void
}) {
  return (
    <>
      <tr
        data-testid={`component-category-${group.category}`}
        onClick={onToggle}
        className="cursor-pointer border-b border-slate-100 bg-slate-50/60 text-slate-700 hover:bg-slate-100"
      >
        <td className="px-2 py-1.5">
          <span className="flex items-center gap-1 font-medium" style={{ width: nameWidth }}>
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
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
            <span className="truncate">{group.category}</span>
            <span className="shrink-0 font-normal text-slate-400">({group.children.length})</span>
          </span>
        </td>
        <MetricCells row={group.rollup} />
      </tr>
      {open &&
        group.children.map((row) => {
          const active = selected.has(row.component)
          return (
            <tr
              key={row.component}
              data-testid={`component-row-${row.component}`}
              onClick={() => onSelect(row.component)}
              className={`cursor-pointer border-b border-slate-100 ${
                active ? 'bg-blue-50 text-blue-900' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <td className="py-1.5 pr-2 pl-8">
                <div className="truncate" style={{ width: nameWidth - 24 }} title={row.component}>
                  {row.component}
                </div>
              </td>
              <MetricCells row={row} />
            </tr>
          )
        })}
    </>
  )
}
