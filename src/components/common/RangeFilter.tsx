import { useState } from 'react'

/**
 * A compact numeric range control: two clamped native sliders (min ≤ max) plus
 * exact number inputs, with Apply / Clear. Used from a trace-table column header
 * to write a gte/lte pair into the filter DSL.
 */
export function RangeFilter({
  label,
  domainMin,
  domainMax,
  step,
  value,
  onApply,
  onClear,
}: {
  label: string
  domainMin: number
  domainMax: number
  step: number
  value: { min?: number; max?: number }
  onApply: (min: number, max: number) => void
  onClear: () => void
}) {
  const [min, setMin] = useState(value.min ?? domainMin)
  const [max, setMax] = useState(value.max ?? domainMax)

  const setMinClamped = (v: number) => setMin(Math.min(Math.max(v, domainMin), max))
  const setMaxClamped = (v: number) => setMax(Math.max(Math.min(v, domainMax), min))
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

  return (
    <div data-testid="range-filter" className="flex w-56 flex-col gap-2 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-500">
          {fmt(min)} – {fmt(max)}
        </span>
      </div>
      <input
        type="range"
        aria-label={`${label} minimum`}
        min={domainMin}
        max={domainMax}
        step={step}
        value={min}
        onChange={(e) => setMinClamped(Number(e.target.value))}
        className="w-full accent-blue-600"
      />
      <input
        type="range"
        aria-label={`${label} maximum`}
        min={domainMin}
        max={domainMax}
        step={step}
        value={max}
        onChange={(e) => setMaxClamped(Number(e.target.value))}
        className="w-full accent-blue-600"
      />
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          aria-label={`${label} min value`}
          min={domainMin}
          max={domainMax}
          step={step}
          value={min}
          onChange={(e) => setMinClamped(Number(e.target.value))}
          className="w-20 rounded border border-slate-300 px-1.5 py-0.5 tabular-nums"
        />
        <span className="text-slate-400">to</span>
        <input
          type="number"
          aria-label={`${label} max value`}
          min={domainMin}
          max={domainMax}
          step={step}
          value={max}
          onChange={(e) => setMaxClamped(Number(e.target.value))}
          className="w-20 rounded border border-slate-300 px-1.5 py-0.5 tabular-nums"
        />
      </div>
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={onClear}
          className="rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => onApply(min, max)}
          className="rounded bg-blue-600 px-3 py-0.5 font-medium text-white hover:bg-blue-700"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
