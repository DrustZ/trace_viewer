import { describe, expect, it } from 'vitest'
import type { Split, TraceStats, TraceStatus, TraceSummary } from '../schema/types'
import { componentAggregates, rewardCurves, statTiles } from './aggregate'

let seq = 0

interface FixtureOverrides {
  id?: string
  component?: string
  split?: Split
  status?: TraceStatus
  step?: number
  score?: number | null
  stats?: Partial<TraceStats>
}

const t = (over: FixtureOverrides = {}): TraceSummary => ({
  meta: {
    traceId: over.id ?? `t-${++seq}`,
    instanceId: 'inst-1',
    component: over.component ?? 'comp/a',
    status: over.status ?? 'completed',
    timestamp: '2026-03-01T00:00:00.000Z',
    checkpointStep: over.step ?? 0,
    split: over.split ?? 'train',
    sourceFormat: 'native',
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
    ...over.stats,
  },
})

describe('statTiles', () => {
  it('handles empty input', () => {
    expect(statTiles([])).toEqual({
      total: 0,
      completed: 0,
      failed: 0,
      executing: 0,
      avgScore: null,
      avgTurns: 0,
      avgDurationMs: null,
    })
  })

  it('totals by status and averages with null-score / missing-duration semantics', () => {
    const tiles = statTiles([
      t({ status: 'completed', score: 1, stats: { turns: 2, durationMs: 100 } }),
      t({ status: 'failed', score: 0, stats: { turns: 4 } }),
      t({ status: 'executing', score: null, stats: { turns: 0, durationMs: 300 } }),
    ])
    expect(tiles.total).toBe(3)
    expect(tiles.completed).toBe(1)
    expect(tiles.failed).toBe(1)
    expect(tiles.executing).toBe(1)
    expect(tiles.avgScore).toBeCloseTo(0.5) // over the two scored traces only
    expect(tiles.avgTurns).toBeCloseTo(2) // over all three
    expect(tiles.avgDurationMs).toBeCloseTo(200) // over the two defined durations
  })

  it('reports null avgScore when no trace is scored', () => {
    expect(statTiles([t(), t()]).avgScore).toBeNull()
  })
})

describe('componentAggregates', () => {
  it('returns [] for empty input', () => {
    expect(componentAggregates([])).toEqual([])
  })

  it('groups by (component, split) sorted by component then train first', () => {
    const aggs = componentAggregates([
      t({ component: 'comp/b', split: 'test' }),
      t({ component: 'comp/a', split: 'test' }),
      t({ component: 'comp/b', split: 'train' }),
      t({ component: 'comp/a', split: 'train' }),
      t({ component: 'comp/a', split: 'train' }),
    ])
    expect(aggs.map((a) => [a.component, a.split])).toEqual([
      ['comp/a', 'train'],
      ['comp/a', 'test'],
      ['comp/b', 'train'],
      ['comp/b', 'test'],
    ])
    expect(aggs[0].count).toBe(2)
  })

  it('scores over scored traces only; rates and counts over all', () => {
    const [agg] = componentAggregates([
      t({ status: 'completed', score: 1, stats: { truncated: true } }),
      t({ status: 'failed', score: 0 }),
      t({ status: 'executing', score: null }),
    ])
    expect(agg.count).toBe(3)
    expect(agg.completed).toBe(1)
    expect(agg.failed).toBe(1)
    expect(agg.executing).toBe(1)
    expect(agg.avgScore).toBeCloseTo(0.5)
    expect(agg.successRate).toBeCloseTo(0.5) // 1 of 2 scored has score > 0
    expect(agg.truncatedRate).toBeCloseTo(1 / 3)
  })

  it('reports null avgScore and successRate when nothing is scored', () => {
    const [agg] = componentAggregates([t(), t()])
    expect(agg.avgScore).toBeNull()
    expect(agg.successRate).toBeNull()
  })

  it('averages usage over all traces, sums tokens, null-safe duration', () => {
    const [agg] = componentAggregates([
      t({
        stats: {
          turns: 2,
          toolUses: 4,
          outputTokens: 100,
          thinkingTokens: 50,
          totalTokens: 300,
          durationMs: 1000,
        },
      }),
      t({
        stats: { turns: 4, toolUses: 0, outputTokens: 300, thinkingTokens: 150, totalTokens: 500 },
      }),
    ])
    expect(agg.avgTurns).toBeCloseTo(3)
    expect(agg.avgToolUses).toBeCloseTo(2)
    expect(agg.avgOutputTokens).toBeCloseTo(200)
    expect(agg.avgThinkingTokens).toBeCloseTo(100)
    expect(agg.totalTokens).toBe(800)
    expect(agg.avgDurationMs).toBeCloseTo(1000) // only the defined one

    const [noDuration] = componentAggregates([t(), t()])
    expect(noDuration.avgDurationMs).toBeNull()
  })

  it('scoreByStep sorts by step, omits unscored steps, counts all traces at step', () => {
    const [agg] = componentAggregates([
      t({ step: 100, score: 1 }),
      t({ step: 100, score: null }),
      t({ step: 75, score: null }),
      t({ step: 50, score: 0.5 }),
    ])
    expect(agg.scoreByStep).toEqual([
      { step: 50, avgScore: 0.5, count: 1 },
      { step: 100, avgScore: 1, count: 2 },
    ])
  })
})

describe('rewardCurves', () => {
  const items = [
    t({ component: 'comp/a', split: 'train', step: 10, score: 1 }),
    t({ component: 'comp/a', split: 'train', step: 10, score: null }),
    t({ component: 'comp/a', split: 'train', step: 5, score: 0.5 }),
    t({ component: 'comp/a', split: 'train', step: 20, score: null }),
    t({ component: 'comp/a', split: 'test', step: 10, score: 0 }),
    t({ component: 'comp/b', split: 'train', step: 10, score: 0 }),
  ]

  it('one point per scored step per split, count over all, sorted by step', () => {
    const curves = rewardCurves(items)
    expect(curves.train).toEqual([
      { step: 5, avgScore: 0.5, count: 1 },
      { step: 10, avgScore: 0.5, count: 3 }, // avg over [1, 0] scored; count includes unscored
    ])
    expect(curves.test).toEqual([{ step: 10, avgScore: 0, count: 1 }])
  })

  it('filters by exact component, any-of', () => {
    expect(rewardCurves(items, ['comp/a']).train.find((p) => p.step === 10)).toEqual({
      step: 10,
      avgScore: 1,
      count: 2,
    })
    expect(rewardCurves(items, ['comp/b']).train).toEqual([{ step: 10, avgScore: 0, count: 1 }])
    expect(rewardCurves(items, ['comp/a', 'comp/b']).train).toEqual(rewardCurves(items).train)
    expect(rewardCurves(items, ['comp/']).train).toEqual([]) // exact match, not prefix
  })
})
