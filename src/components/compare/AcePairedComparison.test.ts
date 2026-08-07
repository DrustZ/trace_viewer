import type { AceBatchEpisode } from '@shared/schema/ace'
import { describe, expect, it } from 'vitest'
import { pairAceRuns, pairedPassInterval, pairedTraceHref } from './AcePairedComparison'

function episode(
  pairKey: string,
  outcome: AceBatchEpisode['outcome'],
  suffix: string,
): AceBatchEpisode {
  return {
    scenarioId: `scenario-${suffix}`,
    seed: 1,
    sourceTraceId: `trace-${suffix}`,
    status: 'completed',
    outcome,
    failedChecks: [],
    flagsMajor: 0,
    flagsMinor: 0,
    invalidUserSim: false,
    environmentSeed: 1,
    pairKey,
  }
}

describe('ACE matched-pair links', () => {
  it('opens both exact durable traces without losing run identity', () => {
    const href = pairedTraceHref(
      'baseline chat',
      'candidate/tool',
      'refund-01',
      'simulation:baseline:trace-1',
      'simulation:candidate:trace-1',
    )
    const url = new URL(href, 'http://localhost')

    expect(url.pathname).toBe('/compare')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      runA: 'baseline chat',
      runB: 'candidate/tool',
      instance: 'refund-01',
      traceA: 'simulation:baseline:trace-1',
      traceB: 'simulation:candidate:trace-1',
    })
  })

  it('still opens the matched scenario while durable traces are pending', () => {
    const url = new URL(pairedTraceHref('a', 'b', 'task-1'), 'http://localhost')
    expect(url.searchParams.get('instance')).toBe('task-1')
    expect(url.searchParams.has('traceA')).toBe(false)
    expect(url.searchParams.has('traceB')).toBe(false)
  })

  it('excludes a pair key entirely when it is duplicated on either arm', () => {
    const uniqueKey = 'schedule:unique:1'
    const duplicateAKey = 'schedule:duplicate-a:1'
    const duplicateBKey = 'schedule:duplicate-b:1'
    const result = pairAceRuns(
      [
        episode(duplicateAKey, 'pass', 'a-duplicate-1'),
        episode(duplicateAKey, 'fail', 'a-duplicate-2'),
        episode(duplicateBKey, 'pass', 'a-counterpart'),
        episode(uniqueKey, 'fail', 'a-unique'),
      ],
      [
        episode(duplicateAKey, 'pass', 'b-counterpart'),
        episode(duplicateBKey, 'pass', 'b-duplicate-1'),
        episode(duplicateBKey, 'fail', 'b-duplicate-2'),
        episode(uniqueKey, 'pass', 'b-unique'),
      ],
    )

    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]).toMatchObject({ key: uniqueKey, delta: 'improvement' })
    expect(result.integrity).toEqual({
      missingPairKeyRowsA: 0,
      missingPairKeyRowsB: 0,
      duplicateKeysA: [duplicateAKey],
      duplicateKeysB: [duplicateBKey],
      excludedDuplicatePairKeys: [duplicateAKey, duplicateBKey],
      excludedRowsA: 3,
      excludedRowsB: 3,
      unmatchedUniqueA: 0,
      unmatchedUniqueB: 0,
    })
    expect(pairedPassInterval(result.pairs)).toEqual({ delta: 1, low: null, high: null, n: 1 })
  })

  it('reports unmatched unique keys without counting them as duplicate exclusions', () => {
    const result = pairAceRuns(
      [episode('schedule:only-a:1', 'pass', 'only-a')],
      [episode('schedule:only-b:1', 'fail', 'only-b')],
    )

    expect(result.pairs).toEqual([])
    expect(result.integrity).toEqual({
      missingPairKeyRowsA: 0,
      missingPairKeyRowsB: 0,
      duplicateKeysA: [],
      duplicateKeysB: [],
      excludedDuplicatePairKeys: [],
      excludedRowsA: 0,
      excludedRowsB: 0,
      unmatchedUniqueA: 1,
      unmatchedUniqueB: 1,
    })
  })

  it('keeps missing pair identity visible and never matches it', () => {
    const left = episode('ignored-a', 'pass', 'missing-a')
    const right = episode('ignored-b', 'pass', 'missing-b')
    delete left.pairKey
    delete right.pairKey

    expect(pairAceRuns([left], [right])).toEqual({
      pairs: [],
      integrity: {
        missingPairKeyRowsA: 1,
        missingPairKeyRowsB: 1,
        duplicateKeysA: [],
        duplicateKeysB: [],
        excludedDuplicatePairKeys: [],
        excludedRowsA: 0,
        excludedRowsB: 0,
        unmatchedUniqueA: 0,
        unmatchedUniqueB: 0,
      },
    })
  })

  it('reports no estimate when every matched row is invalid or ungraded', () => {
    const pairing = pairAceRuns(
      [episode('schedule:invalid:1', 'invalid', 'a-invalid')],
      [episode('schedule:invalid:1', 'ungraded', 'b-ungraded')],
    )

    expect(pairing.pairs[0]?.delta).toBe('not_comparable')
    expect(pairedPassInterval(pairing.pairs)).toEqual({
      delta: null,
      low: null,
      high: null,
      n: 0,
    })
  })

  it('labels its small-sample normal interval and computes comparable n explicitly', () => {
    const pairing = pairAceRuns(
      [episode('schedule:one:1', 'fail', 'a-one'), episode('schedule:two:1', 'pass', 'a-two')],
      [episode('schedule:one:1', 'pass', 'b-one'), episode('schedule:two:1', 'pass', 'b-two')],
    )

    expect(pairedPassInterval(pairing.pairs)).toEqual({
      delta: 0.5,
      low: expect.closeTo(-0.48, 10),
      high: 1,
      n: 2,
    })
  })
})
