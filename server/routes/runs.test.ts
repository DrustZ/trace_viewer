import request from 'supertest'
import { describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import { createApp } from '../app'
import { TraceStore } from '../store/traceStore'

function addTrace(
  store: TraceStore,
  options: {
    traceId: string
    instanceId: string
    run?: string
    score?: number
  },
): void {
  const parsed: ParsedTrace = {
    meta: {
      traceId: options.traceId,
      instanceId: options.instanceId,
      component: 'test/component',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'test',
      ...(options.run ? { extra: { run: options.run } } : {}),
    },
    messages: [],
    ...(options.score === undefined ? {} : { statsOverrides: { score: options.score } }),
    warnings: [],
  }
  store.upsert(parsed)
}

describe('run metadata catalog', () => {
  it('discovers arbitrary runs with counts and averages, then invalidates on store changes', async () => {
    const store = new TraceStore()
    addTrace(store, { traceId: 'default', instanceId: 'i-default', score: 1 })
    addTrace(store, {
      traceId: 'work-1',
      instanceId: 'work-instance-1',
      run: 'work-trial',
      score: 0.25,
    })
    addTrace(store, {
      traceId: 'work-2',
      instanceId: 'work-instance-2',
      run: 'work-trial',
      score: 0.75,
    })
    addTrace(store, {
      traceId: 'ungraded',
      instanceId: 'work-instance-3',
      run: 'work-trial',
    })
    const app = createApp({ store })

    const first = await request(app).get('/api/runs')
    expect(first.status).toBe(200)
    expect(first.body.items).toEqual([
      { run: 'run-a', count: 1, avgScore: 1 },
      { run: 'work-trial', count: 3, avgScore: 0.5 },
    ])
    expect(first.body.total).toBe(2)
    // The catalog is metadata-only, not another way to download trace bodies.
    expect(JSON.stringify(first.body)).not.toContain('messages')

    addTrace(store, {
      traceId: 'later',
      instanceId: 'later-instance',
      run: 'new-run',
      score: 0,
    })
    const refreshed = await request(app).get('/api/runs')
    expect(refreshed.body.items.map((item: { run: string }) => item.run)).toEqual([
      'new-run',
      'run-a',
      'work-trial',
    ])
    expect(refreshed.body.dataVersion).toBeGreaterThan(first.body.dataVersion)
  })

  it('searches distinct instances across all metadata beyond 5000 traces with bounded results', async () => {
    const store = new TraceStore()
    for (let index = 0; index < 5_100; index += 1) {
      const padded = String(index).padStart(5, '0')
      addTrace(store, {
        traceId: `bulk-${padded}`,
        instanceId: `instance-${padded}`,
        run: index % 2 === 0 ? 'run-a' : 'run-b',
      })
    }
    addTrace(store, {
      traceId: 'work-trial-tail',
      instanceId: 'needle-beyond-five-thousand',
      run: 'work-trial',
    })
    const app = createApp({ store })

    const runs = await request(app).get('/api/runs')
    expect(runs.body.items).toContainEqual({ run: 'work-trial', count: 1, avgScore: null })

    const searched = await request(app)
      .get('/api/runs/instances')
      .query({ run: ['run-a', 'run-b', 'work-trial'], q: 'beyond-five', limit: 20 })
    expect(searched.status).toBe(200)
    expect(searched.body).toMatchObject({
      total: 1,
      items: ['needle-beyond-five-thousand'],
      limit: 20,
      offset: 0,
    })

    const bounded = await request(app).get('/api/runs/instances?limit=50000')
    expect(bounded.body.total).toBe(5_101)
    expect(bounded.body.limit).toBe(1_000)
    expect(bounded.body.items).toHaveLength(1_000)
    expect(JSON.stringify(bounded.body)).not.toContain('messages')
  })

  it('limits instance suggestions to the requested runs and supports pagination', async () => {
    const store = new TraceStore()
    addTrace(store, { traceId: 'a1', instanceId: 'shared', run: 'run-a' })
    addTrace(store, { traceId: 'a2', instanceId: 'only-a', run: 'run-a' })
    addTrace(store, { traceId: 'b1', instanceId: 'shared', run: 'run-b' })
    addTrace(store, { traceId: 'b2', instanceId: 'only-b', run: 'run-b' })
    const app = createApp({ store })

    const runA = await request(app).get('/api/runs/instances?run=run-a&limit=1&offset=1')
    expect(runA.body).toMatchObject({ total: 2, items: ['shared'], limit: 1, offset: 1 })

    const union = await request(app).get('/api/runs/instances?run=run-a&run=run-b&q=only&limit=10')
    expect(union.body).toMatchObject({ total: 2, items: ['only-a', 'only-b'] })
  })
})
