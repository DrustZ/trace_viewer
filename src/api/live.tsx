import type { LiveEvent, LiveEventType } from '@shared/schema/events'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

const EVENT_TYPES: LiveEventType[] = [
  'trace.upserted',
  'trace.removed',
  'store.reset',
  'batch.updated',
  'snapshot.required',
]

/** Keeps every route—including a standalone trace page—fresh without corpus polling. */
export function LiveUpdates() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource('/api/events')
    const onEvent = (raw: MessageEvent<string>) => {
      let event: LiveEvent
      try {
        event = JSON.parse(raw.data) as LiveEvent
      } catch {
        return
      }

      if (event.type === 'trace.upserted' && event.traceUid) {
        void queryClient.invalidateQueries({ queryKey: ['trace', event.traceUid] })
        void queryClient.invalidateQueries({ queryKey: ['trace-raw', event.traceUid] })
      }
      // Lists, aggregates, run state, compare, and review queues may all depend on the update.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'trace-raw',
      })
    }

    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent as EventListener)
    return () => source.close()
  }, [queryClient])

  return null
}
