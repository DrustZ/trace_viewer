import { formatScore } from './format'

function scoreClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'bg-slate-100 text-slate-500'
  if (score >= 0.7) return 'bg-emerald-50 text-emerald-700'
  if (score > 0) return 'bg-amber-50 text-amber-700'
  return 'bg-red-50 text-red-700'
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs ${scoreClass(score)}`}>
      {formatScore(score)}
    </span>
  )
}
