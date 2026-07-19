import { describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import type { TraceMeta } from '../../shared/schema/types'
import { TraceStore } from './traceStore'

function fixture(opts: {
  traceId: string
  timestamp?: string
  score?: number | null
}): ParsedTrace {
  const meta: TraceMeta = {
    traceId: opts.traceId,
    instanceId: opts.traceId,
    component: 'test/component',
    status: 'completed',
    timestamp: opts.timestamp ?? '2026-01-01T00:00:00.000Z',
    checkpointStep: 100,
    split: 'train',
    sourceFormat: 'native',
  }
  return {
    meta,
    messages: [
      { id: '', role: 'user', content: 'a question with enough characters' },
      { id: '', role: 'assistant', channel: 'final', content: 'an answer with enough characters' },
    ],
    ...(opts.score !== undefined ? { statsOverrides: { score: opts.score } } : {}),
    warnings: [],
  }
}

describe('TraceStore', () => {
  it('normalizes on upsert: message ids, stepIndex, computed stats, overrides', () => {
    const store = new TraceStore()
    store.upsert(fixture({ traceId: 't1', score: 0.5 }))
    const trace = store.getFull('t1')
    expect(trace).toBeDefined()
    expect(trace?.messages.map((m) => m.id)).toEqual(['m-0', 'm-1'])
    expect(trace?.messages[1].stepIndex).toBe(1)
    expect(trace?.stats.score).toBe(0.5)
    expect(trace?.stats.turns).toBe(1)
    expect(trace?.stats.totalTokens).toBeGreaterThan(0)
  })

  it('upsert replaces by traceId and bumps dataVersion', () => {
    const store = new TraceStore()
    store.upsert(fixture({ traceId: 't1' }), '/a.json')
    const v1 = store.dataVersion
    store.upsert(fixture({ traceId: 't1', score: 1 }), '/b.json')
    expect(store.size).toBe(1)
    expect(store.dataVersion).toBeGreaterThan(v1)
    expect(store.get('t1')?.sourcePath).toBe('/b.json')
    expect(store.getFull('t1')?.stats.score).toBe(1)
  })

  it('remove deletes every trace from a source path', () => {
    const store = new TraceStore()
    store.upsert(fixture({ traceId: 't1' }), '/a.json')
    store.upsert(fixture({ traceId: 't2' }), '/a.json')
    store.upsert(fixture({ traceId: 't3' }), '/b.json')
    const v = store.dataVersion
    expect(store.remove('/a.json')).toBe(2)
    expect(store.size).toBe(1)
    expect(store.dataVersion).toBeGreaterThan(v)
    expect(store.remove('/missing.json')).toBe(0)
    expect(store.dataVersion).toBe(v + 1)
  })

  it('list orders by timestamp asc then traceId, caching per dataVersion', () => {
    const store = new TraceStore()
    store.upsert(fixture({ traceId: 'b', timestamp: '2026-01-02T00:00:00.000Z' }))
    store.upsert(fixture({ traceId: 'c', timestamp: '2026-01-01T00:00:00.000Z' }))
    store.upsert(fixture({ traceId: 'a', timestamp: '2026-01-02T00:00:00.000Z' }))
    const list = store.list()
    expect(list.map((s) => s.meta.traceId)).toEqual(['c', 'a', 'b'])
    expect(store.list()).toBe(list)
    store.upsert(fixture({ traceId: 'd' }))
    expect(store.list()).not.toBe(list)
    expect(store.list()).toHaveLength(4)
  })
})
