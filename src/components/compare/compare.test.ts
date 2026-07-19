import type { TraceSummary } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import { buildRows } from './DualEvolutionChart'
import { groupByStep } from './RunColumn'

function summary(traceId: string, step: number, score: number | null): TraceSummary {
  return {
    meta: { traceId, checkpointStep: step } as TraceSummary['meta'],
    stats: { score } as TraceSummary['stats'],
  }
}

describe('groupByStep', () => {
  it('groups by checkpoint step ascending and averages scored rollouts only', () => {
    const groups = groupByStep([
      summary('a', 10, 1),
      summary('b', 5, 0),
      summary('c', 10, 0),
      summary('d', 10, null),
    ])
    expect(groups.map((g) => g.step)).toEqual([5, 10])
    expect(groups[1].count).toBe(3)
    expect(groups[1].avgScore).toBe(0.5) // (1 + 0) / 2, null skipped
    expect(groups[0].avgScore).toBe(0)
  })

  it('returns null avg when a step has no scored rollouts', () => {
    const [g] = groupByStep([summary('a', 1, null)])
    expect(g.avgScore).toBeNull()
  })

  it('handles empty input', () => {
    expect(groupByStep([])).toEqual([])
  })
})

describe('buildRows', () => {
  it('merges both runs on a shared step axis and drops null avgs', () => {
    const rows = buildRows(
      [
        { step: 5, avgScore: 0.2 },
        { step: 10, avgScore: null }, // null-only step is dropped entirely
        { step: 20, avgScore: 0.6 },
      ],
      [
        { step: 5, avgScore: 0.8 },
        { step: 20, avgScore: null }, // B null at 20 → row keeps only A
        { step: 15, avgScore: 0.4 },
      ],
    )
    expect(rows.map((r) => r.step)).toEqual([5, 15, 20])
    expect(rows[0]).toEqual({ step: 5, a: 0.2, b: 0.8 })
    expect(rows[1]).toEqual({ step: 15, b: 0.4 })
    expect(rows[2]).toEqual({ step: 20, a: 0.6 })
  })
})
