import { describe, expect, it } from 'vitest'
import type { TraceSummary } from '../schema/types'
import { buildEvolutionSeries } from './evolution'

let seq = 0

const t = (over: {
  id?: string
  instance?: string
  component?: string
  step?: number
  score?: number | null
  run?: string
}): TraceSummary => ({
  meta: {
    traceId: over.id ?? `t-${++seq}`,
    instanceId: over.instance ?? 'inst-1',
    component: over.component ?? 'comp/a',
    status: 'completed',
    timestamp: '2026-03-01T00:00:00.000Z',
    checkpointStep: over.step ?? 0,
    split: 'train',
    sourceFormat: 'native',
    ...(over.run !== undefined ? { extra: { run: over.run } } : {}),
  },
  stats: {
    score: over.score ?? null,
    hasError: false,
    truncated: false,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    turns: 0,
    toolUses: 0,
    sandboxExecutions: 0,
    thinkingPortion: 0,
  },
})

describe('buildEvolutionSeries', () => {
  it('returns null for an unknown instance', () => {
    expect(buildEvolutionSeries([t({ instance: 'inst-1' })], 'inst-404')).toBeNull()
    expect(buildEvolutionSeries([], 'inst-1')).toBeNull()
  })

  it('builds one point per step, sorted, with null-safe avgScore', () => {
    const series = buildEvolutionSeries(
      [
        t({ instance: 'inst-x', component: 'comp/x', step: 20, score: 1 }),
        t({ instance: 'inst-x', component: 'comp/x', step: 20, score: null }),
        t({ instance: 'inst-x', component: 'comp/x', step: 30, score: null }),
        t({ instance: 'inst-x', component: 'comp/x', step: 10, score: 0.5 }),
        t({ instance: 'inst-other', step: 10, score: 0 }),
      ],
      'inst-x',
    )
    expect(series).not.toBeNull()
    expect(series?.instanceId).toBe('inst-x')
    expect(series?.component).toBe('comp/x')
    expect(series?.points.map((p) => p.step)).toEqual([10, 20, 30])
    expect(series?.points.map((p) => p.avgScore)).toEqual([0.5, 1, null])
    expect(series?.points.map((p) => p.rollouts.length)).toEqual([1, 2, 1]) // other instance excluded
  })

  it('sorts rollouts by score desc, nulls last, then traceId asc', () => {
    const series = buildEvolutionSeries(
      [
        t({ id: 'r3', step: 10, score: 0.5 }),
        t({ id: 'r1', step: 10, score: null }),
        t({ id: 'r2', step: 10, score: 1 }),
        t({ id: 'r0', step: 10, score: null }),
        t({ id: 'r4', step: 10, score: 0.5 }),
      ],
      'inst-1',
    )
    expect(series?.points[0].rollouts.map((r) => r.meta.traceId)).toEqual([
      'r2',
      'r3',
      'r4',
      'r0',
      'r1',
    ])
  })

  it('scopes to one run when given; missing extra.run means run-a', () => {
    // Same instanceId exists in two runs — rollouts must not leak across.
    const items = [
      t({ id: 'a1', instance: 'inst-x', step: 10, score: 1 }), // no extra.run ⇒ run-a
      t({ id: 'a2', instance: 'inst-x', step: 10, score: 0.5, run: 'run-a' }),
      t({ id: 'b1', instance: 'inst-x', step: 10, score: 0, run: 'run-b' }),
      t({ id: 'b2', instance: 'inst-x', step: 20, score: 0.25, run: 'run-b' }),
    ]

    const a = buildEvolutionSeries(items, 'inst-x', 'run-a')
    expect(a?.points.map((p) => p.step)).toEqual([10])
    expect(a?.points[0].rollouts.map((r) => r.meta.traceId)).toEqual(['a1', 'a2'])
    expect(a?.points[0].avgScore).toBeCloseTo(0.75, 5)

    const b = buildEvolutionSeries(items, 'inst-x', 'run-b')
    expect(b?.points.map((p) => p.step)).toEqual([10, 20])
    expect(b?.points.flatMap((p) => p.rollouts.map((r) => r.meta.traceId))).toEqual(['b1', 'b2'])

    // No run argument keeps the legacy all-runs behavior.
    expect(buildEvolutionSeries(items, 'inst-x')?.points[0].rollouts).toHaveLength(3)
    // A run with no rollouts for the instance is a miss, not an empty series.
    expect(buildEvolutionSeries(items, 'inst-x', 'run-c')).toBeNull()
  })
})
