import { describe, expect, it } from 'vitest'
import { decodeFilterSet, encodeFilterSet } from './parse'
import type { FilterSet } from './types'

describe('encodeFilterSet', () => {
  it('encodes an empty set as the empty string', () => {
    expect(encodeFilterSet({ conditions: [] })).toBe('')
  })

  it('URI-encodes values and joins in-arrays with |', () => {
    const fs: FilterSet = {
      conditions: [
        { key: 'score', op: 'gte', value: '0.25' },
        { key: 'component', op: 'eq', value: 'swe/swebench-verified-mini' },
        { key: 'split', op: 'in', value: ['train', 'test'] },
      ],
    }
    expect(encodeFilterSet(fs)).toBe(
      'score.gte.0.25;component.eq.swe%2Fswebench-verified-mini;split.in.train%7Ctest',
    )
  })

  it('stringifies number and boolean values', () => {
    const fs: FilterSet = {
      conditions: [
        { key: 'score', op: 'gt', value: 0.5 },
        { key: 'truncated', op: 'eq', value: true },
      ],
    }
    expect(encodeFilterSet(fs)).toBe('score.gt.0.5;truncated.eq.true')
  })
})

describe('decodeFilterSet round-trip', () => {
  it('preserves a set covering every op, dotted values and in-arrays', () => {
    const fs: FilterSet = {
      conditions: [
        { key: 'score', op: 'gte', value: '0.25' },
        { key: 'component', op: 'eq', value: 'swe/swebench-verified-mini' },
        { key: 'status', op: 'neq', value: 'failed' },
        { key: 'turns', op: 'lt', value: '10' },
        { key: 'thinkingPortion', op: 'lte', value: '0.75' },
        { key: 'step', op: 'gt', value: '100' },
        { key: 'model', op: 'contains', value: 'oss' },
        { key: 'split', op: 'in', value: ['train', 'test'] },
      ],
    }
    expect(decodeFilterSet(encodeFilterSet(fs))).toEqual(fs)
  })

  it('keeps dotted values intact by splitting on the first two dots only', () => {
    const decoded = decodeFilterSet('score.lte.0.25')
    expect(decoded.conditions).toEqual([{ key: 'score', op: 'lte', value: '0.25' }])
  })

  it('decodes numeric-looking values as strings', () => {
    const decoded = decodeFilterSet(
      encodeFilterSet({ conditions: [{ key: 'step', op: 'eq', value: 150 }] }),
    )
    expect(decoded.conditions).toEqual([{ key: 'step', op: 'eq', value: '150' }])
  })
})

describe('decodeFilterSet tolerance', () => {
  it('returns an empty set for null, undefined and empty input', () => {
    expect(decodeFilterSet(null)).toEqual({ conditions: [] })
    expect(decodeFilterSet(undefined)).toEqual({ conditions: [] })
    expect(decodeFilterSet('')).toEqual({ conditions: [] })
  })

  it('drops junk segments and keeps the valid ones', () => {
    const decoded = decodeFilterSet(
      'garbage;;notakey.eq.5;score.wat.3;score.lt.;justonedot.;score.lt.0.2',
    )
    expect(decoded.conditions).toEqual([{ key: 'score', op: 'lt', value: '0.2' }])
  })

  it('drops segments with invalid percent-encoding', () => {
    expect(decodeFilterSet('component.eq.%ZZ;turns.gt.3').conditions).toEqual([
      { key: 'turns', op: 'gt', value: '3' },
    ])
  })

  it('drops in-conditions whose values are all empty', () => {
    expect(decodeFilterSet('split.in.%7C').conditions).toEqual([])
    expect(decodeFilterSet('split.in.train%7C').conditions).toEqual([
      { key: 'split', op: 'in', value: ['train'] },
    ])
  })

  it('never throws on arbitrary junk', () => {
    expect(() => decodeFilterSet('....;%%%;a.b.c.d.e;😀')).not.toThrow()
  })
})
