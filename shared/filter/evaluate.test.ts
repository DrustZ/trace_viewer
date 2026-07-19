import { describe, expect, it } from 'vitest'
import type { TraceMeta, TraceStats, TraceSummary } from '../schema/types'
import { evaluateFilter, filterSummaries } from './evaluate'
import type { FilterCondition, FilterSet } from './types'

function makeSummary(overrides?: {
  meta?: Partial<TraceMeta>
  stats?: Partial<TraceStats>
}): TraceSummary {
  return {
    meta: {
      traceId: 't-1',
      instanceId: 'inst-1',
      component: 'swe/swebench-verified-mini',
      status: 'completed',
      timestamp: '2026-07-18T00:00:00.000Z',
      checkpointStep: 150,
      split: 'train',
      sourceFormat: 'native',
      ...overrides?.meta,
    },
    stats: {
      score: 0.25,
      hasError: false,
      truncated: true,
      model: { name: 'gpt-oss-120b' },
      inputTokens: 800,
      outputTokens: 200,
      thinkingTokens: 50,
      totalTokens: 1000,
      turns: 5,
      toolUses: 3,
      sandboxExecutions: 2,
      thinkingPortion: 0.25,
      durationMs: 90000,
      ...overrides?.stats,
    },
  }
}

function fs(...conditions: FilterCondition[]): FilterSet {
  return { conditions }
}

describe('evaluateFilter', () => {
  const summary = makeSummary()

  it('matches everything with an empty filter', () => {
    expect(evaluateFilter(summary, fs())).toBe(true)
  })

  describe('eq / neq normalization', () => {
    it('compares numbers against numeric strings', () => {
      expect(evaluateFilter(summary, fs({ key: 'score', op: 'eq', value: '0.25' }))).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'score', op: 'eq', value: 0.25 }))).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'score', op: 'eq', value: '0.3' }))).toBe(false)
      expect(evaluateFilter(summary, fs({ key: 'turns', op: 'eq', value: '5' }))).toBe(true)
    })

    it('compares booleans against true/false strings and booleans', () => {
      expect(evaluateFilter(summary, fs({ key: 'truncated', op: 'eq', value: 'true' }))).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'truncated', op: 'eq', value: true }))).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'truncated', op: 'eq', value: 'false' }))).toBe(
        false,
      )
      expect(evaluateFilter(summary, fs({ key: 'hasError', op: 'eq', value: false }))).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'truncated', op: 'eq', value: 'yes' }))).toBe(false)
    })

    it('compares strings exactly', () => {
      expect(evaluateFilter(summary, fs({ key: 'status', op: 'eq', value: 'completed' }))).toBe(
        true,
      )
      expect(evaluateFilter(summary, fs({ key: 'status', op: 'eq', value: 'failed' }))).toBe(false)
    })

    it('negates with neq', () => {
      expect(evaluateFilter(summary, fs({ key: 'status', op: 'neq', value: 'failed' }))).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'score', op: 'neq', value: '0.25' }))).toBe(false)
      expect(evaluateFilter(summary, fs({ key: 'truncated', op: 'neq', value: 'false' }))).toBe(
        true,
      )
    })
  })

  describe('numeric comparisons', () => {
    it('handles lt/lte/gt/gte with numbers and numeric strings', () => {
      expect(evaluateFilter(summary, fs({ key: 'score', op: 'lt', value: '0.3' }))).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'score', op: 'lt', value: 0.25 }))).toBe(false)
      expect(evaluateFilter(summary, fs({ key: 'score', op: 'lte', value: '0.25' }))).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'step', op: 'gt', value: '100' }))).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'step', op: 'gt', value: 150 }))).toBe(false)
      expect(evaluateFilter(summary, fs({ key: 'step', op: 'gte', value: '150' }))).toBe(true)
    })

    it('fails on non-numeric operands', () => {
      expect(evaluateFilter(summary, fs({ key: 'score', op: 'lt', value: 'abc' }))).toBe(false)
      expect(evaluateFilter(summary, fs({ key: 'turns', op: 'gt', value: '' }))).toBe(false)
    })

    it('fails on non-numeric values', () => {
      expect(evaluateFilter(summary, fs({ key: 'status', op: 'lt', value: '10' }))).toBe(false)
      expect(evaluateFilter(summary, fs({ key: 'truncated', op: 'gt', value: '0' }))).toBe(false)
    })
  })

  describe('contains', () => {
    it('substring-matches case-insensitively', () => {
      expect(
        evaluateFilter(summary, fs({ key: 'component', op: 'contains', value: 'SWEBENCH' })),
      ).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'model', op: 'contains', value: 'oss' }))).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'component', op: 'contains', value: 'math' }))).toBe(
        false,
      )
    })

    it('stringifies non-string values', () => {
      expect(evaluateFilter(summary, fs({ key: 'step', op: 'contains', value: '15' }))).toBe(true)
    })
  })

  describe('in', () => {
    it('matches membership with eq normalization', () => {
      expect(
        evaluateFilter(summary, fs({ key: 'split', op: 'in', value: ['train', 'test'] })),
      ).toBe(true)
      expect(evaluateFilter(summary, fs({ key: 'score', op: 'in', value: ['0.25', '0.9'] }))).toBe(
        true,
      )
      expect(
        evaluateFilter(summary, fs({ key: 'status', op: 'in', value: ['failed', 'executing'] })),
      ).toBe(false)
    })
  })

  describe('undefined values', () => {
    const ungraded = makeSummary({
      stats: { score: null, model: undefined, durationMs: undefined },
    })

    it('fails every op when the value is undefined', () => {
      expect(evaluateFilter(ungraded, fs({ key: 'score', op: 'eq', value: '0' }))).toBe(false)
      expect(evaluateFilter(ungraded, fs({ key: 'score', op: 'neq', value: '0' }))).toBe(false)
      expect(evaluateFilter(ungraded, fs({ key: 'score', op: 'lt', value: '1' }))).toBe(false)
      expect(evaluateFilter(ungraded, fs({ key: 'score', op: 'gte', value: '0' }))).toBe(false)
      expect(evaluateFilter(ungraded, fs({ key: 'score', op: 'contains', value: '0' }))).toBe(false)
      expect(evaluateFilter(ungraded, fs({ key: 'score', op: 'in', value: ['0', '1'] }))).toBe(
        false,
      )
      expect(evaluateFilter(ungraded, fs({ key: 'model', op: 'contains', value: 'gpt' }))).toBe(
        false,
      )
      expect(evaluateFilter(ungraded, fs({ key: 'durationMs', op: 'gt', value: '0' }))).toBe(false)
    })
  })

  it('fails conditions with unknown keys', () => {
    expect(evaluateFilter(summary, fs({ key: 'bogus', op: 'eq', value: '1' }))).toBe(false)
  })

  it('ANDs conditions together', () => {
    const both = fs(
      { key: 'status', op: 'eq', value: 'completed' },
      { key: 'score', op: 'gt', value: '0.2' },
    )
    expect(evaluateFilter(summary, both)).toBe(true)
    const oneFails = fs(
      { key: 'status', op: 'eq', value: 'completed' },
      { key: 'score', op: 'gt', value: '0.9' },
    )
    expect(evaluateFilter(summary, oneFails)).toBe(false)
  })
})

describe('filterSummaries', () => {
  const items = [
    makeSummary({ meta: { traceId: 'a', status: 'completed' } }),
    makeSummary({ meta: { traceId: 'b', status: 'failed' }, stats: { score: 0 } }),
    makeSummary({ meta: { traceId: 'c', status: 'executing' }, stats: { score: null } }),
  ]

  it('returns matching summaries', () => {
    const failed = filterSummaries(items, fs({ key: 'status', op: 'eq', value: 'failed' }))
    expect(failed.map((s) => s.meta.traceId)).toEqual(['b'])
  })

  it('returns everything for an empty filter', () => {
    expect(filterSummaries(items, fs())).toHaveLength(3)
  })
})
