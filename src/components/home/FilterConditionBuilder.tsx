import { decodeFilterSet, encodeFilterSet } from '@shared/filter/parse'
import type { FilterCondition, FilterKeyDef, FilterKeyType, FilterOp } from '@shared/filter/types'
import { useMemo, useState } from 'react'
import { type ListParams, useMeta } from '../../api/hooks'
import type { ListParamKey } from '../../state/filterParams'

const OPS_BY_TYPE: Record<FilterKeyType, FilterOp[]> = {
  number: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'],
  string: ['eq', 'neq', 'contains'],
  boolean: ['eq'],
  enum: ['eq', 'neq', 'in'],
}

const OP_LABELS: Record<FilterOp, string> = {
  eq: '=',
  neq: '≠',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  contains: 'contains',
  in: 'in',
}

const TYPE_ORDER: FilterKeyType[] = ['enum', 'number', 'boolean', 'string']

const INPUT_CLASS =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400'

function formatValue(value: FilterCondition['value']): string {
  return Array.isArray(value) ? value.join('|') : String(value)
}

export function FilterConditionBuilder({
  params,
  setParam,
}: {
  params: ListParams
  setParam: (key: ListParamKey, value: string | undefined) => void
}) {
  const meta = useMeta()
  const filterKeys = useMemo(() => meta.data?.filterKeys ?? [], [meta.data])

  const [open, setOpen] = useState(false)
  const [keyId, setKeyId] = useState('')
  const [op, setOp] = useState<FilterOp>('eq')
  const [values, setValues] = useState<string[]>([])

  const conditions = useMemo(() => decodeFilterSet(params.filters).conditions, [params.filters])
  const def: FilterKeyDef | undefined = filterKeys.find((k) => k.id === keyId)

  const enumOptions = (source: FilterKeyDef['enumSource']): string[] => {
    if (!meta.data || !source) return []
    if (source === 'steps') return meta.data.steps.map(String)
    return meta.data[source]
  }

  const applyConditions = (next: FilterCondition[]) => {
    setParam('filters', encodeFilterSet({ conditions: next }) || undefined)
  }

  const selectKey = (id: string) => {
    setKeyId(id)
    const nextDef = filterKeys.find((k) => k.id === id)
    setOp(nextDef ? OPS_BY_TYPE[nextDef.type][0] : 'eq')
    setValues(nextDef?.type === 'boolean' ? ['true'] : [])
  }

  const singleValue = values[0] ?? ''
  const canAdd =
    def !== undefined &&
    values.length > 0 &&
    values.every((v) => v !== '') &&
    (def.type !== 'number' || values.every((v) => Number.isFinite(Number(v))))

  const addCondition = () => {
    if (!def || !canAdd) return
    const value: FilterCondition['value'] =
      op === 'in'
        ? values
        : def.type === 'number'
          ? Number(singleValue)
          : def.type === 'boolean'
            ? singleValue === 'true'
            : singleValue
    applyConditions([...conditions, { key: def.id, op, value }])
    setOpen(false)
    setValues([])
  }

  const groups = TYPE_ORDER.map((type) => ({
    type,
    keys: filterKeys.filter((k) => k.type === type),
  })).filter((g) => g.keys.length > 0)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {conditions.map((c, i) => (
        <span
          key={`${c.key}.${c.op}.${formatValue(c.value)}`}
          data-testid="filter-chip"
          className="inline-flex max-w-xs items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
        >
          <span className="truncate">
            {c.key} {OP_LABELS[c.op]} {formatValue(c.value)}
          </span>
          <button
            type="button"
            aria-label={`Remove condition ${c.key}`}
            onClick={() => applyConditions(conditions.filter((_, j) => j !== i))}
            className="text-slate-400 hover:text-slate-700"
          >
            ×
          </button>
        </span>
      ))}
      <div className="relative">
        <button
          type="button"
          data-testid="add-condition"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700"
        >
          + Add condition
        </button>
        {open && (
          <div className="absolute left-0 top-full z-20 mt-1 flex w-max flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
            <div className="flex items-center gap-1.5">
              <select
                className={INPUT_CLASS}
                value={keyId}
                onChange={(e) => selectKey(e.target.value)}
              >
                <option value="">key…</option>
                {groups.map((g) => (
                  <optgroup key={g.type} label={g.type}>
                    {g.keys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {def && (
                <select
                  className={INPUT_CLASS}
                  value={op}
                  onChange={(e) => {
                    const next = e.target.value as FilterOp
                    setOp(next)
                    if (next !== 'in' && values.length > 1) setValues(values.slice(0, 1))
                  }}
                >
                  {OPS_BY_TYPE[def.type].map((o) => (
                    <option key={o} value={o}>
                      {OP_LABELS[o]}
                    </option>
                  ))}
                </select>
              )}
              {def &&
                (def.enumSource ? (
                  <select
                    className={INPUT_CLASS}
                    multiple={op === 'in'}
                    size={op === 'in' ? 4 : undefined}
                    value={op === 'in' ? values : singleValue}
                    onChange={(e) =>
                      setValues(Array.from(e.target.selectedOptions, (o) => o.value))
                    }
                  >
                    {op !== 'in' && <option value="">value…</option>}
                    {enumOptions(def.enumSource).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : def.type === 'boolean' ? (
                  <select
                    className={INPUT_CLASS}
                    value={singleValue}
                    onChange={(e) => setValues([e.target.value])}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    type={def.type === 'number' ? 'number' : 'text'}
                    step="any"
                    className={`${INPUT_CLASS} w-28`}
                    placeholder="value"
                    value={singleValue}
                    onChange={(e) => setValues(e.target.value === '' ? [] : [e.target.value])}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addCondition()
                    }}
                  />
                ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addCondition}
                disabled={!canAdd}
                className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
