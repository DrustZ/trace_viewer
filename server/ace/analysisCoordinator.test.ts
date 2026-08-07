import { describe, expect, it, vi } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import { TraceStore } from '../store/traceStore'
import { type AceAnalysisBridge, AceAnalysisCoordinator } from './analysisCoordinator'

function productionTrace(content = 'Please help with my order.'): ParsedTrace {
  return {
    meta: {
      traceId: 'production-1',
      sourceTraceId: 'production-1',
      corpusId: 'production',
      runId: 'production',
      instanceId: 'production-1',
      component: 'ace/support',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
    },
    messages: [{ id: 'm-1', role: 'user', content }],
    warnings: [],
  }
}

function bundle(code: string) {
  return {
    bundle: {
      schema_version: 1,
      source: { registry: 'ace_detectors', detector_count: 33 },
      traces: {
        'production-1': {
          failures: [
            {
              code,
              severity: 'major',
              evidence: code,
              raw_index: 0,
              chronological_index: 0,
              source: { family: 'agent', tier: 'hard_fact' },
            },
          ],
        },
      },
    },
  }
}

class SequenceBridge implements AceAnalysisBridge {
  calls = 0

  constructor(private readonly responses: Array<unknown | Error>) {}

  async call<T>(): Promise<T> {
    this.calls += 1
    const response = this.responses.shift()
    if (response instanceof Error) throw response
    return response as T
  }
}

describe('AceAnalysisCoordinator', () => {
  it('deduplicates same-source callers, retries failures, and reruns after source changes', async () => {
    const store = new TraceStore()
    const sourcePath = '/production/production-1.json'
    const trace = store.upsert(productionTrace(), sourcePath)
    const bridge = new SequenceBridge([
      new Error('detector temporarily unavailable'),
      bundle('FIRST_CANONICAL_FINDING'),
      bundle('SECOND_CANONICAL_FINDING'),
    ])
    const coordinator = new AceAnalysisCoordinator(store, bridge)

    await expect(Promise.all([coordinator.load(), coordinator.load()])).rejects.toThrow(
      'detector temporarily unavailable',
    )
    expect(bridge.calls).toBe(1)

    await Promise.all([coordinator.load(), coordinator.load()])
    expect(bridge.calls).toBe(2)
    expect(coordinator.statusForTrace(trace.meta.traceUid as string)).toEqual({
      status: 'available',
    })

    store.upsert(productionTrace('The underlying production source changed.'), sourcePath)
    await Promise.all([coordinator.load(), coordinator.load()])
    expect(bridge.calls).toBe(3)
    expect(store.getFull(trace.meta.traceUid as string)?.evaluation?.failures).toEqual([
      expect.objectContaining({ code: 'SECOND_CANONICAL_FINDING' }),
    ])
  })

  it('discards an in-flight old-source response and analyzes the current source before apply', async () => {
    const store = new TraceStore()
    const sourcePath = '/production/production-1.json'
    const trace = store.upsert(productionTrace(), sourcePath)
    let resolveFirst: ((value: unknown) => void) | undefined
    const first = new Promise((resolve) => {
      resolveFirst = resolve
    })
    const bridge: AceAnalysisBridge & { calls: number } = {
      calls: 0,
      async call<T>() {
        this.calls += 1
        if (this.calls === 1) return (await first) as T
        return bundle('CURRENT_SOURCE_FINDING') as T
      },
    }
    const coordinator = new AceAnalysisCoordinator(store, bridge)

    const loading = coordinator.load()
    await vi.waitFor(() => expect(bridge.calls).toBe(1))
    store.upsert(productionTrace('Changed while analysis was running.'), sourcePath)
    resolveFirst?.(bundle('STALE_SOURCE_FINDING'))
    await loading

    expect(bridge.calls).toBe(2)
    expect(store.getFull(trace.meta.traceUid as string)?.evaluation?.failures).toEqual([
      expect.objectContaining({ code: 'CURRENT_SOURCE_FINDING' }),
    ])
  })

  it('marks a production trace unavailable when the canonical bundle did not cover it', async () => {
    const store = new TraceStore()
    const trace = store.upsert(productionTrace(), '/production/production-1.json')
    const bridge = new SequenceBridge([{ bundle: { traces: {} } }])
    const coordinator = new AceAnalysisCoordinator(store, bridge)

    await coordinator.load()

    expect(coordinator.statusForTrace(trace.meta.traceUid as string)).toEqual({
      status: 'unavailable',
      reason: 'trace_not_covered',
    })
  })

  it('deduplicates concurrent forced refreshes while bypassing the completed cache', async () => {
    const store = new TraceStore()
    store.upsert(productionTrace(), '/production/production-1.json')
    const bridge = new SequenceBridge([bundle('INITIAL_FINDING'), bundle('FORCED_REFRESH_FINDING')])
    const coordinator = new AceAnalysisCoordinator(store, bridge)

    await coordinator.load()
    await Promise.all([coordinator.load(true), coordinator.load(true)])

    expect(bridge.calls).toBe(2)
    expect(store.list()[0].evaluation?.failures).toEqual([
      expect.objectContaining({ code: 'FORCED_REFRESH_FINDING' }),
    ])
  })

  it('reapplies the cached bundle when a watcher rescan removes detector overlays', async () => {
    const store = new TraceStore()
    const sourcePath = '/production/production-1.json'
    const trace = store.upsert(productionTrace(), sourcePath)
    const traceUid = trace.meta.traceUid as string
    const bridge = new SequenceBridge([bundle('RESCAN_STABLE_FINDING')])
    const coordinator = new AceAnalysisCoordinator(store, bridge)

    await coordinator.load()
    expect(coordinator.statusForTrace(traceUid)).toEqual({ status: 'available' })
    expect(store.getFull(traceUid)?.evaluation?.failures).toHaveLength(1)

    store.replaceSource([productionTrace()], sourcePath)
    expect(store.getFull(traceUid)?.evaluation?.failures ?? []).toHaveLength(0)
    expect(coordinator.statusForTrace(traceUid)).toEqual({
      status: 'unavailable',
      reason: 'not_loaded_for_current_source',
    })

    await coordinator.load()
    expect(bridge.calls).toBe(1)
    expect(coordinator.statusForTrace(traceUid)).toEqual({ status: 'available' })
    expect(store.getFull(traceUid)?.evaluation?.failures).toEqual([
      expect.objectContaining({ code: 'RESCAN_STABLE_FINDING' }),
    ])
  })
})
