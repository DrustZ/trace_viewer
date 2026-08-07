import type { LiveEvent } from '@shared/schema/events'
import { type Query, QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLiveInvalidationScheduler, invalidationTargets } from './liveInvalidation'

function event(type: LiveEvent['type'], values: Partial<Omit<LiveEvent, 'type'>> = {}): LiveEvent {
  return {
    id: 1,
    type,
    dataVersion: 1,
    timestamp: '2026-08-06T00:00:00.000Z',
    ...values,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('live query invalidation', () => {
  it('maps batch updates to the run catalog, named run, and dashboards containing it', () => {
    const targets = invalidationTargets(event('batch.updated', { runId: 'live-run' }))
    expect(targets).not.toBe('all')
    if (targets === 'all') return

    expect(targets.map((target) => target.id)).toEqual([
      'prefix:ace-runs',
      'exact:ace-run:live-run',
      'ace-dashboard:live-run',
    ])
    const dashboard = targets.find((target) => target.id === 'ace-dashboard:live-run')
    const query = (queryKey: unknown[]) => ({ queryKey }) as unknown as Query
    expect(dashboard?.filters.predicate?.(query(['ace-dashboard', ['live-run']]))).toBe(true)
    expect(dashboard?.filters.predicate?.(query(['ace-dashboard', ['other-run']]))).toBe(false)
  })

  it.each(['trace.upserted', 'trace.removed'] as const)(
    'refreshes dynamic task data for %s while leaving static catalogs alone',
    (type) => {
      const targets = invalidationTargets(event(type, { traceUid: 'trace-1', runId: 'run-1' }))
      expect(targets).not.toBe('all')
      if (targets === 'all') return
      const ids = targets.map((target) => target.id)

      expect(ids).toContain('exact:trace:trace-1')
      expect(ids).toContain('exact:trace-raw:trace-1')
      expect(ids).toContain('exact:ace-run:run-1')
      expect(ids).toContain('ace-dashboard:run-1')
      expect(ids).toContain('prefix:ace-tasks')
      expect(ids).toContain('prefix:ace-task')
      expect(ids).not.toContain('prefix:ace-analysis')
      expect(ids).not.toContain('prefix:ace-capabilities')
      expect(ids).not.toContain('prefix:ace-scenarios')
      expect(ids).not.toContain('prefix:review-calibration')
    },
  )

  it('refreshes detector analysis for production trace updates only', () => {
    const production = invalidationTargets(
      event('trace.upserted', { traceUid: 'production-trace', runId: 'production' }),
    )
    const simulation = invalidationTargets(
      event('trace.upserted', { traceUid: 'simulation-trace', runId: 'run-1' }),
    )
    expect(production).not.toBe('all')
    expect(simulation).not.toBe('all')
    if (production === 'all' || simulation === 'all') return

    expect(production.map((target) => target.id)).toContain('prefix:ace-analysis')
    expect(simulation.map((target) => target.id)).not.toContain('prefix:ace-analysis')
  })

  it('debounces and de-duplicates repeated message updates', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    const scheduler = createLiveInvalidationScheduler(client, 75)
    const update = event('trace.upserted', { traceUid: 'trace-1', runId: 'run-1' })

    scheduler.schedule(update)
    scheduler.schedule({ ...update, id: 2, dataVersion: 2 })
    await vi.advanceTimersByTimeAsync(74)
    expect(invalidate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    const filters = invalidate.mock.calls.map(([value]) => value)
    expect(
      filters.filter(
        (value) =>
          value?.exact === true &&
          value.queryKey?.[0] === 'trace' &&
          value.queryKey?.[1] === 'trace-1',
      ),
    ).toHaveLength(1)
    expect(
      filters.filter((value) => value?.queryKey?.[0] === 'ace-runs' && value.queryKey.length === 1),
    ).toHaveLength(1)
    expect(filters.filter((value) => value?.queryKey?.[0] === 'ace-tasks')).toHaveLength(1)
    expect(filters.filter((value) => value?.queryKey?.[0] === 'ace-task')).toHaveLength(1)
    expect(
      filters.some((value) =>
        ['ace-analysis', 'ace-capabilities', 'ace-scenarios'].includes(
          String(value?.queryKey?.[0]),
        ),
      ),
    ).toBe(false)
    scheduler.dispose()
  })

  it('lets a snapshot-required event supersede pending narrow refreshes', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    const scheduler = createLiveInvalidationScheduler(client, 75)

    scheduler.schedule(event('trace.upserted', { traceUid: 'trace-1', runId: 'run-1' }))
    scheduler.schedule(event('snapshot.required', { id: 2, dataVersion: 2 }))
    await vi.advanceTimersByTimeAsync(75)

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith()
    scheduler.dispose()
  })
})
