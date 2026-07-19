import { encodeFilterSet } from '@shared/filter/parse'
import { describe, expect, it } from 'vitest'
import type { ListParams } from '../api/hooks'
import { activeRange, hasActiveSelection, rangePatch } from './filterParams'

const P = (filters?: string): ListParams => ({ filters })

describe('rangePatch / activeRange', () => {
  it('round-trips a [min,max] range', () => {
    const patch = rangePatch(P(), 'score', 0.2, 0.8, 0, 1)
    expect(activeRange(P(patch.filters), 'score')).toEqual({ min: 0.2, max: 0.8 })
  })

  it('clears the filter when the whole domain is selected', () => {
    const patch = rangePatch(P(), 'turns', 0, 10, 0, 10)
    expect(patch.filters).toBeUndefined()
  })

  it('emits only the tighter bound', () => {
    const patch = rangePatch(P(), 'step', 50, 300, 0, 300)
    expect(activeRange(P(patch.filters), 'step')).toEqual({ min: 50 })
  })

  it('preserves unrelated conditions', () => {
    const base = encodeFilterSet({ conditions: [{ key: 'run', op: 'eq', value: 'run-a' }] })
    const patch = rangePatch(P(base), 'score', 0.5, 1, 0, 1)
    expect(activeRange(P(patch.filters), 'score')).toEqual({ min: 0.5 })
    expect(patch.filters).toContain('run')
  })

  it('replaces an existing range on re-apply', () => {
    const first = rangePatch(P(), 'score', 0.2, 0.8, 0, 1).filters
    const second = rangePatch(P(first), 'score', 0.4, 0.9, 0, 1).filters
    expect(activeRange(P(second), 'score')).toEqual({ min: 0.4, max: 0.9 })
  })
})

describe('hasActiveSelection', () => {
  it('is false with no narrowing', () => {
    expect(hasActiveSelection(P())).toBe(false)
  })
  it('is true with a filter DSL', () => {
    expect(hasActiveSelection(P('score.gte.0.5'))).toBe(true)
  })
  it('is true with a quick status/split pick', () => {
    expect(hasActiveSelection({ status: 'failed' })).toBe(true)
    expect(hasActiveSelection({ split: 'test' })).toBe(true)
  })
})
