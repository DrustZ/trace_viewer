import { type Response, Router } from 'express'
import type { LiveEvent } from '../../shared/schema/events'
import type { RouteCtx } from './context'

const JOURNAL_LIMIT = 1_000
const HEARTBEAT_MS = 15_000

type Subscriber = (event: LiveEvent) => void

export interface ReplaySubscriptionHandlers {
  onEvent: Subscriber
  /** Called instead of replaying an incomplete journal window. The id is the snapshot cursor. */
  onGap: (resumeAfterId: number) => void
}

/**
 * Small in-memory replay journal. The filesystem/store is authoritative; the journal only
 * eliminates polling latency and lets a reconnect catch up without a full refresh.
 */
export class LiveEventJournal {
  private nextId = 1
  private events: LiveEvent[] = []
  private subscribers = new Set<Subscriber>()
  private dispatchQueue: LiveEvent[] = []
  private dispatching = false

  publish(event: Omit<LiveEvent, 'id' | 'timestamp'>): LiveEvent {
    const published: LiveEvent = {
      ...event,
      id: this.nextId++,
      timestamp: new Date().toISOString(),
    }
    this.events.push(published)
    if (this.events.length > JOURNAL_LIMIT)
      this.events.splice(0, this.events.length - JOURNAL_LIMIT)
    this.dispatchQueue.push(published)
    this.drainDispatchQueue()
    return published
  }

  private drainDispatchQueue(): void {
    if (this.dispatching) return
    this.dispatching = true
    try {
      while (this.dispatchQueue.length > 0) {
        const event = this.dispatchQueue.shift() as LiveEvent
        // Snapshot the set so a subscription created re-entrantly while this event is being
        // delivered receives it through replay, never a second time from the active iteration.
        for (const subscriber of [...this.subscribers]) subscriber(event)
      }
    } finally {
      this.dispatching = false
    }
  }

  since(cursor: number): { events: LiveEvent[]; gap: boolean } {
    const oldest = this.events[0]?.id
    const newest = this.events.at(-1)?.id
    return {
      events: this.events.filter((event) => event.id > cursor),
      // A cursor ahead of this process' journal usually means the server restarted
      // and event ids began again at 1. An empty fresh journal has the same meaning.
      gap:
        cursor > 0 &&
        (oldest === undefined || cursor < oldest - 1 || (newest !== undefined && cursor > newest)),
    }
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  /**
   * Atomically attaches a subscriber and replays everything after its cursor.
   *
   * The subscriber is registered in buffering mode before the replay window is captured. Events
   * published re-entrantly while replay is written are queued, de-duplicated by id, and delivered
   * after the replay in journal order. This closes the otherwise unavoidable since()/subscribe()
   * boundary where a committed filesystem update could be lost.
   */
  replayAndSubscribe(cursor: number, handlers: ReplaySubscriptionHandlers): () => void {
    let phase: 'buffering' | 'live' | 'closed' = 'buffering'
    let lastDeliveredId = cursor
    const buffered: LiveEvent[] = []

    const deliver = (event: LiveEvent): void => {
      if (event.id <= lastDeliveredId) return
      lastDeliveredId = event.id
      handlers.onEvent(event)
    }
    const subscriber: Subscriber = (event) => {
      if (phase === 'closed' || event.id <= lastDeliveredId) return
      if (phase === 'live') deliver(event)
      else buffered.push(event)
    }

    this.subscribers.add(subscriber)
    try {
      const replay = this.since(cursor)
      const replayThroughId = this.events.at(-1)?.id ?? 0
      if (replay.gap) {
        // Reset a stale/ahead cursor to the journal head. The route emits snapshot.required only
        // to this connection; future events resume at replayThroughId + 1.
        lastDeliveredId = replayThroughId
        handlers.onGap(replayThroughId)
      } else {
        for (const event of replay.events) {
          if (event.id <= replayThroughId) deliver(event)
        }
      }

      // Re-entrant publishes have increasing ids. Sorting also makes the ordering guarantee
      // explicit if a custom subscriber invokes this method from inside journal dispatch.
      buffered.sort((a, b) => a.id - b.id)
      for (let index = 0; index < buffered.length; index += 1) deliver(buffered[index])
      phase = 'live'
    } catch (error) {
      phase = 'closed'
      this.subscribers.delete(subscriber)
      throw error
    }

    return () => {
      phase = 'closed'
      this.subscribers.delete(subscriber)
    }
  }
}

function writeEvent(res: Response, event: LiveEvent): void {
  res.write(`id: ${event.id}\n`)
  res.write(`event: ${event.type}\n`)
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function cursorFrom(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

/** Builds the connection-local snapshot signal without appending it to the shared journal. */
export function subscribeToLiveEvents(
  journal: LiveEventJournal,
  cursor: number,
  dataVersion: () => number,
  subscriber: Subscriber,
): () => void {
  return journal.replayAndSubscribe(cursor, {
    onEvent: subscriber,
    onGap: (resumeAfterId) =>
      subscriber({
        id: resumeAfterId,
        type: 'snapshot.required',
        dataVersion: dataVersion(),
        timestamp: new Date().toISOString(),
      }),
  })
}

export function eventsRoutes(ctx: RouteCtx, supplied?: LiveEventJournal): Router {
  const router = Router()
  const journal = supplied ?? new LiveEventJournal()

  // TraceStore emits only after a successful mutation, so clients never observe a half-parsed file.
  ctx.store.subscribe((event) => {
    journal.publish({
      type: event.type,
      dataVersion: event.dataVersion,
      ...(event.traceUid ? { traceUid: event.traceUid } : {}),
      ...(event.runId ? { runId: event.runId } : {}),
    })
  })

  router.get('/api/events', (req, res) => {
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const headerCursor = cursorFrom(req.header('last-event-id'))
    const queryCursor = cursorFrom(req.query.after)
    const cursor = Math.max(headerCursor, queryCursor)
    const unsubscribe = subscribeToLiveEvents(
      journal,
      cursor,
      () => ctx.store.dataVersion,
      (event) => writeEvent(res, event),
    )
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS)
    req.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      res.end()
    })
  })

  return router
}
