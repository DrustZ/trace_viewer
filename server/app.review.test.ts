import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../shared/connectors/types'
import type { ReviewSubject } from '../shared/reviews/types'
import { emptyReviewPayload } from '../shared/reviews/types'
import { type AceAnalysisBridge, AceAnalysisCoordinator } from './ace/analysisCoordinator'
import { createApp } from './app'
import { ReviewStore } from './reviews/reviewStore'
import { TraceStore } from './store/traceStore'

let temporaryDirectory = ''
const TEST_BLIND_SECRET = Buffer.alloc(32, 0x24)

function productionTrace(): ParsedTrace {
  return {
    meta: {
      traceId: 'production-review-1',
      sourceTraceId: 'production-review-1',
      corpusId: 'production',
      runId: 'production',
      instanceId: 'production-review-1',
      component: 'ace/support',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
    },
    messages: [
      { id: 'm-1', role: 'user', content: 'Please refund my order.' },
      { id: 'm-2', role: 'assistant', content: 'The refund is complete.' },
    ],
    warnings: [],
  }
}

class ReviewAnalysisBridge implements AceAnalysisBridge {
  calls = 0

  constructor(private readonly failure?: Error) {}

  async call<T>(): Promise<T> {
    this.calls += 1
    if (this.failure) throw this.failure
    return {
      bundle: {
        schema_version: 1,
        traces: {
          'production-review-1': {
            failures: [
              {
                code: 'PROMISE_UNSUPPORTED_REFUND',
                severity: 'major',
                evidence: 'No successful refund tool result exists.',
                raw_index: 1,
                chronological_index: 1,
                source: { family: 'agent', tier: 'hard_fact' },
              },
            ],
          },
        },
      },
    } as T
  }
}

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-review-app-'))
})

afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true })
})

describe('review app integration', () => {
  it('mounts the review router against the canonical TraceStore source and injected label store', async () => {
    const traceStore = new TraceStore()
    const parsed: ParsedTrace = {
      meta: {
        traceId: 'scenario-1-seed-1',
        sourceTraceId: 'scenario-1-seed-1',
        corpusId: 'simulation',
        runId: 'batch-a',
        instanceId: 'scenario-1',
        component: 'ace/support',
        status: 'completed',
        timestamp: '2026-08-06T00:00:00.000Z',
        checkpointStep: 0,
        split: 'test',
        sourceFormat: 'ace-episode',
      },
      messages: [
        { id: 'm-1', role: 'user', content: 'Please refund this order.' },
        { id: 'm-2', role: 'assistant', content: 'Done.' },
      ],
      evaluation: {
        lifecycle: { state: 'completed' },
        outcome: 'fail',
        checks: [],
        metrics: {},
        failures: [],
        flags: [],
        judge: {
          model: 'hidden-judge',
          rubricVersion: 'judge_v2',
          dimensions: { resolution: { verdict: 'fail', evidence: 'No state change.' } },
        },
        worldDiff: [],
        ledger: [],
      },
      warnings: [],
    }
    const stored = traceStore.upsert(parsed, '/tmp/batch-a/scenario-1.json')
    const reviewsPath = path.join(temporaryDirectory, 'reviews.jsonl')
    const reviewStore = new ReviewStore({
      finalsPath: reviewsPath,
      draftsDir: path.join(temporaryDirectory, 'drafts'),
    })
    const app = createApp({
      store: traceStore,
      reviewStore,
      reviewBlindSecret: TEST_BLIND_SECRET,
      dataRoots: [],
    })
    const traceUid = stored.meta.traceUid as string

    const queue = await request(app).get(
      '/api/reviews/queue?mode=calibration&annotator=local&rubricVersion=judge_v2&state=unreviewed',
    )
    expect(queue.status).toBe(200)
    const blindTraceUid = queue.body.items[0].subject.traceUid as string
    expect(blindTraceUid).toMatch(/^blind_trace_[0-9a-f]{20}$/)
    expect(JSON.stringify(queue.body)).not.toContain(traceUid)

    const genericLookup = await request(app).get(`/api/traces/${encodeURIComponent(blindTraceUid)}`)
    expect(genericLookup.status).toBe(404)

    const blind = await request(app).get(
      `/api/reviews/${encodeURIComponent(blindTraceUid)}/draft?mode=calibration&annotator=local&rubricVersion=judge_v2`,
    )
    expect(blind.status).toBe(200)
    expect(blind.body.visibility).toBe('hidden_until_submit')
    expect(JSON.stringify(blind.body)).not.toContain('hidden-judge')
    expect(JSON.stringify(blind.body)).not.toContain(traceUid)

    const subject = blind.body.subject as ReviewSubject
    const review = {
      ...emptyReviewPayload(),
      reviewStatus: 'reviewed' as const,
      overallVerdict: 'fail' as const,
      rubricReviews: [
        {
          dimensionId: 'resolution',
          verdict: 'fail' as const,
          critique: 'The database was unchanged.',
          evidenceMessageIds: ['m-2'],
        },
      ],
    }
    const submitted = await request(app)
      .post(`/api/reviews/${encodeURIComponent(blindTraceUid)}/submit`)
      .send({ subject, review, expectedRevision: 1 })
    expect(submitted.status).toBe(201)
    expect(submitted.body.automatic.model).toBe('hidden-judge')
    expect(submitted.body.record.traceUid).toBe(traceUid)
    expect((await fs.readFile(reviewsPath, 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('awaits canonical production detectors before fresh-process Review list/get/submit', async () => {
    const traceStore = new TraceStore()
    const stored = traceStore.upsert(
      productionTrace(),
      path.join(temporaryDirectory, 'production-review-1.json'),
    )
    const bridge = new ReviewAnalysisBridge()
    const coordinator = new AceAnalysisCoordinator(traceStore, bridge)
    const reviewStore = new ReviewStore({
      finalsPath: path.join(temporaryDirectory, 'production-reviews.jsonl'),
      draftsDir: path.join(temporaryDirectory, 'production-drafts'),
    })
    const app = createApp({
      store: traceStore,
      reviewStore,
      reviewBlindSecret: TEST_BLIND_SECRET,
      aceAnalysisCoordinator: coordinator,
      dataRoots: [],
    })
    const traceUid = stored.meta.traceUid as string

    const workspace = await request(app).get(
      `/api/reviews/${encodeURIComponent(traceUid)}/draft?mode=assisted&annotator=local&rubricVersion=judge_v2`,
    )
    expect(workspace.status).toBe(200)
    expect(workspace.body.automatic.detectorAnalysis.status).toBe('available')

    const queue = await request(app).get(
      '/api/reviews/queue?mode=assisted&annotator=local&rubricVersion=judge_v2',
    )
    expect(queue.status).toBe(200)
    expect(queue.body.items[0].automatic).toMatchObject({
      detectorAnalysis: { status: 'available', source: 'ace.detector_registry' },
      failures: [{ code: 'PROMISE_UNSUPPORTED_REFUND', messageId: 'm-2' }],
    })

    const directTrace = await request(app).get(`/api/traces/${encodeURIComponent(traceUid)}`)
    expect(directTrace.status).toBe(200)
    expect(directTrace.headers['x-ace-detector-analysis']).toBe('available')
    expect(directTrace.body.evaluation.failures[0].code).toBe('PROMISE_UNSUPPORTED_REFUND')

    const analysis = await request(app).get('/api/ace/analysis')
    expect(analysis.status).toBe(200)
    expect(analysis.body.appliedTraces).toBe(1)

    const submitted = await request(app)
      .post(`/api/reviews/${encodeURIComponent(traceUid)}/submit`)
      .send({
        subject: workspace.body.subject,
        review: { ...emptyReviewPayload(), reviewStatus: 'reviewed' },
        expectedRevision: 1,
      })
    expect(submitted.status).toBe(201)
    expect(submitted.body.record.automaticSnapshot).toMatchObject({
      detectorAnalysis: { status: 'available' },
      failures: [{ code: 'PROMISE_UNSUPPORTED_REFUND' }],
    })
    expect((await reviewStore.listFinals())[0]?.automaticSnapshot?.detectorAnalysis).toEqual({
      status: 'available',
      source: 'ace.detector_registry',
    })
    expect(bridge.calls).toBe(1)
  })

  it('marks failed production analysis unavailable and blocks Assisted draft and submit', async () => {
    const traceStore = new TraceStore()
    const stored = traceStore.upsert(
      productionTrace(),
      path.join(temporaryDirectory, 'production-review-1.json'),
    )
    const bridge = new ReviewAnalysisBridge(new Error('local detector bridge unavailable'))
    const coordinator = new AceAnalysisCoordinator(traceStore, bridge)
    const reviewStore = new ReviewStore({
      finalsPath: path.join(temporaryDirectory, 'blocked-reviews.jsonl'),
      draftsDir: path.join(temporaryDirectory, 'blocked-drafts'),
    })
    const app = createApp({
      store: traceStore,
      reviewStore,
      reviewBlindSecret: TEST_BLIND_SECRET,
      aceAnalysisCoordinator: coordinator,
      dataRoots: [],
    })
    const traceUid = stored.meta.traceUid as string
    const subject: ReviewSubject = {
      corpusId: 'production',
      runId: 'production',
      traceUid,
      rubricVersion: 'judge_v2',
      annotator: 'local',
      mode: 'assisted',
    }

    const workspace = await request(app).get(
      `/api/reviews/${encodeURIComponent(traceUid)}/draft?mode=assisted&annotator=local&rubricVersion=judge_v2`,
    )
    expect(workspace.status).toBe(200)
    expect(workspace.body.automatic.detectorAnalysis).toEqual({
      status: 'unavailable',
      source: 'ace.detector_registry',
      reason: 'analysis_failed',
    })

    const draft = await request(app)
      .put(`/api/reviews/${encodeURIComponent(traceUid)}/draft`)
      .send({ subject, review: emptyReviewPayload(), expectedRevision: 1 })
    expect(draft.status).toBe(503)
    expect(draft.body.error).toContain('canonical production detector analysis is unavailable')

    const submitted = await request(app)
      .post(`/api/reviews/${encodeURIComponent(traceUid)}/submit`)
      .send({
        subject,
        review: { ...emptyReviewPayload(), reviewStatus: 'reviewed' },
        expectedRevision: 1,
      })
    expect(submitted.status).toBe(503)
    expect(await reviewStore.listFinals()).toEqual([])
  })
})
