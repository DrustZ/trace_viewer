import express, { type ErrorRequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import { type AceAnalysisBridge, AceAnalysisCoordinator } from '../ace/analysisCoordinator'
import { SearchIndex } from '../search/searchIndex'
import { TraceStore } from '../store/traceStore'
import type { RouteCtx } from './context'
import { tracesRoutes } from './traces'

function productionTrace(): ParsedTrace {
  return {
    meta: {
      traceId: 'direct-production',
      sourceTraceId: 'direct-production',
      corpusId: 'production',
      runId: 'production',
      instanceId: 'direct-production',
      component: 'ace/support',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
    },
    messages: [{ id: 'm-1', role: 'assistant', content: 'Your refund is complete.' }],
    warnings: [],
  }
}

class RetryBridge implements AceAnalysisBridge {
  calls = 0

  async call<T>(): Promise<T> {
    this.calls += 1
    if (this.calls === 1) throw new Error('local detector bridge unavailable')
    return {
      bundle: {
        schema_version: 1,
        traces: {
          'direct-production': {
            failures: [
              {
                code: 'PROMISE_UNSUPPORTED_REFUND',
                severity: 'major',
                evidence: 'No successful refund tool result exists.',
                raw_index: 0,
                chronological_index: 0,
                source: { family: 'agent', tier: 'hard_fact' },
              },
            ],
          },
        },
      },
    } as T
  }
}

describe('direct production trace analysis', () => {
  it('awaits canonical detectors on a fresh process and degrades without caching failures', async () => {
    const store = new TraceStore()
    const trace = store.upsert(productionTrace(), '/production/direct-production.json')
    const bridge = new RetryBridge()
    const coordinator = new AceAnalysisCoordinator(store, bridge)
    const ctx: RouteCtx = {
      store,
      searchIndex: new SearchIndex(store),
      dataRoots: [],
      importDir: '/tmp/imports',
    }
    const app = express()
    app.use(tracesRoutes(ctx, { analysisCoordinator: coordinator }))
    const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
    app.use(errors)
    const traceUid = trace.meta.traceUid as string

    const degraded = await request(app).get(`/api/traces/${encodeURIComponent(traceUid)}`)
    expect(degraded.status).toBe(200)
    expect(degraded.headers['x-ace-detector-analysis']).toBe('unavailable')
    expect(degraded.headers['x-ace-detector-analysis-reason']).toBe('analysis_failed')
    expect(degraded.body.messages).toHaveLength(1)
    expect(degraded.body.evaluation?.failures ?? []).toHaveLength(0)

    const analyzed = await request(app).get(`/api/traces/${encodeURIComponent(traceUid)}`)
    expect(analyzed.status).toBe(200)
    expect(analyzed.headers['x-ace-detector-analysis']).toBe('available')
    expect(analyzed.body.evaluation.failures).toEqual([
      expect.objectContaining({
        origin: 'detector',
        code: 'PROMISE_UNSUPPORTED_REFUND',
        messageId: 'm-1',
      }),
    ])
    expect(bridge.calls).toBe(2)

    await request(app).get(`/api/traces/${encodeURIComponent(traceUid)}`)
    expect(bridge.calls).toBe(2)
  })
})
