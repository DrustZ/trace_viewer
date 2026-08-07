import { describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import type { AceBatchSummary } from '../../shared/schema/ace'
import type { AceTaskDetail } from '../../shared/schema/aceTasks'
import type { TraceEvaluation, TraceOutcome } from '../../shared/schema/types'
import { TraceStore } from '../store/traceStore'
import { applyAceAnalysisBundle } from './analysisBundle'
import { buildAceDashboard } from './dashboard'

function evaluation(
  outcome: TraceOutcome,
  options: Partial<TraceEvaluation> = {},
): TraceEvaluation {
  return {
    lifecycle: { state: outcome === 'runtime_error' ? 'failed' : 'completed' },
    outcome,
    checks: [],
    metrics: {},
    failures: [],
    flags: [],
    worldDiff: [],
    ledger: [],
    ...options,
  }
}

function taskFixture(
  scenarioId: string,
  issue: string,
  language: string,
  expectedOutcome: string,
): AceTaskDetail {
  return {
    scenarioId,
    suite: 'sealed',
    journeyId: null,
    journeyStep: 0,
    issue,
    language,
    personaKey: 'exact',
    taskBrief: issue,
    sourcePacks: ['sealed'],
    sourceFiles: ['configs/scenarios/sealed.json'],
    conflict: false,
    traceCoverage: {
      traceCount: 0,
      runCount: 0,
      runIds: [],
      matchedPairCount: 0,
      compareRunIds: null,
    },
    variants: [
      {
        definitionDigest: `${scenarioId}-digest`,
        sources: [{ pack: 'sealed', file: 'configs/scenarios/sealed.json' }],
        suite: 'sealed',
        journeyId: null,
        journeyStep: 0,
        persona: {
          issue,
          language,
          idKnowledge: 'exact',
          patience: 3,
          persistence: 'normal',
          style: [],
          orderId: null,
          goal: issue,
          adversarial: false,
        },
        taskBrief: issue,
        expectedActions: [],
        forbiddenActions: [],
        expectedOutcome,
        rewardBasis: [],
        authorizedEffects: [],
        requiredInfo: [],
        expectedStateDelta: [],
        mustPrecede: [],
        consentRequired: false,
        promiseCheck: false,
        userScript: [],
      },
    ],
  }
}

function traceFixture(options: {
  traceId: string
  corpusId?: 'production' | 'simulation'
  runId?: string
  instanceId?: string
  outcome?: TraceOutcome
  seed?: number
  evaluation?: TraceEvaluation
  runKind?: 'scored' | 'debug' | 'counterfactual'
}): ParsedTrace {
  const traceEvaluation =
    options.evaluation ?? (options.outcome === undefined ? undefined : evaluation(options.outcome))
  return {
    meta: {
      traceId: options.traceId,
      sourceTraceId: options.traceId,
      corpusId: options.corpusId ?? 'simulation',
      runId: options.runId ?? 'run-a',
      instanceId: options.instanceId ?? options.traceId,
      component: 'ace/test',
      status: options.outcome === 'runtime_error' ? 'failed' : 'completed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
      extra: {
        environment_seed: options.seed ?? 1,
        prompt: 'baseline',
        transport: 'responses',
        ...(options.runKind ? { run_kind: options.runKind } : {}),
      },
    },
    messages: [
      {
        id: `${options.traceId}-raw-1`,
        role: 'assistant',
        content: 'I can promise that refund.',
        rawIndex: 1,
        chronologicalIndex: 0,
      },
      {
        id: `${options.traceId}-raw-0`,
        role: 'user',
        content: 'Where is my order?',
        rawIndex: 0,
        chronologicalIndex: 1,
      },
    ],
    ...(traceEvaluation ? { evaluation: traceEvaluation } : {}),
    warnings: [],
  }
}

describe('applyAceAnalysisBundle', () => {
  it('maps canonical detector findings, anchors raw indices, and preserves non-detector evaluation', () => {
    const store = new TraceStore()
    const originalEvaluation = evaluation('ungraded', {
      metrics: { existing_metric: 4 },
      failures: [
        {
          origin: 'integrity',
          code: 'TRUNCATED_SOURCE',
          severity: 'major',
          gating: false,
          source: 'trace_viewer',
        },
        {
          origin: 'detector',
          code: 'STALE_DETECTOR_RESULT',
          severity: 'minor',
          gating: false,
          source: 'ace.detector_registry',
        },
      ],
    })
    const trace = store.upsert(
      traceFixture({
        traceId: 'production-001',
        corpusId: 'production',
        evaluation: originalEvaluation,
      }),
      '/private/data/production-001.json',
    )

    const summary = applyAceAnalysisBundle(store, {
      schema_version: 7,
      source: { corpus_digest: 'abc123' },
      aggregates: { traces: 2, major: 1 },
      traces: {
        'production-001': {
          language: 'English',
          issues: ['delivery', 'refund'],
          failures: [
            {
              code: 'PROMISE_UNSUPPORTED_REFUND',
              severity: 'major',
              evidence: 'assistant promised a refund before tool confirmation',
              raw_index: 1,
              chronological_index: 0,
              source: { family: 'claims', tier: 'tier_1' },
            },
            { severity: 'minor' },
          ],
        },
        missing: { failures: [] },
      },
    })

    expect(summary).toEqual({
      schemaVersion: 7,
      source: { corpus_digest: 'abc123' },
      aggregates: { traces: 2, major: 1 },
      appliedTraces: 1,
      unmatchedTraces: 1,
    })
    const updated = store.getFull(trace.meta.traceUid as string)
    expect(updated?.evaluation?.metrics).toEqual({
      existing_metric: 4,
      detector_findings: 1,
    })
    expect(updated?.evaluation?.failures).toEqual([
      expect.objectContaining({ origin: 'integrity', code: 'TRUNCATED_SOURCE' }),
      expect.objectContaining({
        origin: 'detector',
        code: 'PROMISE_UNSUPPORTED_REFUND',
        severity: 'major',
        messageId: 'production-001-raw-1',
        indexSpace: 'raw',
        rawIndex: 1,
        chronologicalIndex: 0,
        source: 'ace.detector_registry',
      }),
    ])
    expect(updated?.evaluation?.flags).toEqual([
      expect.objectContaining({
        detector: 'PROMISE_UNSUPPORTED_REFUND',
        family: 'claims',
        tier: 'tier_1',
        messageId: 'production-001-raw-1',
      }),
    ])
    expect(updated?.messages[0].metadata?.aceFailures).toEqual([
      expect.objectContaining({ code: 'PROMISE_UNSUPPORTED_REFUND', origin: 'detector' }),
    ])
    expect(updated?.meta.extra).toMatchObject({
      language: 'English',
      issues: ['delivery', 'refund'],
      issue: 'delivery, refund',
      detectorBundleSchemaVersion: 7,
    })
  })

  it('does not attach production detector output to a simulation with the same source id', () => {
    const store = new TraceStore()
    store.upsert(
      traceFixture({ traceId: 'same-id', corpusId: 'simulation', outcome: 'pass' }),
      '/runs/same-id.json',
    )
    const result = applyAceAnalysisBundle(store, {
      traces: {
        'same-id': {
          failures: [{ code: 'PRODUCTION_ONLY', severity: 'major', raw_index: 0 }],
        },
      },
    })
    expect(result).toMatchObject({ appliedTraces: 0, unmatchedTraces: 1 })
    expect(store.list()[0].evaluation?.failures).toEqual([])
  })

  it('does not silently choose between duplicate production producer ids', () => {
    const store = new TraceStore()
    store.upsert(
      traceFixture({ traceId: 'duplicate-prod', corpusId: 'production', outcome: 'ungraded' }),
      '/production/root-a/duplicate-prod.json',
    )
    store.upsert(
      traceFixture({ traceId: 'duplicate-prod', corpusId: 'production', outcome: 'ungraded' }),
      '/production/root-b/duplicate-prod.json',
    )

    const result = applyAceAnalysisBundle(store, {
      traces: {
        'duplicate-prod': {
          failures: [{ code: 'AMBIGUOUS_FINDING', severity: 'major', raw_index: 0 }],
        },
      },
    })

    expect(result).toMatchObject({ appliedTraces: 0, unmatchedTraces: 1 })
    expect(store.list()).toHaveLength(2)
    expect(store.list().every((summary) => summary.evaluation?.failures.length === 0)).toBe(true)
  })
})

describe('buildAceDashboard', () => {
  it('keeps pass/fail, invalid-user, runtime-error, and ungraded denominators separate', () => {
    const store = new TraceStore()
    const add = (trace: ParsedTrace) => store.upsert(trace)
    add(
      traceFixture({
        traceId: 'pass-1',
        outcome: 'pass',
        instanceId: 'scenario-a',
        seed: 1,
      }),
    )
    add(
      traceFixture({
        traceId: 'pass-2',
        outcome: 'pass',
        instanceId: 'scenario-a',
        seed: 2,
      }),
    )
    add(
      traceFixture({
        traceId: 'fail-1',
        instanceId: 'scenario-b',
        outcome: 'fail',
        evaluation: evaluation('fail', {
          checks: [
            { name: 'refund_correct', ok: false, gating: true, detail: 'wrong amount' },
            { name: 'shadow_style', ok: false, gating: false },
          ],
          failures: [
            {
              origin: 'grader',
              code: 'REFUND_WRONG_AMOUNT',
              severity: 'critical',
              gating: true,
              source: 'ace.grader',
            },
          ],
        }),
      }),
    )
    add(traceFixture({ traceId: 'invalid-1', outcome: 'invalid', instanceId: 'scenario-c' }))
    add(
      traceFixture({
        traceId: 'runtime-1',
        outcome: 'runtime_error',
        instanceId: 'scenario-d',
      }),
    )
    add(traceFixture({ traceId: 'ungraded-1', outcome: 'ungraded', instanceId: 'scenario-e' }))
    add({
      ...traceFixture({ traceId: 'viewer-demo', outcome: 'pass' }),
      meta: {
        ...traceFixture({ traceId: 'viewer-demo', outcome: 'pass' }).meta,
        corpusId: 'bundled-demo',
        runId: 'run-demo',
      },
    })

    const dashboard = buildAceDashboard(store)
    expect(dashboard).toMatchObject({
      scope: {
        mode: 'all',
        requestedRunIds: [],
        selectedRunIds: ['run-a'],
        unmatchedRunIds: [],
        availableRuns: [{ runId: 'run-a', traces: 6, corpusIds: ['simulation'] }],
      },
      total: 6,
      pass: 2,
      fail: 1,
      invalid: 1,
      runtimeError: 1,
      ungraded: 1,
      executed: 3,
      passRateExecuted: 2 / 3,
      userSimValidityRate: 3 / 4,
    })
    expect(dashboard.failureChecks).toEqual([{ code: 'refund_correct', count: 1 }])
    expect(dashboard.failureOrigins).toEqual([{ code: 'grader', count: 1 }])
    expect(dashboard.triage).toEqual([
      expect.objectContaining({
        sourceTraceId: 'fail-1',
        severity: 'critical',
        codes: ['REFUND_WRONG_AMOUNT'],
      }),
    ])
    expect(dashboard.passAt1).toBe(0.5)
    expect(dashboard.passToK).toBe(0.5)
  })

  it('scopes one or multiple exact run ids and reports unmatched selections', () => {
    const store = new TraceStore()
    store.upsert(traceFixture({ traceId: 'a-pass', runId: 'run-a', outcome: 'pass' }))
    // A live trace without its sidecar still belongs to the denominator.
    store.upsert(traceFixture({ traceId: 'a-live', runId: 'run-a' }))
    store.upsert(traceFixture({ traceId: 'ab-fail', runId: 'run-a-long', outcome: 'fail' }))
    store.upsert(
      traceFixture({
        traceId: 'production-1',
        corpusId: 'production',
        runId: 'production',
        outcome: 'ungraded',
      }),
    )

    const selected = buildAceDashboard(store, ['run-a', 'production', 'missing', 'run-a'])
    expect(selected).toMatchObject({
      total: 3,
      pass: 1,
      fail: 0,
      ungraded: 2,
      executed: 1,
      passRateExecuted: 1,
      scope: {
        mode: 'selected',
        requestedRunIds: ['run-a', 'production', 'missing'],
        selectedRunIds: ['run-a', 'production'],
        unmatchedRunIds: ['missing'],
        availableRuns: [
          { runId: 'production', traces: 1, corpusIds: ['production'] },
          { runId: 'run-a', traces: 2, corpusIds: ['simulation'] },
          { runId: 'run-a-long', traces: 1, corpusIds: ['simulation'] },
        ],
      },
    })
    expect(selected.failureOrigins).toEqual([])
  })

  it('reports episode and attempt user-sim validity as distinct denominators', () => {
    const store = new TraceStore()
    store.upsert(
      traceFixture({
        traceId: 'eventual-pass',
        runId: 'retry-run',
        instanceId: 'scenario-retry',
        outcome: 'pass',
      }),
    )
    const batch: AceBatchSummary = {
      runId: 'retry-run',
      runKind: 'scored',
      schemaVersion: 3,
      lifecycle: 'completed',
      updatedAt: '2026-08-06T00:00:00Z',
      spec: {},
      totals: {
        episodes: 1,
        passed: 1,
        failedGrade: 0,
        runtimeErrors: 0,
        invalidUserSim: 0,
        userSimAttempts: 3,
        invalidUserSimAttempts: 2,
        passRate: 1,
        userSimValidityRate: 1 / 3,
        userSimAttemptValidityRate: 1 / 3,
        avgUserTurns: null,
        avgToolCalls: null,
        flagsMajor: 0,
        flagsMinor: 0,
        costUsd: null,
      },
      failureChecks: [],
      terminations: [],
    }

    const dashboard = buildAceDashboard(store, ['retry-run'], [], [batch])

    expect(dashboard).toMatchObject({
      userSimValidEpisodes: 1,
      userSimEpisodeDenominator: 1,
      userSimEpisodeValidityRate: 1,
      // Legacy clients retain the old episode-level meaning.
      userSimValidityRate: 1,
      userSimAttempts: 3,
      userSimInvalidAttempts: 2,
      userSimValidAttempts: 1,
      userSimAttemptValidityRate: 1 / 3,
      userSimAttemptRunCount: 1,
    })
  })

  it('fills task dimensions and escalation requirements from the task catalog', () => {
    const store = new TraceStore()
    store.upsert(
      traceFixture({
        traceId: 'escalation-required',
        instanceId: 'scenario-escalate',
        outcome: 'pass',
        evaluation: evaluation('pass', { metrics: { escalated: true } }),
      }),
    )
    store.upsert(
      traceFixture({
        traceId: 'escalation-unnecessary',
        instanceId: 'scenario-cancel',
        outcome: 'pass',
        evaluation: evaluation('pass', { metrics: { escalated: true } }),
      }),
    )

    const dashboard = buildAceDashboard(store, undefined, [
      taskFixture('scenario-escalate', 'delivery_problem', 'ko', 'escalate'),
      taskFixture('scenario-cancel', 'cancel_order', 'en', 'cancel'),
    ])

    expect(dashboard.issues).toEqual([
      { code: 'cancel_order', count: 1 },
      { code: 'delivery_problem', count: 1 },
    ])
    expect(dashboard.languages).toEqual([
      { code: 'en', count: 1 },
      { code: 'ko', count: 1 },
    ])
    expect(dashboard.requiredEscalations).toBe(1)
    expect(dashboard.unnecessaryEscalations).toBe(1)
  })

  it('keeps debug/counterfactual runs out of the default formal aggregate but allows exact analysis', () => {
    const store = new TraceStore()
    store.upsert(
      traceFixture({ traceId: 'formal', runId: 'formal-run', outcome: 'pass', runKind: 'scored' }),
    )
    store.upsert(
      traceFixture({ traceId: 'debug', runId: 'debug-run', outcome: 'fail', runKind: 'debug' }),
    )
    store.upsert(
      traceFixture({
        traceId: 'counterfactual',
        runId: 'cf-run',
        outcome: 'fail',
        runKind: 'counterfactual',
      }),
    )

    const formal = buildAceDashboard(store)
    expect(formal).toMatchObject({
      total: 1,
      pass: 1,
      fail: 0,
      scope: {
        defaultRunIds: ['formal-run'],
        selectedRunIds: ['formal-run'],
      },
    })
    expect(
      formal.scope.availableRuns.map(({ runId, runKind, includedByDefault }) => ({
        runId,
        runKind,
        includedByDefault,
      })),
    ).toEqual([
      { runId: 'cf-run', runKind: 'counterfactual', includedByDefault: false },
      { runId: 'debug-run', runKind: 'debug', includedByDefault: false },
      { runId: 'formal-run', runKind: 'scored', includedByDefault: true },
    ])

    expect(buildAceDashboard(store, ['debug-run'])).toMatchObject({
      total: 1,
      pass: 0,
      fail: 1,
      scope: { selectedRunIds: ['debug-run'] },
    })
  })

  it('includes batch-only running units and recorded cost without treating them as ungraded traces', () => {
    const store = new TraceStore()
    const batch: AceBatchSummary = {
      runId: 'live-empty',
      runKind: 'scored',
      schemaVersion: 3,
      lifecycle: 'running',
      updatedAt: '2026-08-06T00:00:00Z',
      spec: {},
      totals: {
        episodes: 3,
        passed: 0,
        failedGrade: 0,
        runtimeErrors: 0,
        invalidUserSim: 0,
        userSimAttempts: null,
        invalidUserSimAttempts: null,
        passRate: null,
        userSimValidityRate: null,
        userSimAttemptValidityRate: null,
        avgUserTurns: null,
        avgToolCalls: null,
        flagsMajor: 0,
        flagsMinor: 0,
        costUsd: 0.25,
      },
      failureChecks: [],
      terminations: [],
      episodes: [
        {
          scenarioId: 'scenario-a',
          seed: 1,
          sourceTraceId: 'scenario-a-s1',
          status: 'running',
          outcome: 'ungraded',
          failedChecks: [],
          flagsMajor: 0,
          flagsMinor: 0,
          invalidUserSim: false,
          environmentSeed: 1,
          pairKey: 'schedule:scenario-a:1',
        },
      ],
      reconciliation: {
        scheduledEpisodes: 3,
        manifestEpisodes: 1,
        ingestedTraces: 0,
        matchedTraces: 0,
        pendingTraceFiles: 1,
        missingTerminalTraces: 0,
        orphanTraces: 0,
      },
    }

    const dashboard = buildAceDashboard(store, undefined, [], [batch])
    expect(dashboard).toMatchObject({
      total: 0,
      ungraded: 0,
      scheduledEpisodes: 3,
      terminalEpisodes: 0,
      inProgressEpisodes: 3,
      awaitingTraceIngest: 0,
      totalCostUsd: 0.25,
      costRunCount: 1,
      scope: {
        selectedRunIds: ['live-empty'],
        availableRuns: [
          {
            runId: 'live-empty',
            traces: 0,
            lifecycle: 'running',
            scheduledEpisodes: 3,
            inProgressEpisodes: 3,
          },
        ],
      },
    })
  })

  it('reports bounded triage previews without understating the total', () => {
    const store = new TraceStore()
    for (let index = 0; index < 251; index += 1) {
      store.upsert(
        traceFixture({
          traceId: `triage-${index}`,
          runId: 'large-triage-run',
          outcome: 'fail',
          evaluation: evaluation('fail', {
            failures: [
              {
                origin: 'grader',
                code: 'grade.actions',
                severity: 'major',
                gating: true,
                source: 'ace.grader',
              },
            ],
          }),
        }),
      )
    }

    const dashboard = buildAceDashboard(store, ['large-triage-run'])
    expect(dashboard.triage).toHaveLength(250)
    expect(dashboard.triageTotal).toBe(251)
    expect(dashboard.triageTruncated).toBe(true)
  })
})
