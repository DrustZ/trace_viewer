import type { TraceMeta } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Merge the marker used when a connector must satisfy the numeric schema with a sentinel zero. */
export function withDefaultCheckpointProvenance(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const normalization = isRecord(extra.normalization) ? extra.normalization : {}
  return {
    ...extra,
    normalization: { ...normalization, checkpointStep: 'default' },
  }
}

/**
 * Whether checkpointStep came from the source trace rather than a schema
 * compatibility default. A real source checkpoint may legitimately be zero;
 * only explicit normalization provenance marks the numeric value synthetic.
 */
export function hasRecordedCheckpoint(meta: Pick<TraceMeta, 'extra'>): boolean {
  const normalization = meta.extra?.normalization
  return !(isRecord(normalization) && normalization.checkpointStep === 'default')
}

/** UI/API-safe display value: null means the source did not record a checkpoint. */
export function recordedCheckpoint(
  meta: Pick<TraceMeta, 'checkpointStep' | 'extra'>,
): number | null {
  return hasRecordedCheckpoint(meta) ? meta.checkpointStep : null
}
