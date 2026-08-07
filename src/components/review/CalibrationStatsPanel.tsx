import type { CalibrationFilters } from '../../api/reviews'
import { useCalibrationStats } from '../../api/reviews'

export interface CalibrationStatsPanelProps {
  filters?: CalibrationFilters
  className?: string
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

export function CalibrationStatsPanel({ filters, className = '' }: CalibrationStatsPanelProps) {
  const stats = useCalibrationStats(filters)
  if (stats.isLoading) return <div className={className}>Loading calibration…</div>
  if (stats.error || !stats.data) {
    return <div className={`text-sm text-red-600 ${className}`}>Calibration unavailable.</div>
  }
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Calibration</h2>
          <p className="text-xs text-slate-500">
            {stats.data.recordsWithAutomaticVerdicts}/{stats.data.records} locked reviews paired
          </p>
        </div>
        <span className="rounded bg-violet-100 px-2 py-1 text-xs text-violet-700">
          {stats.data.disagreements.length} disagreements
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-2 pr-3 font-medium">Dimension</th>
              <th className="pb-2 pr-3 font-medium">n</th>
              <th className="pb-2 pr-3 font-medium">Raw agreement</th>
              <th className="pb-2 pr-3 font-medium">κ</th>
              <th className="pb-2 pr-3 font-medium">Pass recall</th>
              <th className="pb-2 font-medium">Fail recall</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {stats.data.dimensions.map((dimension) => (
              <tr key={dimension.dimensionId}>
                <td className="py-2 pr-3 font-medium">{dimension.dimensionId}</td>
                <td className="py-2 pr-3">{dimension.pairs}</td>
                <td className="py-2 pr-3">{percent(dimension.rawAgreement)}</td>
                <td className="py-2 pr-3">
                  {dimension.kappa === null ? (
                    <span title={dimension.kappaStatus}>undefined</span>
                  ) : (
                    dimension.kappa.toFixed(3)
                  )}
                </td>
                <td className="py-2 pr-3">{percent(dimension.perClassRecall.pass)}</td>
                <td className="py-2">{percent(dimension.perClassRecall.fail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
