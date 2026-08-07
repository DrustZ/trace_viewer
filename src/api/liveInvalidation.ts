import type { LiveEvent } from '@shared/schema/events'
import type { Query, QueryClient } from '@tanstack/react-query'

export const LIVE_INVALIDATION_DEBOUNCE_MS = 75

type InvalidationFilters = NonNullable<Parameters<QueryClient['invalidateQueries']>[0]>

interface InvalidationTarget {
  id: string
  filters: InvalidationFilters
}

const TRACE_COLLECTION_KEYS = [
  'meta',
  'runs',
  'traces',
  'neighbors',
  'siblings',
  'tiles',
  'component-aggregates',
  'curves',
  'evolution',
  'search',
  'ace-runs',
  'ace-tasks',
  'ace-task',
  'review-queue',
] as const

function prefixTarget(key: string): InvalidationTarget {
  return { id: `prefix:${key}`, filters: { queryKey: [key] } }
}

function exactTarget(key: string, value: string): InvalidationTarget {
  return {
    id: `exact:${key}:${value}`,
    filters: { queryKey: [key, value], exact: true },
  }
}

function querySubjectTraceUid(query: Query): string | undefined {
  const subject = query.queryKey[1]
  if (typeof subject !== 'object' || subject === null || !('traceUid' in subject)) return undefined
  const traceUid = subject.traceUid
  return typeof traceUid === 'string' ? traceUid : undefined
}

function dashboardIncludesRun(query: Query, runId: string): boolean {
  if (query.queryKey[0] !== 'ace-dashboard') return false
  const selected = query.queryKey[1]
  // An empty selection is the default formal-run dashboard and can include any scored run.
  return Array.isArray(selected) && (selected.length === 0 || selected.includes(runId))
}

/** Maps one durable server event to the smallest query families that can depend on it. */
export function invalidationTargets(event: LiveEvent): InvalidationTarget[] | 'all' {
  if (event.type === 'snapshot.required' || event.type === 'store.reset') return 'all'

  if (event.type === 'batch.updated') {
    const targets = [prefixTarget('ace-runs')]
    if (event.runId) {
      targets.push(exactTarget('ace-run', event.runId))
      targets.push({
        id: `ace-dashboard:${event.runId}`,
        filters: { predicate: (query) => dashboardIncludesRun(query, event.runId as string) },
      })
    } else {
      targets.push(prefixTarget('ace-dashboard'))
    }
    return targets
  }

  const targets: InvalidationTarget[] = TRACE_COLLECTION_KEYS.map(prefixTarget)
  if (event.traceUid) {
    for (const key of ['trace', 'trace-raw', 'ace-checkpoints', 'ace-regression-capability']) {
      targets.push(exactTarget(key, event.traceUid))
    }
    targets.push({
      id: `review-workspace:${event.traceUid}`,
      filters: {
        predicate: (query) =>
          query.queryKey[0] === 'review-workspace' &&
          querySubjectTraceUid(query) === event.traceUid,
      },
    })
  }
  if (event.runId) {
    targets.push(exactTarget('ace-run', event.runId))
    targets.push({
      id: `ace-dashboard:${event.runId}`,
      filters: { predicate: (query) => dashboardIncludesRun(query, event.runId as string) },
    })
  } else {
    targets.push(prefixTarget('ace-dashboard'))
  }
  if (event.runId === 'production') targets.push(prefixTarget('ace-analysis'))
  return targets
}

/** Coalesces a burst of message-level updates into one invalidation per affected query family. */
export function createLiveInvalidationScheduler(
  queryClient: QueryClient,
  delayMs = LIVE_INVALIDATION_DEBOUNCE_MS,
) {
  const pending = new Map<string, InvalidationFilters>()
  let invalidateAll = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (invalidateAll) {
      invalidateAll = false
      pending.clear()
      void queryClient.invalidateQueries()
      return
    }
    const batch = [...pending.values()]
    pending.clear()
    for (const filters of batch) void queryClient.invalidateQueries(filters)
  }

  const schedule = (event: LiveEvent): void => {
    const targets = invalidationTargets(event)
    if (targets === 'all') {
      invalidateAll = true
      pending.clear()
    } else if (!invalidateAll) {
      for (const target of targets) pending.set(target.id, target.filters)
    }
    if (timer === undefined) timer = setTimeout(flush, delayMs)
  }

  const dispose = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    pending.clear()
    invalidateAll = false
  }

  return { schedule, flush, dispose }
}
