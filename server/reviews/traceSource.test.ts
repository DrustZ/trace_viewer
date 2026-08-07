import { describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import type { AceTaskDetail, AceTaskVariant } from '../../shared/schema/aceTasks'
import type { AceTaskCatalog } from '../ace/taskCatalog'
import { TraceStore } from '../store/traceStore'
import { createTraceStoreReviewSource } from './traceSource'

function variant(goal: string): AceTaskVariant {
  return {
    definitionDigest: `definition-${goal}`,
    sources: [{ pack: 'sealed', file: 'configs/scenarios/sealed.json' }],
    suite: 'sealed',
    journeyId: null,
    journeyStep: 0,
    persona: {
      issue: 'refund',
      language: 'es',
      idKnowledge: 'exact',
      patience: 3,
      persistence: 'polite',
      style: ['concise'],
      orderId: 'order_069',
      goal,
      adversarial: false,
    },
    taskBrief: goal,
    expectedActions: [{ name: 'refund_order', args_subset: { order_id: 'order_069' } }],
    forbiddenActions: ['issue_credit'],
    expectedOutcome: 'refunded',
    rewardBasis: ['ACTIONS'],
    authorizedEffects: [],
    requiredInfo: [{ kind: 'text', value: 'order_id' }],
    expectedStateDelta: [{ order_id: 'order_069', field: 'payment.status', to: 'refunded' }],
    mustPrecede: [['get_order', 'refund_order']],
    consentRequired: true,
    promiseCheck: true,
    userScript: ['CANARY_DO_NOT_EXPOSE'],
  }
}

function task(variants: AceTaskVariant[], conflict = false): AceTaskDetail {
  return {
    scenarioId: 'scenario-7',
    suite: 'sealed',
    journeyId: null,
    journeyStep: 0,
    issue: 'refund',
    language: 'es',
    personaKey: 'exact · polite',
    taskBrief: conflict ? null : (variants[0]?.taskBrief ?? null),
    sourcePacks: ['sealed'],
    sourceFiles: ['configs/scenarios/sealed.json'],
    conflict,
    traceCoverage: {
      traceCount: 0,
      exploratoryTraceCount: 0,
      runCount: 0,
      runIds: [],
      matchedPairCount: 0,
      compareRunIds: null,
    },
    variants,
  }
}

function catalog(tasks: AceTaskDetail[]): AceTaskCatalog {
  return {
    tasks,
    facets: {
      suites: [],
      issues: [],
      languages: [],
      journeys: [],
      personas: [],
      sourcePacks: [],
    },
    source: {
      project: 'ACE',
      directory: 'configs/scenarios',
      schemaContract: 'src/ace/scenario.py::Scenario',
      readOnly: true,
    },
  }
}

describe('TraceStore review source', () => {
  it('refreshes task-derived fields when the current catalog changes without a trace rescan', async () => {
    const parsed: ParsedTrace = {
      meta: {
        traceId: 'live-catalog-trace',
        corpusId: 'simulation',
        runId: 'live-run',
        instanceId: 'scenario-7',
        component: 'ace/support',
        status: 'completed',
        timestamp: '2026-08-06T00:00:00.000Z',
        checkpointStep: 0,
        split: 'test',
        sourceFormat: 'ace-episode',
      },
      messages: [{ id: 'm-1', role: 'user', content: 'Help.' }],
      warnings: [],
    }
    const store = new TraceStore()
    store.upsert(parsed, '/tmp/live-catalog/episode.json')
    const refundTask = task([variant('Get the eligible refund.')])
    const cancelVariant = {
      ...variant('Cancel the eligible order.'),
      persona: {
        ...variant('Cancel the eligible order.').persona,
        issue: 'cancel',
        language: 'en',
      },
    }
    const cancelTask: AceTaskDetail = {
      ...task([cancelVariant]),
      issue: 'cancel',
      language: 'en',
    }
    let current = catalog([refundTask])
    current.source.catalogDigest = 'catalog-v1'
    const source = createTraceStoreReviewSource(store, {
      loadTaskCatalog: async () => current,
    })

    expect((await source.list())[0]?.trace.groundTruth).toMatchObject({
      status: 'available',
      authoritative: true,
      source: 'current_task_catalog',
      traceBound: false,
      task: { issue: 'refund', language: 'es', personaGoal: 'Get the eligible refund.' },
    })

    current = catalog([cancelTask])
    current.source.catalogDigest = 'catalog-v2'
    expect((await source.list())[0]?.trace.groundTruth).toMatchObject({
      status: 'available',
      authoritative: true,
      source: 'current_task_catalog',
      traceBound: false,
      task: { issue: 'cancel', language: 'en', personaGoal: 'Cancel the eligible order.' },
    })
  })

  it('projects first-class identity/evaluation before legacy extra metadata', async () => {
    const parsed: ParsedTrace = {
      meta: {
        traceId: 'producer-id',
        sourceTraceId: 'producer-id',
        corpusId: 'simulation',
        runId: 'batch-first-class',
        instanceId: 'scenario-7',
        component: 'ace/support',
        status: 'completed',
        timestamp: '2026-08-06T00:00:00.000Z',
        checkpointStep: 0,
        split: 'test',
        sourceFormat: 'ace-episode',
        extra: {
          run: 'legacy-wrong-run',
          corpusId: 'legacy-wrong-corpus',
          arm: 'candidate',
          issue: 'refund',
          language: 'es',
          scenario_snapshot: { canary: 'CANARY_SNAPSHOT_LEAK' },
          scenario_snapshot_provenance: 'episode_sidecar',
          groundTruth: { grade: 'GRADE_RESULT_LEAK' },
        },
      },
      messages: [
        { id: 'm-1', role: 'user', content: 'Necesito un reembolso.' },
        { id: 'm-2', role: 'assistant', content: 'Hecho.' },
      ],
      statsOverrides: { model: { name: 'ace-model' } },
      evaluation: {
        lifecycle: { state: 'completed', termination: 'resolved' },
        outcome: 'fail',
        checks: [{ name: 'refund_state', ok: false, gating: true, detail: 'unchanged' }],
        metrics: {},
        failures: [
          {
            origin: 'grader',
            code: 'refund_not_applied',
            severity: 'major',
            gating: true,
            messageId: 'm-2',
            evidence: 'Database state is unchanged.',
            source: 'ace',
          },
        ],
        flags: [],
        judge: {
          model: 'judge-model',
          rubricVersion: 'judge_v2',
          dimensions: { resolution: { verdict: 'fail', evidence: 'No state change.' } },
        },
        worldDiff: [],
        ledger: [],
      },
      warnings: [],
    }
    const store = new TraceStore()
    const stored = store.upsert(parsed, '/tmp/batch-first-class/episode.json')
    const source = createTraceStoreReviewSource(store, {
      loadTaskCatalog: async () => catalog([task([variant('Get the eligible refund.')])]),
    })
    const candidates = await source.list()
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      trace: {
        traceUid: stored.meta.traceUid,
        sourceTraceId: 'producer-id',
        corpusId: 'simulation',
        runId: 'batch-first-class',
        instanceId: 'scenario-7',
        issue: 'refund',
        language: 'es',
      },
      automatic: {
        model: 'ace-model',
        arm: 'candidate',
        outcome: 'fail',
        gradeVerdicts: { refund_state: { verdict: 'fail', critique: 'unchanged' } },
        judgeVerdicts: { resolution: { verdict: 'fail', critique: 'No state change.' } },
        failures: [
          expect.objectContaining({
            code: 'refund_not_applied',
            origin: 'grader',
            messageId: 'm-2',
          }),
        ],
      },
    })
    expect(candidates[0]?.trace.rubric).toEqual([
      { dimensionId: 'refund_state', label: 'refund_state' },
    ])
    expect(candidates[0]?.trace.groundTruth).toEqual({
      status: 'unavailable',
      authoritative: false,
      reason: 'scenario_id_mismatch',
      scenarioId: 'scenario-7',
    })
    const blindGroundTruth = JSON.stringify({
      rubric: candidates[0]?.trace.rubric,
      groundTruth: candidates[0]?.trace.groundTruth,
    })
    for (const forbidden of [
      'CANARY',
      'GRADE_RESULT',
      'order_069',
      'expectedActions',
      'unchanged',
      'judge-model',
      'ace-model',
      'candidate',
    ]) {
      expect(blindGroundTruth).not.toContain(forbidden)
    }
    expect(await source.get(stored.meta.traceUid as string)).toEqual(candidates[0])
  })

  it('uses a matching trace-bound snapshot instead of a mismatched current catalog definition', async () => {
    const parsed: ParsedTrace = {
      meta: {
        traceId: 'old-sealed-trace',
        corpusId: 'simulation',
        runId: 'sealed-legacy-run',
        instanceId: 'scenario-7',
        component: 'ace/support',
        status: 'completed',
        timestamp: '2026-08-06T00:00:00.000Z',
        checkpointStep: 0,
        split: 'test',
        sourceFormat: 'ace-episode',
        extra: {
          config_digest: 'trace-config-9310a2c',
          scenario_snapshot_provenance: 'episode_sidecar',
          scenario_snapshot: {
            scenario_id: 'scenario-7',
            config_digest: 'trace-config-9310a2c',
            card: {
              issue: 'cancel',
              language: 'en',
              goal: 'Cancel order_028.',
            },
            expected_actions: [{ name: 'cancel_order', args_subset: { order_id: 'order_028' } }],
            forbidden_actions: [],
            required_info: [],
            expected_state_delta: [],
            must_precede: [],
            consent_required: true,
            expected_outcome: 'cancelled',
            canary: 'CANARY_DO_NOT_EXPOSE',
          },
        },
      },
      messages: [{ id: 'm-1', role: 'user', content: 'Please cancel order_028.' }],
      evaluation: {
        lifecycle: { state: 'completed' },
        outcome: 'pass',
        checks: [{ name: 'ACTIONS', ok: true, gating: true, detail: 'AUTOMATIC_OK_LEAK' }],
        metrics: {},
        failures: [],
        flags: [],
        worldDiff: [],
        ledger: [],
      },
      warnings: [],
    }
    const store = new TraceStore()
    store.upsert(parsed, '/tmp/old-sealed/episode.json')
    const source = createTraceStoreReviewSource(store, {
      // The current checkout expects order_069, intentionally different from
      // the trace-bound historical definition above.
      loadTaskCatalog: async () => catalog([task([variant('Get order_069 refunded.')])]),
    })

    const [candidate] = await source.list()
    expect(candidate?.trace.issue).toBe('cancel')
    expect(candidate?.trace.language).toBe('en')
    expect(candidate?.trace.rubric).toEqual([{ dimensionId: 'ACTIONS', label: 'ACTIONS' }])
    expect(candidate?.trace.groundTruth).toMatchObject({
      status: 'available',
      authoritative: true,
      source: 'trace_bound_episode_sidecar_scenario_snapshot',
      traceBound: true,
      scenarioId: 'scenario-7',
      configDigest: 'trace-config-9310a2c',
      task: {
        issue: 'cancel',
        language: 'en',
        personaGoal: 'Cancel order_028.',
        expectedOutcome: 'cancelled',
      },
      policy: {
        expectedActions: [{ name: 'cancel_order', argsSubset: { order_id: 'order_028' } }],
      },
    })
    const reviewDefinition = JSON.stringify({
      rubric: candidate?.trace.rubric,
      groundTruth: candidate?.trace.groundTruth,
    })
    expect(reviewDefinition).toContain('order_028')
    expect(reviewDefinition).not.toContain('order_069')
    expect(reviewDefinition).not.toContain('current_task_catalog')
    expect(reviewDefinition).not.toContain('CANARY')
    expect(reviewDefinition).not.toContain('AUTOMATIC_OK_LEAK')
  })

  it('fails closed instead of copying raw production extra.groundTruth', async () => {
    const parsed: ParsedTrace = {
      meta: {
        traceId: 'production-ground-truth-canary',
        corpusId: 'production',
        runId: 'production',
        instanceId: 'production-ground-truth-canary',
        component: 'ace/support',
        status: 'completed',
        timestamp: '2026-08-06T00:00:00.000Z',
        checkpointStep: 0,
        split: 'test',
        sourceFormat: 'ace-production',
        extra: {
          groundTruth: {
            scenario: { expected_outcome: 'refund' },
            model: 'RAW_MODEL_CANARY',
            arm: 'RAW_ARM_CANARY',
            grade: 'RAW_GRADE_CANARY',
            judge: 'RAW_JUDGE_CANARY',
            detector: 'RAW_DETECTOR_CANARY',
            failures: ['RAW_FAILURE_CANARY'],
            score: 1,
          },
        },
      },
      messages: [{ id: 'm-1', role: 'user', content: 'Please help.' }],
      warnings: [],
    }
    const store = new TraceStore()
    store.upsert(parsed, '/tmp/production-ground-truth-canary.json')

    const [candidate] = await createTraceStoreReviewSource(store).list()

    expect(candidate?.trace.groundTruth).toEqual({
      status: 'unavailable',
      authoritative: false,
      reason: 'unsafe_ground_truth_shape',
      scenarioId: 'production-ground-truth-canary',
    })
    const json = JSON.stringify(candidate?.trace.groundTruth)
    for (const canary of [
      'RAW_MODEL_CANARY',
      'RAW_ARM_CANARY',
      'RAW_GRADE_CANARY',
      'RAW_JUDGE_CANARY',
      'RAW_DETECTOR_CANARY',
      'RAW_FAILURE_CANARY',
    ]) {
      expect(json).not.toContain(canary)
    }
  })

  it('marks task-definition conflicts without selecting or exposing either variant', async () => {
    const parsed: ParsedTrace = {
      meta: {
        traceId: 'conflict-producer',
        corpusId: 'simulation',
        runId: 'sealed-factorial-optimized-responses',
        instanceId: 'scenario-7',
        component: 'ace/support',
        status: 'completed',
        timestamp: '2026-08-06T00:00:00.000Z',
        checkpointStep: 0,
        split: 'test',
        sourceFormat: 'ace-episode',
        extra: {},
      },
      messages: [{ id: 'm-1', role: 'user', content: 'Necesito ayuda.' }],
      evaluation: {
        lifecycle: { state: 'completed' },
        outcome: 'pass',
        checks: [{ name: 'ACTIONS', ok: true, gating: true, detail: 'GRADE_DETAIL_LEAK' }],
        metrics: {},
        failures: [],
        flags: [],
        worldDiff: [],
        ledger: [],
      },
      warnings: [],
    }
    const store = new TraceStore()
    store.upsert(parsed, '/tmp/conflict/episode.json')
    const source = createTraceStoreReviewSource(store, {
      loadTaskCatalog: async () =>
        catalog([task([variant('FIRST_VARIANT_SECRET'), variant('SECOND_VARIANT_SECRET')], true)]),
    })

    const [candidate] = await source.list()
    expect(candidate?.trace.issue).toBeUndefined()
    expect(candidate?.trace.language).toBeUndefined()
    expect(candidate?.trace.rubric).toEqual([{ dimensionId: 'ACTIONS', label: 'ACTIONS' }])
    expect(candidate?.trace.groundTruth).toEqual({
      status: 'unavailable',
      authoritative: false,
      reason: 'task_catalog_definition_conflict',
      scenarioId: 'scenario-7',
    })
    expect(JSON.stringify(candidate?.trace.groundTruth)).not.toContain('VARIANT_SECRET')
    expect(JSON.stringify(candidate?.trace.rubric)).not.toContain('GRADE_DETAIL_LEAK')
  })
})
