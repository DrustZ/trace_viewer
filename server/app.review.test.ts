import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../shared/connectors/types'
import type { ReviewSubject } from '../shared/reviews/types'
import { emptyReviewPayload } from '../shared/reviews/types'
import { createApp } from './app'
import { ReviewStore } from './reviews/reviewStore'
import { TraceStore } from './store/traceStore'

let temporaryDirectory = ''

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
    const app = createApp({ store: traceStore, reviewStore, dataRoots: [] })
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
})
