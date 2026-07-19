import { type ListParams, useTiles } from '../../../api/hooks'
import { formatDuration, formatNumber, formatScore } from '../../common/format'

interface Stat {
  label: string
  value: string
  valueClass?: string
}

/** Compact 2-column stat grid for the sidebar — replaces the old StatTiles row. */
export function SelectionStats({ params }: { params: ListParams }) {
  const tiles = useTiles(params)
  const d = tiles.data

  const stats: Stat[] = [
    { label: 'Total', value: formatNumber(d?.total) },
    { label: 'Completed', value: formatNumber(d?.completed) },
    {
      label: 'Failed',
      value: formatNumber(d?.failed),
      valueClass: (d?.failed ?? 0) > 0 ? 'text-red-600' : undefined,
    },
    { label: 'Avg score', value: formatScore(d?.avgScore) },
    { label: 'Avg turns', value: d ? d.avgTurns.toFixed(1) : '—' },
    { label: 'Avg duration', value: formatDuration(d?.avgDurationMs) },
  ]

  return (
    <section data-testid="selection-stats">
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Current selection
      </h2>
      <div className="grid grid-cols-2 gap-1.5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
            <div className="text-[10px] text-slate-500">{s.label}</div>
            <div
              className={`text-sm font-semibold tabular-nums ${s.valueClass ?? 'text-slate-900'}`}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
