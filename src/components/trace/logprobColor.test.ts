import { describe, expect, it } from 'vitest'
import { BUCKET_CLASSES, BUCKET_LABELS, logprobToBucket } from './logprobColor'

describe('logprobToBucket', () => {
  it('maps logprob 0 (p = 1) to bucket 0', () => {
    expect(logprobToBucket(0)).toBe(0)
  })

  it('maps exact boundary probabilities to the higher-confidence bucket', () => {
    expect(logprobToBucket(Math.log(0.9))).toBe(0)
    expect(logprobToBucket(Math.log(0.7))).toBe(1)
    expect(logprobToBucket(Math.log(0.4))).toBe(2)
    expect(logprobToBucket(Math.log(0.15))).toBe(3)
  })

  it('maps probabilities just below each boundary to the next bucket', () => {
    expect(logprobToBucket(Math.log(0.89))).toBe(1)
    expect(logprobToBucket(Math.log(0.69))).toBe(2)
    expect(logprobToBucket(Math.log(0.39))).toBe(3)
    expect(logprobToBucket(Math.log(0.14))).toBe(4)
  })

  it('maps mid-range probabilities to the expected buckets', () => {
    expect(logprobToBucket(Math.log(0.95))).toBe(0)
    expect(logprobToBucket(Math.log(0.8))).toBe(1)
    expect(logprobToBucket(Math.log(0.5))).toBe(2)
    expect(logprobToBucket(Math.log(0.2))).toBe(3)
  })

  it('maps very negative logprobs to bucket 4', () => {
    expect(logprobToBucket(-10)).toBe(4)
    expect(logprobToBucket(-100)).toBe(4)
    expect(logprobToBucket(Number.NEGATIVE_INFINITY)).toBe(4)
  })
})

describe('bucket constants', () => {
  it('provides one class and one label per bucket', () => {
    expect(BUCKET_CLASSES).toHaveLength(5)
    expect(BUCKET_LABELS).toHaveLength(5)
    expect(BUCKET_CLASSES[0]).toBe('')
  })
})
