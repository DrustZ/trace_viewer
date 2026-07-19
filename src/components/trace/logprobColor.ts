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
