import { describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import type { TraceEvaluation, TraceMeta } from '../../shared/schema/types'
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

  it('upsert replaces the same source identity and bumps dataVersion', () => {
    const store = new TraceStore()
    store.upsert(fixture({ traceId: 't1' }), '/a.json')
    const v1 = store.dataVersion
    store.upsert(fixture({ traceId: 't1', score: 1 }), '/a.json')
    expect(store.size).toBe(1)
    expect(store.dataVersion).toBeGreaterThan(v1)
    expect(store.get('t1')?.sourcePath).toBe('/a.json')
    expect(store.getFull('t1')?.stats.score).toBe(1)
  })

  it('treats a semantically identical source replacement as a no-op', () => {
    const store = new TraceStore()
    const events: Array<{ type: string; dataVersion: number }> = []
    store.subscribe((event) => events.push(event))

    store.replaceSource([fixture({ traceId: 'same-source' })], '/same-source.json')
    const version = store.dataVersion
    const cached = store.list()

    store.replaceSource([fixture({ traceId: 'same-source' })], '/same-source.json')

    expect(store.dataVersion).toBe(version)
    expect(store.list()).toBe(cached)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'trace.upserted', dataVersion: version })

    store.replaceSource([fixture({ traceId: 'same-source', score: 1 })], '/same-source.json')
    expect(store.dataVersion).toBe(version + 1)
    expect(store.getFull('same-source')?.stats.score).toBe(1)
    expect(events).toHaveLength(2)
  })

  it('keeps duplicate producer ids addressable by uid and rejects ambiguous legacy lookup', () => {
    const store = new TraceStore()
    const first = store.upsert(fixture({ traceId: 'same' }), '/run-a/same.json')
    const second = store.upsert(fixture({ traceId: 'same' }), '/run-b/same.json')

    expect(store.size).toBe(2)
    expect(first.meta.traceUid).not.toBe(second.meta.traceUid)
    expect(store.get('same')).toBeUndefined()
    expect(store.lookup('same')).toEqual({
      kind: 'ambiguous',
      sourceTraceId: 'same',
      candidates: [first.meta.traceUid, second.meta.traceUid].sort(),
    })
    expect(store.getFull(first.meta.traceUid as string)?.meta.sourceTraceId).toBe('same')
  })

  it('publishes committed mutations and supports unsubscribe', () => {
    const store = new TraceStore()
    const events: Array<{ type: string; traceUid?: string; dataVersion: number }> = []
    const unsubscribe = store.subscribe((event) => events.push(event))
    const trace = store.upsert(fixture({ traceId: 'events' }), '/events.json')
    store.remove('/events.json')
    store.upsert(fixture({ traceId: 'reset' }), '/reset.json')
    store.clear()
    unsubscribe()
    store.upsert(fixture({ traceId: 'ignored' }), '/ignored.json')

    expect(events.map((event) => event.type)).toEqual([
      'trace.upserted',
      'trace.removed',
      'trace.upserted',
      'store.reset',
    ])
    expect(events[0]).toMatchObject({ traceUid: trace.meta.traceUid, dataVersion: 1 })
    expect(events[1]).toMatchObject({ traceUid: trace.meta.traceUid, dataVersion: 2 })
    expect(events[3].dataVersion).toBe(4)
  })

  it('immutably overlays detector evaluation without losing source or raw data', () => {
    const store = new TraceStore()
    const initial = store.upsert(fixture({ traceId: 'overlay' }), '/overlay.json', 'raw transcript')
    const traceUid = initial.meta.traceUid as string
    const originalMessages = initial.messages
    const events: string[] = []
    store.subscribe((event) => events.push(`${event.type}:${event.traceUid}`))
    const evaluation: TraceEvaluation = {
      lifecycle: { state: 'completed' },
      outcome: 'ungraded',
      checks: [],
      metrics: {},
      failures: [
        {
          origin: 'detector',
          code: 'canonical_detector',
          severity: 'major',
          gating: false,
          source: 'ace.detector.bundle',
        },
      ],
      flags: [],
      worldDiff: [],
      ledger: [],
    }

    const enriched = store.updateEvaluation(traceUid, evaluation, {
      detector_bundle_digest: 'bundle-1',
    })

    expect(enriched?.messages).toBe(originalMessages)
    expect(enriched?.evaluation).toBe(evaluation)
    expect(enriched?.meta.extra?.detector_bundle_digest).toBe('bundle-1')
    expect(store.get(traceUid)).toMatchObject({
      sourcePath: '/overlay.json',
      rawText: 'raw transcript',
    })
    expect(events).toEqual([`trace.upserted:${traceUid}`])
  })

  it('re-anchors indexed failures when detector evaluation is overlaid', () => {
    const store = new TraceStore()
    const initial = store.upsert(fixture({ traceId: 'anchored-overlay' }), '/anchored.json')
    const traceUid = initial.meta.traceUid as string
    const evaluation: TraceEvaluation = {
      lifecycle: { state: 'completed' },
      outcome: 'ungraded',
      checks: [],
      metrics: {},
      failures: [
        {
          origin: 'detector',
          code: 'bad_turn',
          severity: 'major',
          gating: false,
          source: 'ace.detector.bundle',
          rawIndex: 0,
          indexSpace: 'raw',
          evidence: { reason: 'fixture' },
        },
      ],
      flags: [],
      worldDiff: [],
      ledger: [],
    }

    const enriched = store.updateEvaluation(traceUid, evaluation)

    expect(enriched?.messages).not.toBe(initial.messages)
    expect(initial.messages[0].metadata?.aceFailures).toBeUndefined()
    expect(enriched?.messages[0].metadata?.aceFailures).toEqual([
      {
        id: 'detector:bad_turn:0',
        code: 'bad_turn',
        severity: 'major',
        origin: 'detector',
        evidence: { reason: 'fixture' },
      },
    ])
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
