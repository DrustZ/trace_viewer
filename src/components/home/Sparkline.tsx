const W = 110
const H = 28
const PAD = 3

/**
 * Tiny score-trend sparkline. Y is a fixed 0..1 domain so rows are comparable
 * across the component table, not auto-scaled per row.
 */
export function Sparkline({ points }: { points: Array<{ step: number; avgScore: number }> }) {
  if (points.length < 2) return <span className="text-slate-300">—</span>

  const sorted = [...points].sort((a, b) => a.step - b.step)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const span = last.step - first.step
  const x = (step: number) =>
    span === 0 ? W / 2 : PAD + ((step - first.step) / span) * (W - 2 * PAD)
  const y = (score: number) => H - PAD - Math.min(1, Math.max(0, score)) * (H - 2 * PAD)
  const path = sorted.map((p) => `${x(p.step).toFixed(1)},${y(p.avgScore).toFixed(1)}`).join(' ')

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="inline-block align-middle"
      role="img"
      aria-label="score by step trend"
    >
      <polyline
        points={path}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(last.step)} cy={y(last.avgScore)} r={2} fill="#475569" />
    </svg>
  )
}
