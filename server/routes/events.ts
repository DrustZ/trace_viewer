import { type Response, Router } from 'express'
import type { LiveEvent } from '../../shared/schema/events'
import type { RouteCtx } from './context'

const JOURNAL_LIMIT = 1_000
const HEARTBEAT_MS = 15_000

type Subscriber = (event: LiveEvent) => void

/**
 * Small in-memory replay journal. The filesystem/store is authoritative; the journal only
 * eliminates polling latency and lets a reconnect catch up without a full refresh.
 */
export class LiveEventJournal {
  private nextId = 1
  private events: LiveEvent[] = []
  private subscribers = new Set<Subscriber>()

  publish(event: Omit<LiveEvent, 'id' | 'timestamp'>): LiveEvent {
    const published: LiveEvent = {
      ...event,
      id: this.nextId++,
      timestamp: new Date().toISOString(),
    }
    this.events.push(published)
    if (this.events.length > JOURNAL_LIMIT)
      this.events.splice(0, this.events.length - JOURNAL_LIMIT)
    for (const subscriber of this.subscribers) subscriber(published)
    return published
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
    const replay = journal.since(cursor)
    if (replay.gap) {
      writeEvent(
        res,
        journal.publish({ type: 'snapshot.required', dataVersion: ctx.store.dataVersion }),
      )
    } else {
      for (const event of replay.events) writeEvent(res, event)
    }

    const unsubscribe = journal.subscribe((event) => writeEvent(res, event))
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS)
    req.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      res.end()
    })
  })

  return router
}
