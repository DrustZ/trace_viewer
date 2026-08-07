import { hasRecordedCheckpoint } from '../schema/provenance'
import type { EvolutionSeries, TraceSummary } from '../schema/types'

/** Run identity: `meta.extra.run` when present, else the default 'run-a'. */
export function runOf(t: TraceSummary): string {
  return t.meta.runId ?? (typeof t.meta.extra?.run === 'string' ? t.meta.extra.run : 'run-a')
}

/** Score desc with nulls last, then traceId asc — the Evolution panel order. */
function compareRollouts(a: TraceSummary, b: TraceSummary): number {
  const sa = a.stats.score
  const sb = b.stats.score
  if (sa !== sb) {
    if (sa === null) return 1
    if (sb === null) return -1
    return sb - sa
  }
  const aUid = a.meta.traceUid ?? a.meta.traceId
  const bUid = b.meta.traceUid ?? b.meta.traceId
  if (aUid !== bUid) return aUid < bUid ? -1 : 1
  return 0
}

export function buildEvolutionSeries(
  items: TraceSummary[],
  instanceId: string,
  /** When set, only rollouts of this run join the series; absent ⇒ all runs (legacy). */
  run?: string,
): EvolutionSeries | null {
  const pool = run === undefined ? items : items.filter((t) => runOf(t) === run)
  const rollouts = pool.filter(
    (t) => t.meta.instanceId === instanceId && hasRecordedCheckpoint(t.meta),
  )
  if (rollouts.length === 0) return null

  const byStep = new Map<number, TraceSummary[]>()
  for (const t of rollouts) {
    const at = byStep.get(t.meta.checkpointStep)
    if (at) at.push(t)
    else byStep.set(t.meta.checkpointStep, [t])
  }

  const points = [...byStep.entries()]
    .sort(([a], [b]) => a - b)
    .map(([step, at]) => {
      const scores = at.map((t) => t.stats.score).filter((s): s is number => s !== null)
      return {
        step,
        avgScore: scores.length > 0 ? scores.reduce((acc, s) => acc + s, 0) / scores.length : null,
        rollouts: [...at].sort(compareRollouts),
      }
    })

  return { instanceId, component: rollouts[0].meta.component, points }
}
