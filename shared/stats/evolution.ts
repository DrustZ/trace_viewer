import type { EvolutionSeries, TraceSummary } from '../schema/types'

/** Score desc with nulls last, then traceId asc — the Evolution panel order. */
function compareRollouts(a: TraceSummary, b: TraceSummary): number {
  const sa = a.stats.score
  const sb = b.stats.score
  if (sa !== sb) {
    if (sa === null) return 1
    if (sb === null) return -1
    return sb - sa
  }
  if (a.meta.traceId !== b.meta.traceId) return a.meta.traceId < b.meta.traceId ? -1 : 1
  return 0
}

export function buildEvolutionSeries(
  items: TraceSummary[],
  instanceId: string,
): EvolutionSeries | null {
  const rollouts = items.filter((t) => t.meta.instanceId === instanceId)
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
