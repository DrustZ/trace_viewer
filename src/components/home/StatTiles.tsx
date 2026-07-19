import type { StatTiles as StatTilesData } from '@shared/schema/types'
import { type ListParams, useTiles } from '../../api/hooks'
import { formatDuration, formatNumber, formatScore } from '../common/format'

interface Tile {
  label: string
  value: string
  dot: string
  valueClass?: string
}

function buildTiles(d: StatTilesData | undefined): Tile[] {
  return [
    { label: 'Total', value: formatNumber(d?.total), dot: 'bg-slate-400' },
    { label: 'Completed', value: formatNumber(d?.completed), dot: 'bg-emerald-500' },
    {
      label: 'Failed',
      value: formatNumber(d?.failed),
      dot: 'bg-red-500',
      valueClass: (d?.failed ?? 0) > 0 ? 'text-red-600' : undefined,
    },
    { label: 'Avg score', value: formatScore(d?.avgScore), dot: 'bg-blue-500' },
    { label: 'Avg turns', value: d ? d.avgTurns.toFixed(1) : '—', dot: 'bg-blue-400' },
    { label: 'Avg duration', value: formatDuration(d?.avgDurationMs), dot: 'bg-slate-300' },
  ]
}

export function StatTiles({ params }: { params: ListParams }) {
  const tiles = useTiles(params)

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {buildTiles(tiles.data).map((tile) => (
        <div key={tile.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${tile.dot}`} />
            <span className="text-xs text-slate-500">{tile.label}</span>
          </div>
          <div className={`mt-1 text-2xl font-semibold ${tile.valueClass ?? 'text-slate-900'}`}>
            {tile.value}
          </div>
        </div>
      ))}
    </div>
  )
}
