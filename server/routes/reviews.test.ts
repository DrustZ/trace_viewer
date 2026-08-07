import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express, { type ErrorRequestHandler } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReviewGroundTruth, ReviewPayload, ReviewSubject } from '../../shared/reviews/types'
import { emptyReviewPayload } from '../../shared/reviews/types'
import { ReviewStore } from '../reviews/reviewStore'
import { createStaticReviewTraceSource, type ReviewTraceCandidate } from '../reviews/traceSource'
import { reviewsRoutes } from './reviews'

let temporaryDirectory = ''
const REAL_RUN_ID = 'sealed-factorial-baseline-optimized-chat-responses'
const BLIND_CANARIES = [
  'GROUND_TRUTH_SECRET_MODEL',
  'GROUND_TRUTH_SECRET_ARM',
  'GROUND_TRUTH_SECRET_JUDGE',
  'GROUND_TRUTH_SECRET_FLAG',
  'GROUND_TRUTH_SECRET_GRADE',
  'AUTOMATIC_SECRET_GRADE',
  'AUTOMATIC_SECRET_JUDGE',
  'AUTOMATIC_SECRET_FLAG',
] as const

function expectNoBlindCanaries(value: unknown): void {
  const json = JSON.stringify(value)
  for (const canary of BLIND_CANARIES) expect(json).not.toContain(canary)
}

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-review-routes-'))
})

afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true })
})

function subject(mode: ReviewSubject['mode']): ReviewSubject {
  return {
    corpusId: 'simulation',
    runId: REAL_RUN_ID,
    traceUid: 'trace-uid-1',
    rubricVersion: 'judge_v2',
    annotator: 'local',
    mode,
  }
}

function reviewPayload(overrides: Partial<ReviewPayload> = {}): ReviewPayload {
  return {
    ...emptyReviewPayload(),
    overallVerdict: 'fail',
    priority: 'high',
    rootCauseTags: ['tool-state'],
    note: 'Refund was promised but not executed.',
    rubricReviews: [
      {
        dimensionId: 'resolution',
        verdict: 'fail',
        critique: 'No matching state change.',
        evidenceMessageIds: ['m-2'],
      },
    ],
    turnAnnotations: [
      {
        annotationId: 'annotation-1',
        messageId: 'm-2',
        index: { space: 'chronological', index: 1 },
        label: 'unsupported promise',
        tags: ['promise'],
        note: 'The assistant claims success.',
      },
    ],
    ...overrides,
  }
}

function testApp(extraCandidates: ReviewTraceCandidate[] = []) {
  const reviewStore = new ReviewStore({
    finalsPath: path.join(temporaryDirectory, 'labels', 'reviews.jsonl'),
    draftsDir: path.join(temporaryDirectory, 'labels', 'drafts'),
  })
  const traceSource = createStaticReviewTraceSource([
    {
      trace: {
        corpusId: 'simulation',
        runId: REAL_RUN_ID,
        traceUid: 'trace-uid-1',
        sourceTraceId: 'scenario-1-seed-4',
        instanceId: 'scenario-1',
        issue: 'refund',
        language: 'en',
        transcript: [
          { id: 'm-1', role: 'user', content: 'Please refund order 1.' },
          { id: 'm-2', role: 'assistant', content: 'The refund is complete.' },
        ],
        rubric: [
          {
            dimensionId: 'resolution',
            label: 'Correct resolution',
            description: 'The final state matches the requested legal action.',
          },
        ],
        // Deliberately masquerades as a trusted envelope. Unknown fields at
        // any allowlisted level must fail closed in the route boundary.
        groundTruth: {
          status: 'available',
          authoritative: true,
          source: 'trace_bound_episode_sidecar_scenario_snapshot',
          traceBound: true,
          scenarioId: 'scenario-1',
          configDigest: 'config-1',
          task: { issue: 'refund', model: 'GROUND_TRUTH_SECRET_MODEL' },
          policy: { arm: 'GROUND_TRUTH_SECRET_ARM' },
          database: { judge: 'GROUND_TRUTH_SECRET_JUDGE' },
          rubric: { flag: 'GROUND_TRUTH_SECRET_FLAG' },
          grade: 'GROUND_TRUTH_SECRET_GRADE',
        } as unknown as ReviewGroundTruth,
      },
      automatic: {
        model: 'secret-model',
        arm: 'candidate-b',
        outcome: 'fail',
        gradeVerdicts: {
          resolution: { verdict: 'fail', critique: 'AUTOMATIC_SECRET_GRADE' },
        },
        judgeVerdicts: {
          resolution: { verdict: 'fail', critique: 'AUTOMATIC_SECRET_JUDGE' },
        },
        detectorVerdicts: {
          resolution: { verdict: 'fail', critique: 'AUTOMATIC_SECRET_FLAG' },
        },
        failures: [
          {
            id: 'failure-1',
            code: 'promise_without_action',
            origin: 'detector',
            severity: 'major',
            message: 'The response promises a refund without a successful tool result.',
            messageId: 'm-2',
          },
        ],
      },
    },
    ...extraCandidates,
  ])
  const app = express()
  app.use(express.json())
  app.use(reviewsRoutes({ traceSource, reviewStore }))
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
        ? error.status
        : 500
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) })
  }
  app.use(errors)
  return { app, reviewStore }
}

describe('/api/reviews', () => {
  it('supports an ACE-only queue without including generic viewer corpora', async () => {
    const { app } = testApp([
      {
        trace: {
          corpusId: 'production',
          runId: 'production',
          traceUid: 'trace-production',
          sourceTraceId: 'production-1',
        },
      },
      {
        trace: {
          corpusId: 'bundled-demo',
          runId: 'run-a',
          traceUid: 'trace-demo',
          sourceTraceId: 'demo-1',
        },
      },
    ])

    const queue = await request(app).get(
      '/api/reviews/queue?mode=calibration&annotator=local&rubricVersion=judge_v2&corpusId=ace',
    )
    expect(queue.body.total).toBe(2)
    expect(
      queue.body.items.map((item: { subject: ReviewSubject }) => item.subject.corpusId).sort(),
    ).toEqual(['production', 'simulation'])
    expect(queue.body.items.every((item: object) => !('automatic' in item))).toBe(true)
    const queueJson = JSON.stringify(queue.body).toLocaleLowerCase()
    for (const forbidden of [
      'baseline',
      'optimized',
      'chat',
      'responses',
      'secret-model',
      'candidate-b',
      '"automatic"',
    ]) {
      expect(queueJson).not.toContain(forbidden)
    }
    expect(queueJson).not.toContain('trace-uid-1')
    expect(queueJson).not.toContain('trace-production')
    expectNoBlindCanaries(queue.body)
    expect(queue.body.items[0].subject.traceUid).toMatch(/^blind_trace_[0-9a-f]{20}$/)

    const guessedRun = await request(app).get(
      `/api/reviews/queue?mode=calibration&annotator=local&rubricVersion=judge_v2&runId=${encodeURIComponent(REAL_RUN_ID)}`,
    )
    expect(guessedRun.body.total).toBe(0)
    expect(JSON.stringify(guessedRun.body)).not.toContain(REAL_RUN_ID)
  })

  it('server-redacts calibration data until immutable submit, then reveals it', async () => {
    const { app, reviewStore } = testApp()
    const blind = await request(app).get(
      '/api/reviews/trace-uid-1/draft?mode=calibration&annotator=local&rubricVersion=judge_v2',
    )
    expect(blind.status).toBe(200)
    expect(blind.body).toMatchObject({
      visibility: 'hidden_until_submit',
      subject: {
        ...subject('calibration'),
        runId: expect.stringMatching(/^blind_run_[0-9a-f]{20}$/),
        traceUid: expect.stringMatching(/^blind_trace_[0-9a-f]{20}$/),
      },
      latestFinal: null,
    })
    expect(blind.body).not.toHaveProperty('automatic')
    expect(JSON.stringify(blind.body)).not.toContain('secret-model')
    expect(JSON.stringify(blind.body)).not.toContain('candidate-b')
    expect(JSON.stringify(blind.body)).not.toContain('promise_without_action')
    expect(JSON.stringify(blind.body)).not.toContain('trace-uid-1')
    const blindJson = JSON.stringify(blind.body).toLocaleLowerCase()
    for (const forbidden of [
      'baseline',
      'optimized',
      'chat',
      'responses',
      'secret-model',
      'candidate-b',
      '"automatic"',
    ]) {
      expect(blindJson).not.toContain(forbidden)
    }
    expectNoBlindCanaries(blind.body)
    expect(blind.body.trace.groundTruth).toEqual({
      status: 'unavailable',
      authoritative: false,
      reason: 'unsafe_ground_truth_shape',
      scenarioId: 'scenario-1',
    })

    const draftRequest = {
      subject: blind.body.subject as ReviewSubject,
      review: reviewPayload(),
      expectedRevision: 1,
    }
    const blindTraceUid = blind.body.subject.traceUid as string
    const draft = await request(app)
      .put(`/api/reviews/${encodeURIComponent(blindTraceUid)}/draft`)
      .send(draftRequest)
    expect(draft.status).toBe(200)
    expect(draft.body).toMatchObject({ revision: 1, locked: false, priority: 'high' })
    expect(draft.body.runId).toBe(blind.body.subject.runId)
    expect(draft.body.traceUid).toBe(blindTraceUid)
    expect(draft.body.key).toMatch(/^blind_record_[0-9a-f]{20}$/)
    expect(JSON.stringify(draft.body)).not.toContain(REAL_RUN_ID)
    expect(JSON.stringify(draft.body)).not.toContain('trace-uid-1')
    expectNoBlindCanaries(draft.body)
    expect((await reviewStore.getDraft(subject('calibration')))?.runId).toBe(REAL_RUN_ID)

    const submitted = await request(app)
      .post(`/api/reviews/${encodeURIComponent(blindTraceUid)}/submit`)
      .send({
        ...draftRequest,
        review: reviewPayload({ reviewStatus: 'reviewed' }),
      })
    expect(submitted.status).toBe(201)
    expect(submitted.body).toMatchObject({
      visibility: 'revealed',
      record: { revision: 1, locked: true, runId: REAL_RUN_ID, traceUid: 'trace-uid-1' },
      automatic: { model: 'secret-model', arm: 'candidate-b' },
    })

    const revealed = await request(app).get(
      `/api/reviews/${encodeURIComponent(blindTraceUid)}/draft?mode=calibration&annotator=local&rubricVersion=judge_v2`,
    )
    expect(revealed.body).toMatchObject({
      visibility: 'revealed',
      subject: { runId: REAL_RUN_ID },
      trace: { runId: REAL_RUN_ID },
      latestFinal: { locked: true, runId: REAL_RUN_ID },
      automatic: { model: 'secret-model' },
    })
  })

  it('keeps only the typed authoritative task, policy, database, and rubric allowlist', async () => {
    const safeGroundTruth: ReviewGroundTruth = {
      status: 'available',
      authoritative: true,
      source: 'trace_bound_episode_sidecar_scenario_snapshot',
      traceBound: true,
      scenarioId: 'scenario-safe',
      configDigest: 'config-safe',
      task: {
        issue: 'refund',
        language: 'en',
        personaGoal: 'Refund the eligible order.',
        expectedOutcome: 'refund',
      },
      policy: {
        expectedActions: [
          { name: 'issue_refund', argsSubset: { order_id: 'order_1', amount: 500 } },
        ],
        forbiddenActions: ['cancel_order'],
        consentRequired: true,
      },
      database: {
        requiredInfo: [{ kind: 'money', value: 500 }],
        expectedStateDelta: [{ orderId: 'order_1', field: 'refunded', to: 500 }],
      },
      rubric: { rewardBasis: ['ACTIONS', 'OUTCOME'], promiseCheck: true },
    }
    const { app } = testApp([
      {
        trace: {
          corpusId: 'simulation',
          runId: 'safe-run',
          traceUid: 'safe-trace',
          sourceTraceId: 'safe-source',
          instanceId: 'scenario-safe',
          transcript: [{ id: 'safe-m1', role: 'user', content: 'Please refund my order.' }],
          groundTruth: safeGroundTruth,
        },
      },
    ])

    const workspace = await request(app).get(
      '/api/reviews/safe-trace/draft?mode=calibration&annotator=local&rubricVersion=judge_v2',
    )

    expect(workspace.status).toBe(200)
    expect(workspace.body.trace.groundTruth).toEqual(safeGroundTruth)
  })

  it('shows assisted suggestions and accepts explicit per-failure decisions', async () => {
    const { app } = testApp()
    const workspace = await request(app).get(
      '/api/reviews/trace-uid-1/draft?mode=assisted&annotator=local&rubricVersion=judge_v2',
    )
    expect(workspace.body).toMatchObject({
      visibility: 'revealed',
      automatic: { failures: [{ id: 'failure-1' }] },
    })

    const saved = await request(app)
      .put('/api/reviews/trace-uid-1/draft')
      .send({
        subject: subject('assisted'),
        expectedRevision: 1,
        review: reviewPayload({
          failureReviews: [
            { failureId: 'failure-1', decision: 'false_positive', note: 'Action happened later.' },
          ],
        }),
      })
    expect(saved.status).toBe(200)
    expect(saved.body.failureReviews).toEqual([
      { failureId: 'failure-1', decision: 'false_positive', note: 'Action happened later.' },
    ])
  })

  it('filters queue state/priority and reports undefined single-class kappa', async () => {
    const { app } = testApp()
    await request(app)
      .post('/api/reviews/trace-uid-1/submit')
      .send({
        subject: subject('calibration'),
        expectedRevision: 1,
        review: reviewPayload({ reviewStatus: 'reviewed' }),
      })

    const queue = await request(app).get(
      '/api/reviews/queue?mode=calibration&annotator=local&rubricVersion=judge_v2&state=submitted&priority=high',
    )
    expect(queue.body).toMatchObject({
      total: 1,
      items: [
        {
          state: 'submitted',
          locked: true,
          priority: 'high',
          hasDisagreement: false,
          automatic: { model: 'secret-model' },
        },
      ],
    })

    const calibration = await request(app).get(
      '/api/reviews/calibration?annotator=local&rubricVersion=judge_v2',
    )
    expect(calibration.body).toMatchObject({
      records: 1,
      recordsWithAutomaticVerdicts: 1,
      dimensions: [
        {
          dimensionId: 'resolution',
          rawAgreement: 1,
          kappa: null,
          kappaStatus: 'undefined_single_class',
          perClassRecall: { pass: null, fail: 1 },
        },
      ],
    })
  })

  it('rejects client-injected automatic data, hidden failure decisions, and stale subjects', async () => {
    const { app } = testApp()
    const injected = await request(app)
      .put('/api/reviews/trace-uid-1/draft')
      .send({
        subject: subject('calibration'),
        review: reviewPayload(),
        automaticSnapshot: { model: 'forged' },
      })
    expect(injected.status).toBe(400)

    const hiddenDecision = await request(app)
      .put('/api/reviews/trace-uid-1/draft')
      .send({
        subject: subject('calibration'),
        review: reviewPayload({
          failureReviews: [{ failureId: 'failure-1', decision: 'confirmed', note: '' }],
        }),
      })
    expect(hiddenDecision.status).toBe(400)

    const wrongRun = await request(app)
      .put('/api/reviews/trace-uid-1/draft')
      .send({
        subject: { ...subject('assisted'), runId: 'different-run' },
        review: reviewPayload(),
      })
    expect(wrongRun.status).toBe(409)
  })
})
