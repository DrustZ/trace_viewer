import { describe, expect, it, vi } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import type { LiveEvent } from '../../shared/schema/events'
import { SearchIndex } from '../search/searchIndex'
import { TraceStore } from '../store/traceStore'
import type { RouteCtx } from './context'
import { eventsRoutes, LiveEventJournal, subscribeToLiveEvents } from './events'

function fixture(traceId: string): ParsedTrace {
  return {
    meta: {
      traceId,
      instanceId: traceId,
      component: 'events/test',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'native',
    },
    messages: [],
    warnings: [],
  }
}

function context(store: TraceStore): RouteCtx {
  return {
    store,
    searchIndex: new SearchIndex(store),
    dataRoots: [],
    importDir: 'unused',
  }
}

describe('LiveEventJournal', () => {
  it('assigns increasing ids and only replays events after the cursor', () => {
    const journal = new LiveEventJournal()
    const first = journal.publish({ type: 'store.reset', dataVersion: 1 })
    const second = journal.publish({
      type: 'trace.upserted',
      traceUid: 'trace-2',
      dataVersion: 2,
    })

    expect(first.id).toBe(1)
    expect(second.id).toBe(2)
    expect(journal.since(1)).toEqual({ events: [second], gap: false })
    expect(journal.since(2)).toEqual({ events: [], gap: false })
  })

  it('detects both an evicted cursor and a cursor from a previous server process', () => {
    const journal = new LiveEventJournal()
    for (let index = 1; index <= 1_002; index += 1) {
      journal.publish({ type: 'store.reset', dataVersion: index })
    }

    const evicted = journal.since(1)
    expect(evicted.gap).toBe(true)
    expect(evicted.events).toHaveLength(1_000)
    expect(evicted.events[0].id).toBe(3)
    expect(journal.since(2).gap).toBe(false)
    expect(journal.since(50_000)).toEqual({ events: [], gap: true })

    const freshProcess = new LiveEventJournal()
    expect(freshProcess.since(50_000)).toEqual({ events: [], gap: true })
  })

  it('stops notifying a subscriber after unsubscribe', () => {
    const journal = new LiveEventJournal()
    const subscriber = vi.fn()
    const unsubscribe = journal.subscribe(subscriber)
    journal.publish({ type: 'store.reset', dataVersion: 1 })
    unsubscribe()
    journal.publish({ type: 'store.reset', dataVersion: 2 })

    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(subscriber.mock.calls[0][0]).toMatchObject({ id: 1, dataVersion: 1 })
  })

  it('buffers a publish at the replay/subscribe boundary without loss or duplication', () => {
    const journal = new LiveEventJournal()
    journal.publish({ type: 'store.reset', dataVersion: 1 })
    journal.publish({ type: 'store.reset', dataVersion: 2 })
    const delivered: number[] = []

    const unsubscribe = journal.replayAndSubscribe(0, {
      onGap: () => {
        throw new Error('unexpected replay gap')
      },
      onEvent: (event) => {
        delivered.push(event.id)
        if (event.id === 1) journal.publish({ type: 'store.reset', dataVersion: 3 })
      },
    })
    journal.publish({ type: 'store.reset', dataVersion: 4 })
    unsubscribe()

    expect(delivered).toEqual([1, 2, 3, 4])
    expect(new Set(delivered).size).toBe(delivered.length)
  })

  it('keeps re-entrant publication ordered for every subscriber', () => {
    const journal = new LiveEventJournal()
    const firstClient: number[] = []
    const secondClient: number[] = []
    journal.subscribe((event) => {
      firstClient.push(event.id)
      if (event.id === 1) journal.publish({ type: 'store.reset', dataVersion: 2 })
    })
    journal.subscribe((event) => secondClient.push(event.id))

    journal.publish({ type: 'store.reset', dataVersion: 1 })

    expect(firstClient).toEqual([1, 2])
    expect(secondClient).toEqual([1, 2])
  })

  it('reports an evicted cursor only to that client and does not journal the snapshot signal', () => {
    const journal = new LiveEventJournal()
    for (let index = 1; index <= 1_002; index += 1) {
      journal.publish({ type: 'store.reset', dataVersion: index })
    }
    const currentClient: LiveEvent[] = []
    const laggingClient: LiveEvent[] = []
    subscribeToLiveEvents(
      journal,
      1_002,
      () => 1_002,
      (event) => currentClient.push(event),
    )
    subscribeToLiveEvents(
      journal,
      1,
      () => 1_002,
      (event) => laggingClient.push(event),
    )

    expect(currentClient).toEqual([])
    expect(laggingClient).toEqual([
      expect.objectContaining({ id: 1_002, type: 'snapshot.required', dataVersion: 1_002 }),
    ])
    expect(journal.since(1_002).events).toEqual([])

    journal.publish({ type: 'trace.upserted', traceUid: 'fresh', dataVersion: 1_003 })
    expect(currentClient.map((event) => event.id)).toEqual([1_003])
    expect(laggingClient.map((event) => event.id)).toEqual([1_002, 1_003])
    expect(journal.since(1_002).events.map((event) => event.type)).toEqual(['trace.upserted'])
  })

  it('publishes only committed TraceStore mutations with canonical trace uids', () => {
    const store = new TraceStore()
    const journal = new LiveEventJournal()
    // Constructing the route attaches the store-to-journal adapter.
    eventsRoutes(context(store), journal)

    const trace = store.upsert(fixture('same-producer-id'), '/a/first.json')
    store.upsert(fixture('same-producer-id'), '/b/second.json')
    store.remove('/a/first.json')

    const events = journal.since(0).events
    expect(events.map((event) => event.type)).toEqual([
      'trace.upserted',
      'trace.upserted',
      'trace.removed',
    ])
    expect(events[0].traceUid).toBe(trace.meta.traceUid)
    expect(events[0].traceUid).not.toBe('same-producer-id')
    expect(events.map((event) => event.runId)).toEqual(['run-a', 'run-a', 'run-a'])
    expect(events.map((event) => event.dataVersion)).toEqual([1, 2, 3])
  })

  it('forwards validated batch updates with their run id', () => {
    const store = new TraceStore()
    const journal = new LiveEventJournal()
    eventsRoutes(context(store), journal)

    store.notifyBatchUpdated('cockpit-live-run')

    expect(journal.since(0).events).toEqual([
      expect.objectContaining({
        id: 1,
        type: 'batch.updated',
        runId: 'cockpit-live-run',
        dataVersion: 1,
      }),
    ])
  })
})
