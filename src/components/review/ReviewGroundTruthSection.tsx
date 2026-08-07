import type { ReviewGroundTruth } from '@shared/reviews/types'

export interface GroundTruthPresentation {
  kind: 'trace_bound' | 'reference' | 'unavailable' | 'legacy'
  title: string
  warning?: string
}

export function groundTruthPresentation(
  value: ReviewGroundTruth | unknown,
): GroundTruthPresentation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'legacy', title: 'DB / policy ground truth' }
  }
  const candidate = value as Record<string, unknown>
  if (
    candidate.status === 'available' &&
    candidate.authoritative === true &&
    candidate.traceBound === true
  ) {
    return { kind: 'trace_bound', title: 'Trace-bound task ground truth' }
  }
  if (
    candidate.status === 'reference' &&
    candidate.authoritative === false &&
    candidate.source === 'current_task_catalog'
  ) {
    return {
      kind: 'reference',
      title: 'Current task catalog reference (not trace-bound)',
      warning:
        'Informational only: the current checkout may differ from the task definition used for this historical trace.',
    }
  }
  if (candidate.status === 'unavailable' && candidate.authoritative === false) {
    return {
      kind: 'unavailable',
      title: 'Task ground truth unavailable',
      warning:
        'No matching trace-bound scenario snapshot exists. The current checkout is not substituted in Calibration mode.',
    }
  }
  return { kind: 'legacy', title: 'DB / policy ground truth' }
}

export interface ReviewGroundTruthSectionProps {
  groundTruth: ReviewGroundTruth | unknown
  presentation: GroundTruthPresentation
}

export function ReviewGroundTruthSection({
  groundTruth,
  presentation,
}: ReviewGroundTruthSectionProps) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-700">{presentation.title}</p>
      {presentation.warning ? (
        <p className="mt-2 text-xs font-medium text-amber-800">{presentation.warning}</p>
      ) : null}
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
        {JSON.stringify(groundTruth, null, 2)}
      </pre>
    </div>
  )
}
