import type { RewardCurvePoint } from '@shared/schema/types'
import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'
import { type ListParams, useRewardCurves } from '../../api/hooks'
import type { ListParamKey } from '../../state/filterParams'
import { formatScore } from '../common/format'

// Categorical slots 1 (blue) and 2 (green) from the dataviz reference palette —
// validated CVD-safe and >=3:1 on the white card surface.
const SERIES = {
  train: { label: 'Train', color: '#2a78d6' },
  test: { label: 'Test', color: '#008300' },
} as const

type SeriesKey = keyof typeof SERIES
type SeriesMode = SeriesKey | 'both'

interface CurveRow {
  step: number
  train?: number
  trainCount?: number
  test?: number
  testCount?: number
}

function buildRows(train: RewardCurvePoint[], test: RewardCurvePoint[]): CurveRow[] {
  const byStep = new Map<number, CurveRow>()
  const rowFor = (step: number): CurveRow => {
    let row = byStep.get(step)
    if (!row) {
      row = { step }
      byStep.set(step, row)
    }
    return row
  }
  for (const p of train) {
    const row = rowFor(p.step)
    row.train = p.avgScore
    row.trainCount = p.count
  }
  for (const p of test) {
    const row = rowFor(p.step)
    row.test = p.avgScore
    row.testCount = p.count
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step)
}

function CurveTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || payload.length === 0) return null
  const row = payload[0]?.payload as CurveRow | undefined
  if (!row) return null
  const entries = (['train', 'test'] as const).filter((key) => row[key] !== undefined)
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
      <div className="font-medium text-slate-700">step {label}</div>
      {entries.map((key) => (
        <div key={key} className="mt-0.5 flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-3 rounded-full"
            style={{ backgroundColor: SERIES[key].color }}
          />
          <span className="font-semibold tabular-nums text-slate-900">{formatScore(row[key])}</span>
          <span className="text-slate-400">
            {SERIES[key].label} · n={key === 'train' ? row.trainCount : row.testCount}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Train/test avg-score vs checkpoint step. Clicking a point (or its x position)
 * applies the existing `step` list filter — jump-to-checkpoint.
 */
export function RewardCurveChart({
  params,
  setParam,
}: {
  params: ListParams
  setParam: (key: ListParamKey, value: string | undefined) => void
}) {
  const [mode, setMode] = useState<SeriesMode>('both')
  const curves = useRewardCurves(params.component ? [params.component] : undefined, params)
  const rows = useMemo(
    () => buildRows(curves.data?.train ?? [], curves.data?.test ?? []),
    [curves.data],
  )

  const modes: Array<{ id: SeriesMode; label: string }> = [
    { id: 'train', label: 'Train' },
    { id: 'test', label: 'Test' },
    { id: 'both', label: 'Both' },
  ]

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="flex rounded-md border border-slate-200 p-0.5">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid={`curve-mode-${m.id}`}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ${
                mode === m.id
                  ? 'bg-slate-100 font-medium text-slate-800'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {m.id !== 'both' && (
                // series color key — the toggle doubles as the legend
                <span
                  className="inline-block h-0.5 w-3 rounded-full"
                  style={{ backgroundColor: SERIES[m.id].color }}
                />
              )}
              {m.label}
            </button>
          ))}
        </div>
        {params.step && (
          <button
            type="button"
            data-testid="curve-step-chip"
            onClick={() => setParam('step', undefined)}
            title="Clear step filter"
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100"
          >
            step {params.step}
            <span aria-hidden="true" className="text-blue-400">
              ×
            </span>
          </button>
        )}
        {params.component && (
          <span className="text-xs text-slate-400">component: {params.component}</span>
        )}
        <span className="ml-auto text-xs text-slate-400">click a point to filter by step</span>
      </div>
      {rows.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center text-xs text-slate-400">
          {curves.isLoading ? 'Loading curves…' : 'No reward-curve data for the current selection'}
        </div>
      ) : (
        <div
          data-testid="reward-curve-chart"
          className={`h-[200px] ${curves.isFetching ? 'opacity-60' : ''}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={rows}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
              style={{ cursor: 'pointer' }}
              onClick={(state) => {
                const step = state?.activeLabel
                if (step !== undefined && step !== '') setParam('step', String(step))
              }}
            >
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="step"
                type="number"
                domain={['dataMin', 'dataMax']}
                ticks={rows.length <= 14 ? rows.map((r) => r.step) : undefined}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <YAxis
                domain={[0, 1]}
                ticks={[0, 0.25, 0.5, 0.75, 1]}
                width={32}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={CurveTooltip} cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }} />
              {(mode === 'both' || mode === 'train') && (
                <Line
                  type="monotone"
                  dataKey="train"
                  name="Train"
                  stroke={SERIES.train.color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: SERIES.train.color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
              {(mode === 'both' || mode === 'test') && (
                <Line
                  type="monotone"
                  dataKey="test"
                  name="Test"
                  stroke={SERIES.test.color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: SERIES.test.color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
