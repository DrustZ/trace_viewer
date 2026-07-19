import { decodeFilterSet, encodeFilterSet } from '@shared/filter/parse'
import type { FilterCondition } from '@shared/filter/types'
import { useEffect, useState } from 'react'
import { type ListParams, useMeta } from '../../../api/hooks'
import { type ListParamKey, useListParams } from '../../../state/filterParams'
import { AiFilterInput } from '../AiFilterInput'
import { FilterConditionBuilder } from '../FilterConditionBuilder'

function c(
  key: string,
  op: FilterCondition['op'],
  value: string | number | boolean,
): FilterCondition {
  return { key, op, value }
}

/**
 * One-click investigation starting points. Applying replaces the filters/sort/
 * order params wholesale (absent fields clear back to the defaults); the select
 * itself is stateless and snaps back to the placeholder.
 */
const PRESETS: Array<{
  label: string
  conditions?: FilterCondition[]
  sort?: string
  order?: 'asc' | 'desc'
}> = [
  { label: 'Shortest successes', conditions: [c('score', 'gt', 0)], sort: 'turns', order: 'asc' },
  { label: 'Shortest failures', conditions: [c('score', 'eq', 0)], sort: 'turns', order: 'asc' },
  { label: 'Longest running', sort: 'durationMs', order: 'desc' },
  { label: 'KL outliers', conditions: [c('kl', 'gt', 1)] },
  { label: 'Zero-logprob spans', conditions: [c('zeroLogprobSpan', 'eq', true)] },
  { label: 'Format errors', conditions: [c('formatErrors', 'eq', true)] },
  { label: 'High context use', conditions: [c('contextUtil', 'gt', 0.5)] },
]

const SELECT_CLASS =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400'

const INPUT_CLASS =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
      <span>{label}</span>
      {children}
    </div>
  )
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  testId: string
}) {
  return (
    <Field label={label}>
      <select
        className={SELECT_CLASS}
        data-testid={testId}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  )
}

function instanceKeywordFrom(filters: string | undefined): string {
  const cond = decodeFilterSet(filters).conditions.find(
    (c) => c.key === 'instanceId' && c.op === 'contains',
  )
  return cond && !Array.isArray(cond.value) ? String(cond.value) : ''
}

/** Vertical filter stack for the sidebar — replaces the old horizontal FilterBar. */
export function SidebarFilters({
  params,
  setParam,
  clearAll,
}: {
  params: ListParams
  setParam: (key: ListParamKey, value: string | undefined) => void
  clearAll: () => void
}) {
  const meta = useMeta()
  // Presets patch filters+sort+order atomically; sequential setParam calls
  // in one tick would clobber each other (see useListParams).
  const { setParams } = useListParams()
  const [instanceKw, setInstanceKw] = useState(() => instanceKeywordFrom(params.filters))
  const [traceKw, setTraceKw] = useState(params.q ?? '')

  // Keep local inputs in sync when the URL changes elsewhere (AI filter, clear all, chips).
  useEffect(() => setInstanceKw(instanceKeywordFrom(params.filters)), [params.filters])
  useEffect(() => setTraceKw(params.q ?? ''), [params.q])

  const commitInstanceKw = () => {
    const v = instanceKw.trim()
    if (v === instanceKeywordFrom(params.filters)) return
    const others = decodeFilterSet(params.filters).conditions.filter(
      (c) => !(c.key === 'instanceId' && c.op === 'contains'),
    )
    const conditions =
      v === '' ? others : [...others, { key: 'instanceId', op: 'contains' as const, value: v }]
    setParam('filters', encodeFilterSet({ conditions }) || undefined)
  }

  const commitTraceKw = () => {
    const v = traceKw.trim()
    if (v === (params.q ?? '')) return
    setParam('q', v || undefined)
  }

  const applyPreset = (label: string) => {
    const preset = PRESETS.find((p) => p.label === label)
    if (preset === undefined) return
    setParams({
      filters: preset.conditions ? encodeFilterSet({ conditions: preset.conditions }) : undefined,
      sort: preset.sort,
      order: preset.order,
    })
  }

  const grouped = params.groupBy === 'instance'

  return (
    <section data-testid="sidebar-filters" className="flex flex-col gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Trace filters
      </h2>
      <LabeledSelect
        label="Status"
        testId="filter-status"
        value={params.status ?? ''}
        options={meta.data?.statuses ?? []}
        onChange={(v) => setParam('status', v || undefined)}
      />
      <LabeledSelect
        label="Split"
        testId="filter-split"
        value={params.split ?? ''}
        options={meta.data?.splits ?? []}
        onChange={(v) => setParam('split', v || undefined)}
      />
      <LabeledSelect
        label="Step"
        testId="filter-step"
        value={params.step ?? ''}
        options={(meta.data?.steps ?? []).map(String)}
        onChange={(v) => setParam('step', v || undefined)}
      />
      <Field label="Instance keyword">
        <input
          type="text"
          aria-label="Instance keyword"
          data-testid="filter-instance-kw"
          value={instanceKw}
          onChange={(e) => setInstanceKw(e.target.value)}
          onBlur={commitInstanceKw}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitInstanceKw()
          }}
          placeholder="instance id contains…"
          className={INPUT_CLASS}
        />
      </Field>
      <Field label="Filter by keyword">
        <input
          type="text"
          aria-label="Filter traces by keyword"
          data-testid="filter-trace-kw"
          value={traceKw}
          onChange={(e) => setTraceKw(e.target.value)}
          onBlur={commitTraceKw}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTraceKw()
          }}
          placeholder="Filter traces by keyword (message text, tools, ids)"
          className={INPUT_CLASS}
        />
      </Field>
      <AiFilterInput />
      <Field label="Presets">
        <select
          className={SELECT_CLASS}
          data-testid="filter-presets"
          aria-label="Presets"
          value=""
          onChange={(e) => applyPreset(e.target.value)}
        >
          <option value="">None</option>
          {PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <FilterConditionBuilder params={params} setParam={setParam} />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <button
            type="button"
            role="switch"
            aria-checked={grouped}
            data-testid="group-toggle"
            onClick={() => setParam('group', grouped ? undefined : 'instance')}
            className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
              grouped ? 'bg-blue-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
                grouped ? 'left-3.5' : 'left-0.5'
              }`}
            />
          </button>
          Group by instance
        </label>
        <button
          type="button"
          data-testid="clear-all"
          onClick={clearAll}
          className="text-xs text-blue-600 hover:underline"
        >
          Clear all
        </button>
      </div>
    </section>
  )
}
