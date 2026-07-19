export type LogprobBucket = 0 | 1 | 2 | 3 | 4

/** Map a natural-log token probability to a confidence bucket (0 = high, 4 = low). */
export function logprobToBucket(logprob: number): LogprobBucket {
  const p = Math.exp(logprob)
  if (p >= 0.9) return 0
  if (p >= 0.7) return 1
  if (p >= 0.4) return 2
  if (p >= 0.15) return 3
  return 4
}

/** Background tint per bucket; bucket 0 is intentionally untinted. */
export const BUCKET_CLASSES: readonly string[] = [
  '',
  'bg-yellow-100',
  'bg-orange-200',
  'bg-orange-300',
  'bg-red-300',
]

export const BUCKET_LABELS: readonly string[] = [
  'p ≥ 90%',
  'p ≥ 70%',
  'p ≥ 40%',
  'p ≥ 15%',
  'p < 15%',
]

export type Confidence = 'high' | 'med' | 'low' | 'na'

/** Chip confidence for the 'probs' view: p ≥ 0.7 high, p ≥ 0.3 med, else low. */
export function confidenceOf(logprob: number): Confidence {
  const p = Math.exp(logprob)
  if (p >= 0.7) return 'high'
  if (p >= 0.3) return 'med'
  return 'low'
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'High',
  med: 'Med',
  low: 'Low',
  na: 'N/A',
}

/** Discrete chip styling per confidence level ('na' = whitespace/newline chips). */
export const CONFIDENCE_CHIP_CLASSES: Record<Confidence, string> = {
  high: 'bg-emerald-100 border-emerald-300 text-emerald-900',
  med: 'bg-amber-100 border-amber-300 text-amber-900',
  low: 'bg-rose-200 border-rose-400 text-rose-900',
  na: 'bg-slate-100 border-slate-300 text-slate-500',
}

/**
 * Soft pastel backgrounds cycled by token index in the 'tokens' view, so
 * adjacent token blocks stay visually distinct without encoding confidence.
 */
export const TOKEN_CYCLE_CLASSES: readonly string[] = [
  'bg-rose-100',
  'bg-sky-100',
  'bg-emerald-100',
  'bg-amber-100',
  'bg-violet-100',
]
