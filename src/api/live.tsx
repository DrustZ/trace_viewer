import type { LiveEvent, LiveEventType } from '@shared/schema/events'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { apiFetch } from './client'
import { createLiveInvalidationScheduler } from './liveInvalidation'

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
    const invalidations = createLiveInvalidationScheduler(queryClient)
    // Same-origin cookies are sent by default; withCredentials also keeps this correct if the
    // frontend is later hosted on another trusted origin with credentialed CORS enabled.
    const source = new EventSource('/api/events', { withCredentials: true })
    const onEvent = (raw: MessageEvent<string>) => {
      let event: LiveEvent
      try {
        event = JSON.parse(raw.data) as LiveEvent
      } catch {
        return
      }

      invalidations.schedule(event)
    }

    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent as EventListener)
    // EventSource does not expose an HTTP status. Probe a small protected endpoint on failure so
    // an expired/missing session still opens the global unlock prompt; ordinary outages stay in
    // EventSource's native reconnect loop without locking the UI.
    source.onerror = () => {
      void apiFetch('/api/meta').catch(() => undefined)
    }
    return () => {
      invalidations.dispose()
      source.close()
    }
  }, [queryClient])

  return null
}
