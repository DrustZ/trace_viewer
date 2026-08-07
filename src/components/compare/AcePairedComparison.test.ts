import { describe, expect, it } from 'vitest'
import { pairedTraceHref } from './AcePairedComparison'

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
})
