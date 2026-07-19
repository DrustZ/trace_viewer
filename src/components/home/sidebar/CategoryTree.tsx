import { decodeFilterSet, encodeFilterSet } from '@shared/filter/parse'
import type { FilterCondition } from '@shared/filter/types'
import type { ComponentAggregate } from '@shared/schema/types'
import { useMemo, useState } from 'react'
import { type ListParams, useComponentAggregates } from '../../../api/hooks'
import type { ListParamPatch } from '../../../state/filterParams'
import { formatNumber, formatScore } from '../../common/format'

interface Node {
  component: string
  count: number
  failed: number
  avgScore: number | null
}

interface Category {
  category: string
  rollup: Node
  children: Node[]
}

/** Merge split-level aggregates into one node per component, then group by category prefix. */
function buildCategories(aggregates: ComponentAggregate[]): Category[] {
  const byComponent = new Map<string, ComponentAggregate[]>()
  for (const a of aggregates) {
    const list = byComponent.get(a.component) ?? []
    list.push(a)
    byComponent.set(a.component, list)
  }
  const mergeNodes = (name: string, rows: Node[]): Node => {
    const count = rows.reduce((s, r) => s + r.count, 0)
    const failed = rows.reduce((s, r) => s + r.failed, 0)
    let sum = 0
    let weight = 0
    for (const r of rows) {
      if (r.avgScore === null || r.count === 0) continue
      sum += r.avgScore * r.count
      weight += r.count
    }
    return { component: name, count, failed, avgScore: weight === 0 ? null : sum / weight }
  }
  const nodes = [...byComponent.entries()].map(([component, rows]) => mergeNodes(component, rows))
  const byCategory = new Map<string, Node[]>()
  for (const node of nodes) {
    const category = node.component.split('/')[0] ?? node.component
    const list = byCategory.get(category) ?? []
    list.push(node)
    byCategory.set(category, list)
  }
  return [...byCategory.entries()]
    .map(([category, children]) => ({
      category,
      rollup: mergeNodes(category, children),
      children: children.sort((a, b) => a.component.localeCompare(b.component)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category))
}

/** Selected components = component conditions in the filters DSL plus the legacy ?component param. */
function selectedFrom(params: ListParams): Set<string> {
  const selected = new Set<string>()
  if (params.component) selected.add(params.component)
  for (const c of decodeFilterSet(params.filters).conditions) {
    if (c.key !== 'component') continue
    if (Array.isArray(c.value)) for (const v of c.value) selected.add(String(v))
    else if (c.op === 'eq') selected.add(String(c.value))
  }
  return selected
}

function MiniStats({ node }: { node: Node }) {
  const failedPct = node.count > 0 ? (node.failed / node.count) * 100 : 0
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-slate-400">
      {formatNumber(node.count)}
      <span>·</span>
      {formatScore(node.avgScore)}
      <span>·</span>
      <span className={node.failed > 0 ? 'font-medium text-red-600' : ''}>
        {failedPct.toFixed(0)}%
      </span>
    </span>
  )
}

export function CategoryTree({
  params,
  setParams,
}: {
  params: ListParams
  setParams: (patch: ListParamPatch) => void
}) {
  const aggregates = useComponentAggregates(params)
  const categories = useMemo(() => buildCategories(aggregates.data ?? []), [aggregates.data])
  const selected = useMemo(() => selectedFrom(params), [params])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const applySelection = (next: Set<string>) => {
    const others = decodeFilterSet(params.filters).conditions.filter((c) => c.key !== 'component')
    const values = [...next].sort()
    const conditions: FilterCondition[] = [...others]
    if (values.length === 1 && values[0] !== undefined) {
      conditions.push({ key: 'component', op: 'eq', value: values[0] })
    } else if (values.length > 1) {
      conditions.push({ key: 'component', op: 'in', value: values })
    }
    // The legacy ?component param is folded into the DSL, so always clear it.
    setParams({ filters: encodeFilterSet({ conditions }) || undefined, component: undefined })
  }

  const toggleDataset = (component: string) => {
    const next = new Set(selected)
    if (next.has(component)) next.delete(component)
    else next.add(component)
    applySelection(next)
  }

  const toggleCategory = (cat: Category) => {
    const next = new Set(selected)
    const allSelected = cat.children.every((c) => next.has(c.component))
    for (const child of cat.children) {
      if (allSelected) next.delete(child.component)
      else next.add(child.component)
    }
    applySelection(next)
  }

  return (
    <section data-testid="cat-tree">
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Categories &amp; datasets
      </h2>
      <div className="flex flex-col">
        {categories.map((cat) => {
          const selectedCount = cat.children.filter((c) => selected.has(c.component)).length
          const allSelected = selectedCount === cat.children.length && cat.children.length > 0
          const someSelected = selectedCount > 0 && !allSelected
          const isOpen = expanded[cat.category] ?? someSelected
          return (
            <div key={cat.category}>
              <div
                className={`flex items-center gap-1.5 rounded-md px-1 py-1 ${
                  allSelected || someSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <button
                  type="button"
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${cat.category}`}
                  data-testid={`cat-expand-${cat.category}`}
                  onClick={() => setExpanded((prev) => ({ ...prev, [cat.category]: !isOpen }))}
                  className="shrink-0 text-slate-400 hover:text-slate-700"
                >
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
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
                </button>
                <input
                  type="checkbox"
                  data-testid={`cat-check-${cat.category}`}
                  aria-label={`Filter by ${cat.category}`}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected
                  }}
                  onChange={() => toggleCategory(cat)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-blue-600"
                />
                <span
                  className={`truncate text-xs font-medium ${
                    allSelected || someSelected ? 'text-blue-700' : 'text-slate-700'
                  }`}
                >
                  {cat.category}
                </span>
                <MiniStats node={cat.rollup} />
              </div>
              {isOpen &&
                cat.children.map((child) => {
                  const isSelected = selected.has(child.component)
                  const short = child.component.split('/').slice(1).join('/') || child.component
                  return (
                    <div
                      key={child.component}
                      className={`ml-5 flex items-center gap-1.5 rounded-md px-1 py-0.5 ${
                        isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        data-testid={`dataset-check-${child.component}`}
                        aria-label={`Filter by ${child.component}`}
                        checked={isSelected}
                        onChange={() => toggleDataset(child.component)}
                        className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-blue-600"
                      />
                      <span
                        title={child.component}
                        className={`truncate text-xs ${isSelected ? 'text-blue-700' : 'text-slate-600'}`}
                      >
                        {short}
                      </span>
                      <MiniStats node={child} />
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>
    </section>
  )
}
