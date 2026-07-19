import { useMemo } from 'react'
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
import { useEvolution } from '../../api/hooks'
import { formatScore } from '../common/format'

// A = categorical slot 1 (blue), B = violet — both >=3:1 on the white card.
const A_COLOR = '#2a78d6'
const B_COLOR = '#7c3aed'

interface DualRow {
  step: number
  /** undefined ⇒ no scored rollout at this step for that run; the line skips it. */
  a?: number
  b?: number
}

/** Merge both runs' evolution points onto a shared step axis, dropping null avgs. */
export function buildRows(
  a: Array<{ step: number; avgScore: number | null }>,
  b: Array<{ step: number; avgScore: number | null }>,
): DualRow[] {
  const byStep = new Map<number, DualRow>()
  const row = (step: number) => {
    let r = byStep.get(step)
    if (!r) {
      r = { step }
      byStep.set(step, r)
    }
    return r
  }
  for (const p of a) if (p.avgScore !== null) row(p.step).a = p.avgScore
  for (const p of b) if (p.avgScore !== null) row(p.step).b = p.avgScore
  return [...byStep.values()].sort((x, y) => x.step - y.step)
}

function DualTooltip({ runA, runB }: { runA: string; runB: string }) {
  return function Content({ active, payload, label }: TooltipContentProps) {
    if (!active || payload.length === 0) return null
    const r = payload[0]?.payload as DualRow | undefined
    if (!r) return null
    const delta = r.a !== undefined && r.b !== undefined ? r.b - r.a : null
    const line = (color: string, name: string, v: number | undefined) => (
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: color }} />
        <span className="font-semibold tabular-nums text-slate-900">{formatScore(v ?? null)}</span>
        <span className="text-slate-400">{name}</span>
      </div>
    )
    return (
      <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
        <div className="font-medium text-slate-700">step {label}</div>
        {line(A_COLOR, `${runA} (A)`, r.a)}
        {line(B_COLOR, `${runB} (B)`, r.b)}
        {delta !== null && (
          <div className="mt-1 border-t border-slate-100 pt-1 tabular-nums text-slate-500">
            Δ (B−A) {delta >= 0 ? '+' : ''}
            {formatScore(delta)}
          </div>
        )}
      </div>
    )
  }
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

/** Overlaid score-vs-step for two runs of one instance — the diff at a glance. */
export function DualEvolutionChart({
  instanceId,
  runA,
  runB,
}: {
  instanceId: string
  runA: string
  runB: string
}) {
  const evoA = useEvolution(instanceId, runA)
  const evoB = useEvolution(instanceId, runB)
  const rows = useMemo(
    () => buildRows(evoA.data?.points ?? [], evoB.data?.points ?? []),
    [evoA.data, evoB.data],
  )
  const loading = evoA.isLoading || evoB.isLoading

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-700">Avg score by checkpoint — A vs B</h2>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <LegendKey color={A_COLOR} label={`${runA} (A)`} />
          <LegendKey color={B_COLOR} label={`${runB} (B)`} />
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-xs text-slate-400">
          {loading ? 'Loading evolution…' : 'No scored checkpoints for either run'}
        </div>
      ) : (
        <div data-testid="dual-evolution-chart" className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
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
              <Tooltip
                content={DualTooltip({ runA, runB })}
                cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="a"
                name={`${runA} (A)`}
                stroke={A_COLOR}
                strokeWidth={2}
                dot={{ r: 3, fill: A_COLOR, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="b"
                name={`${runB} (B)`}
                stroke={B_COLOR}
                strokeWidth={2}
                dot={{ r: 3, fill: B_COLOR, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
