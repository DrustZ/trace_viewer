import type { TraceSummary } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import { materializeCompareRuns, resolveCompareRuns, selectableRuns } from '../../pages/ComparePage'
import { buildRows } from './DualEvolutionChart'
import { groupByStep, traceMatchesSelection } from './RunColumn'

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

  it('keeps a synthetic default checkpoint out of the real step-zero group', () => {
    const realZero = summary('real-zero', 0, 1)
    const syntheticZero = summary('synthetic-zero', 0, 0)
    syntheticZero.meta.extra = { normalization: { checkpointStep: 'default' } }

    const groups = groupByStep([syntheticZero, realZero])
    expect(groups.map((group) => group.step)).toEqual([0, null])
    expect(groups[0].rollouts.map((rollout) => rollout.meta.traceId)).toEqual(['real-zero'])
    expect(groups[1].rollouts.map((rollout) => rollout.meta.traceId)).toEqual(['synthetic-zero'])
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

describe('selectableRuns', () => {
  it('discovers arbitrary runs and preserves deep-linked selections', () => {
    expect(selectableRuns(['work-trial', 'run-b'], ['archived-run', 'work-trial'])).toEqual([
      'archived-run',
      'run-b',
      'work-trial',
    ])
  })

  it('materializes deterministic defaults that stay stable as the catalog grows', () => {
    const initial = resolveCompareRuns(['work-trial'], null, null)
    expect(initial).toEqual({ runA: 'work-trial', runB: 'work-trial' })

    const afterProgressiveScan = resolveCompareRuns(
      ['work-trial', 'run-b', 'run-a'],
      initial.runA,
      initial.runB,
    )
    expect(afterProgressiveScan).toEqual(initial)
  })

  it('fills only a missing side and prefers a different discovered run', () => {
    expect(resolveCompareRuns(['run-b', 'run-a'], null, 'run-a')).toEqual({
      runA: 'run-b',
      runB: 'run-a',
    })
  })

  it('writes missing defaults while preserving URL state and explicit runs', () => {
    const initial = materializeCompareRuns(
      new URLSearchParams('instance=i-1&runA=archived&traceA=t-1'),
      ['run-b', 'run-a'],
    )
    expect(initial.toString()).toBe('instance=i-1&runA=archived&traceA=t-1&runB=run-a')

    const afterCatalogGrowth = materializeCompareRuns(initial, ['aaa-new', 'run-a', 'run-b'])
    expect(afterCatalogGrowth.toString()).toBe(initial.toString())
  })
})

describe('traceMatchesSelection', () => {
  const selected = summary('t', 0, null)
  selected.meta.instanceId = 'instance-1'
  selected.meta.extra = { run: 'work-trial' }

  it('accepts only the selected run and instance', () => {
    expect(traceMatchesSelection(selected, 'work-trial', 'instance-1')).toBe(true)
    expect(traceMatchesSelection(selected, 'run-a', 'instance-1')).toBe(false)
    expect(traceMatchesSelection(selected, 'work-trial', 'instance-2')).toBe(false)
  })

  it('uses the same run-a fallback as the rest of the app', () => {
    const legacy = summary('legacy', 0, null)
    legacy.meta.instanceId = 'instance-1'
    expect(traceMatchesSelection(legacy, 'run-a', 'instance-1')).toBe(true)
  })
})
