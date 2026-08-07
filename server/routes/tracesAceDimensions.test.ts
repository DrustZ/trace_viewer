import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import { encodeFilterSet } from '../../shared/filter/parse'
import type { AceTaskDetail } from '../../shared/schema/aceTasks'
import { buildAceDashboard } from '../ace/dashboard'
import { SearchIndex } from '../search/searchIndex'
import { TraceStore } from '../store/traceStore'
import type { RouteCtx } from './context'
import { tracesRoutes } from './traces'

function trace(traceId: string, extra: Record<string, unknown> = {}): ParsedTrace {
  return {
    meta: {
      traceId,
      sourceTraceId: traceId,
      corpusId: 'simulation',
      runId: 'run-a',
      instanceId: 'scenario-refund',
      component: 'ace/test',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
      extra,
    },
    messages: [{ id: `${traceId}-m0`, role: 'user', content: 'help' }],
    warnings: [],
  }
}

const task = {
  scenarioId: 'scenario-refund',
  issue: 'refund_payment',
  language: 'en',
  variants: [],
} as unknown as AceTaskDetail

describe('ACE task-dimension trace drilldowns', () => {
  it('returns the same catalog-fallback traces counted by dashboard issue/language facets', async () => {
    const store = new TraceStore()
    const fallback = store.upsert(trace('fallback-trace'))
    store.upsert(trace('recorded-trace', { issue: 'order_status', language: 'ko' }))
    store.upsert(trace('prefix-trace', { issue: 'refund_payment_delayed', language: 'en-US' }))
    const ctx: RouteCtx = {
      store,
      searchIndex: new SearchIndex(store),
      dataRoots: [],
      importDir: '/tmp/not-used',
    }
    const app = express()
    app.use(tracesRoutes(ctx, { loadTaskDefinitions: async () => [task] }))

    const dashboard = buildAceDashboard(store, ['run-a'], [task])
    expect(dashboard.issues).toEqual([
      { code: 'order_status', count: 1 },
      { code: 'refund_payment', count: 1 },
      { code: 'refund_payment_delayed', count: 1 },
    ])
    expect(dashboard.languages).toEqual([
      { code: 'en', count: 1 },
      { code: 'en-US', count: 1 },
      { code: 'ko', count: 1 },
    ])

    const scoped = (key: 'issue' | 'language', value: string) =>
      encodeFilterSet({
        conditions: [
          { key: 'corpus', op: 'in', value: ['production', 'simulation'] },
          { key: 'run', op: 'in', value: ['run-a'] },
          { key, op: 'eq', value },
        ],
      })
    const issue = await request(app)
      .get('/api/traces')
      .query({ filters: scoped('issue', 'refund_payment') })
    const language = await request(app)
      .get('/api/traces')
      .query({ filters: scoped('language', 'en') })

    for (const response of [issue, language]) {
      expect(response.status).toBe(200)
      expect(response.body.total).toBe(1)
      expect(response.body.items[0].meta.traceUid).toBe(fallback.meta.traceUid)
      expect(response.body.items[0].meta.extra.ace_dimension_provenance).toEqual({
        issue: 'current_task_catalog',
        language: 'current_task_catalog',
      })
    }
  })

  it('keeps trace-recorded dimensions authoritative over catalog fallbacks', async () => {
    const store = new TraceStore()
    store.upsert(trace('recorded-trace', { issue: 'order_status', language: 'ko' }))
    const ctx: RouteCtx = {
      store,
      searchIndex: new SearchIndex(store),
      dataRoots: [],
      importDir: '/tmp/not-used',
    }
    const app = express()
    app.use(tracesRoutes(ctx, { loadTaskDefinitions: async () => [task] }))

    const response = await request(app)
      .get('/api/traces')
      .query({
        filters: encodeFilterSet({
          conditions: [{ key: 'issue', op: 'contains', value: 'refund_payment' }],
        }),
      })
    expect(response.status).toBe(200)
    expect(response.body.total).toBe(0)
  })
})
