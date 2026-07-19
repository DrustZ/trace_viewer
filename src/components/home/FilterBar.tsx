import type { ListParams } from '../../api/hooks'
import { useMeta } from '../../api/hooks'
import type { ListParamKey } from '../../state/filterParams'
import { AiFilterInput } from './AiFilterInput'
import { FilterConditionBuilder } from './FilterConditionBuilder'

const SORT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'time', label: 'Time' },
  { id: 'score', label: 'Score' },
  { id: 'turns', label: 'Turns' },
  { id: 'durationMs', label: 'Duration' },
  { id: 'totalTokens', label: 'Total tokens' },
]

const SELECT_CLASS =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400'

interface FilterBarProps {
  params: ListParams
  setParam: (key: ListParamKey, value: string | undefined) => void
  clearAll: () => void
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-500">
      {label}
      <select className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// The 'filters' param is rendered as editable chips by FilterConditionBuilder, not here.
function activeChips(params: ListParams): Array<{ key: ListParamKey; label: string }> {
  const chips: Array<{ key: ListParamKey; label: string }> = []
  const push = (key: ListParamKey, value: string | undefined, label?: string) => {
    if (value !== undefined && value !== '') chips.push({ key, label: label ?? `${key}: ${value}` })
  }
  push('split', params.split)
  push('step', params.step)
  push('component', params.component)
  push('status', params.status)
  push('q', params.q)
  push('sort', params.sort)
  push('order', params.order)
  push('group', params.groupBy, 'grouped by instance')
  return chips
}

export function FilterBar({ params, setParam, clearAll }: FilterBarProps) {
  const meta = useMeta()
  const components = meta.data?.components ?? []
  const splits = meta.data?.splits ?? []
  const steps = meta.data?.steps ?? []
  const statuses = meta.data?.statuses ?? []

  const sort = params.sort ?? 'time'
  const order = params.order ?? 'desc'
  const sortOptions = SORT_OPTIONS.some((o) => o.id === sort)
    ? SORT_OPTIONS
    : [...SORT_OPTIONS, { id: sort, label: sort }]
  const chips = activeChips(params)

  const withAll = (values: string[]) => [
    { value: '', label: 'All' },
    ...values.map((v) => ({ value: v, label: v })),
  ]

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <LabeledSelect
          label="Component"
          value={params.component ?? ''}
          options={withAll(components)}
          onChange={(v) => setParam('component', v || undefined)}
        />
        <LabeledSelect
          label="Split"
          value={params.split ?? ''}
          options={withAll(splits)}
          onChange={(v) => setParam('split', v || undefined)}
        />
        <LabeledSelect
          label="Step"
          value={params.step ?? ''}
          options={withAll(steps.map(String))}
          onChange={(v) => setParam('step', v || undefined)}
        />
        <LabeledSelect
          label="Status"
          value={params.status ?? ''}
          options={withAll(statuses)}
          onChange={(v) => setParam('status', v || undefined)}
        />
        <div className="flex items-center gap-1.5">
          <LabeledSelect
            label="Sort"
            value={sort}
            options={sortOptions.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(v) => setParam('sort', v === 'time' ? undefined : v)}
          />
          <button
            type="button"
            title={order === 'desc' ? 'Descending' : 'Ascending'}
            onClick={() => setParam('order', order === 'desc' ? 'asc' : 'desc')}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {order === 'desc' ? '↓ desc' : '↑ asc'}
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
            checked={params.groupBy === 'instance'}
            onChange={(e) => setParam('group', e.target.checked ? 'instance' : undefined)}
          />
          Group by instance
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-slate-100 pt-2">
        <AiFilterInput setParam={setParam} />
        <FilterConditionBuilder params={params} setParam={setParam} />
      </div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex max-w-xs items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
            >
              <span className="truncate">{chip.label}</span>
              <button
                type="button"
                aria-label={`Remove ${chip.key} filter`}
                onClick={() => setParam(chip.key, undefined)}
                className="text-slate-400 hover:text-slate-700"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 text-xs text-blue-600 hover:underline"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
