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
      exploratoryTraceCount: 0,
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
  runKind?: 'scored' | 'debug' | 'counterfactual' | null
  configDigest?: string
  pairKey?: string | null
}): ParsedTrace {
  const traceEvaluation =
    options.evaluation ?? (options.outcome === undefined ? undefined : evaluation(options.outcome))
  const runId = options.runId ?? 'run-a'
  const instanceId = options.instanceId ?? options.traceId
  const environmentSeed = options.seed ?? 1
  const runKind =
    options.runKind === undefined
      ? options.corpusId === 'production'
        ? undefined
        : 'scored'
      : options.runKind
  return {
    meta: {
      traceId: options.traceId,
      sourceTraceId: options.traceId,
      corpusId: options.corpusId ?? 'simulation',
      runId,
      instanceId,
      ...(options.pairKey === null
        ? {}
        : { pairKey: options.pairKey ?? `schedule:${instanceId}:${environmentSeed}` }),
      component: 'ace/test',
      status: options.outcome === 'runtime_error' ? 'failed' : 'completed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
      extra: {
        environment_seed: environmentSeed,
        config_digest: options.configDigest ?? 'config-a',
        prompt: 'baseline',
        transport: 'responses',
        ...(runKind ? { run_kind: runKind } : {}),
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

  it('computes the ACE per-scenario combinatorial reliability golden curve', () => {
    const store = new TraceStore()
    const add = (traceId: string, instanceId: string, seed: number, outcome: TraceOutcome) =>
      store.upsert(traceFixture({ traceId, instanceId, seed, outcome }))

    add('a-1', 'scenario-a', 1, 'pass')
    add('a-2', 'scenario-a', 2, 'fail')
    add('b-1', 'scenario-b', 1, 'pass')
    add('b-2', 'scenario-b', 2, 'pass')

    const dashboard = buildAceDashboard(store)
    expect(dashboard.reliability.authority).toEqual({
      metric: 'pass^k',
      method: 'mean_per_scenario_combination_probability',
      formula: 'mean_s(C(successes_s,k)/C(trials_s,k))',
      source: 'ac_express/scripts/run_factorial.py::_task_pass_k',
      trialPolicy: 'pass_fail_only',
    })
    expect(dashboard.reliability.cells).toEqual([
      expect.objectContaining({
        runId: 'run-a',
        configDigest: 'config-a',
        commonMaxK: 2,
        coverage: {
          inputTraceCount: 4,
          gradedTraceCount: 4,
          validTrialCount: 4,
          scenarioDenominator: 2,
          minTrialsPerScenario: 2,
          maxTrialsPerScenario: 2,
        },
        curve: [
          { k: 1, value: 0.75, scenarioDenominator: 2 },
          { k: 2, value: 0.5, scenarioDenominator: 2 },
        ],
      }),
    ])
    expect(dashboard.passAt1).toBe(0.75)
    expect(dashboard.passToK).toBe(0.5)
  })

  it('uses a common k across uneven scenario seed counts', () => {
    const store = new TraceStore()
    const add = (traceId: string, instanceId: string, seed: number, outcome: TraceOutcome) =>
      store.upsert(traceFixture({ traceId, instanceId, seed, outcome }))

    add('a-1', 'scenario-a', 1, 'pass')
    add('a-2', 'scenario-a', 2, 'pass')
    add('a-3', 'scenario-a', 3, 'fail')
    add('b-1', 'scenario-b', 1, 'pass')
    add('b-2', 'scenario-b', 2, 'fail')

    const cell = buildAceDashboard(store).reliability.cells[0]
    expect(cell).toMatchObject({
      commonMaxK: 2,
      coverage: {
        validTrialCount: 5,
        scenarioDenominator: 2,
        minTrialsPerScenario: 2,
        maxTrialsPerScenario: 3,
      },
    })
    expect(cell?.curve[0]?.value).toBeCloseTo(7 / 12)
    expect(cell?.curve[1]?.value).toBeCloseTo(1 / 6)
  })

  it('reports invalid/runtime/ungraded/missing-pair exclusions and rejects duplicate groups', () => {
    const store = new TraceStore()
    store.upsert(
      traceFixture({ traceId: 'kept', instanceId: 'scenario-a', seed: 1, outcome: 'pass' }),
    )
    store.upsert(
      traceFixture({ traceId: 'duplicate', instanceId: 'scenario-a', seed: 1, outcome: 'pass' }),
    )
    store.upsert(
      traceFixture({
        traceId: 'missing-pair',
        instanceId: 'scenario-a',
        seed: 2,
        outcome: 'pass',
        pairKey: null,
      }),
    )
    store.upsert(
      traceFixture({ traceId: 'invalid', instanceId: 'scenario-a', seed: 3, outcome: 'invalid' }),
    )
    store.upsert(
      traceFixture({
        traceId: 'runtime',
        instanceId: 'scenario-a',
        seed: 4,
        outcome: 'runtime_error',
      }),
    )
    store.upsert(
      traceFixture({ traceId: 'ungraded', instanceId: 'scenario-a', seed: 5, outcome: 'ungraded' }),
    )

    const cell = buildAceDashboard(store).reliability.cells[0]
    expect(cell).toMatchObject({
      exclusions: {
        invalid: 1,
        runtimeError: 1,
        ungraded: 1,
        missingPairKey: 1,
        duplicatePair: 2,
      },
      coverage: {
        inputTraceCount: 6,
        gradedTraceCount: 3,
        validTrialCount: 0,
        scenarioDenominator: 0,
      },
      commonMaxK: 0,
      curve: [],
    })
  })

  it('fail-closed excludes every row in a contradictory pass/fail duplicate group', () => {
    const store = new TraceStore()
    store.upsert(
      traceFixture({
        traceId: 'conflict-pass',
        instanceId: 'scenario-conflict',
        seed: 1,
        outcome: 'pass',
      }),
    )
    store.upsert(
      traceFixture({
        traceId: 'conflict-fail',
        instanceId: 'scenario-conflict',
        seed: 1,
        outcome: 'fail',
      }),
    )

    const cell = buildAceDashboard(store).reliability.cells[0]
    expect(cell).toMatchObject({
      exclusions: { duplicatePair: 2 },
      coverage: {
        inputTraceCount: 2,
        gradedTraceCount: 2,
        validTrialCount: 0,
        scenarioDenominator: 0,
      },
      commonMaxK: 0,
      curve: [],
    })
  })

  it('keeps run/config cells separate and excludes exploratory traces from reliability', () => {
    const store = new TraceStore()
    store.upsert(
      traceFixture({ traceId: 'a', runId: 'formal', outcome: 'pass', configDigest: 'config-a' }),
    )
    store.upsert(
      traceFixture({ traceId: 'b', runId: 'formal', outcome: 'fail', configDigest: 'config-b' }),
    )
    store.upsert(
      traceFixture({ traceId: 'debug', runId: 'debug', outcome: 'pass', runKind: 'debug' }),
    )

    const dashboard = buildAceDashboard(store, ['formal', 'debug'])
    expect(dashboard.reliability.cells.map((cell) => [cell.runId, cell.configDigest])).toEqual([
      ['formal', 'config-a'],
      ['formal', 'config-b'],
    ])
    expect(dashboard.reliability.excludedNonFormalTraceCount).toBe(1)
    expect(dashboard.passToK).toBeNull()
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
      scheduledEpisodes: 3,
      formalScheduledEpisodes: 2,
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
    expect(dashboard.escalation).toMatchObject({
      knownPairDenominator: 2,
      requiredObserved: 1,
      requiredNotObserved: 0,
      notRequiredObserved: 1,
      notRequiredNotObserved: 0,
      requiredDenominator: 1,
      notRequiredDenominator: 1,
      observedDenominator: 2,
      requiredHitRate: 1,
      unnecessaryEscalationRate: 1,
      observedPrecision: 0.5,
    })
  })

  it('reports escalation misses, true negatives, and unknown denominator coverage', () => {
    const store = new TraceStore()
    store.upsert(
      traceFixture({
        traceId: 'required-missed',
        instanceId: 'required',
        outcome: 'pass',
        evaluation: evaluation('pass', { metrics: { escalated: false } }),
      }),
    )
    store.upsert(
      traceFixture({
        traceId: 'not-required-clean',
        instanceId: 'not-required',
        outcome: 'pass',
        evaluation: evaluation('pass', { metrics: { escalated: false } }),
      }),
    )
    store.upsert(traceFixture({ traceId: 'unknown', instanceId: 'unknown', outcome: 'pass' }))

    const dashboard = buildAceDashboard(store, undefined, [
      taskFixture('required', 'fraud', 'en', 'escalate'),
      taskFixture('not-required', 'refund', 'en', 'resolve'),
    ])
    expect(dashboard.escalation).toEqual({
      traceCount: 3,
      knownPairDenominator: 2,
      unknownRequirement: 1,
      unknownObservation: 1,
      requiredObserved: 0,
      requiredNotObserved: 1,
      notRequiredObserved: 0,
      notRequiredNotObserved: 1,
      requiredDenominator: 1,
      notRequiredDenominator: 1,
      observedDenominator: 0,
      notObservedDenominator: 2,
      requiredHitRate: 0,
      unnecessaryEscalationRate: 0,
      observedPrecision: null,
    })
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
      formalScheduledEpisodes: 0,
      scope: { selectedRunIds: ['debug-run'] },
    })
  })

  it('fails closed across camelCase, lineage exclusions, synthetic traces, and missing kinds', () => {
    const camel = traceFixture({
      traceId: 'camel',
      runId: 'camel-run',
      outcome: 'pass',
      runKind: null,
    })
    camel.meta.extra = { ...camel.meta.extra, runKind: 'scored' }
    const lineage = traceFixture({
      traceId: 'lineage',
      runId: 'lineage-run',
      outcome: 'pass',
      runKind: null,
    })
    if (lineage.evaluation) lineage.evaluation.lineage = { runKind: 'scored' }
    const excluded = traceFixture({
      traceId: 'excluded',
      runId: 'excluded-run',
      outcome: 'pass',
    })
    if (excluded.evaluation) {
      excluded.evaluation.lineage = { runKind: 'scored', formalMetricsExcluded: true }
    }
    const synthetic = traceFixture({
      traceId: 'synthetic',
      runId: 'synthetic-run',
      outcome: 'pass',
    })
    if (synthetic.evaluation) {
      synthetic.evaluation.lineage = { runKind: 'scored', synthetic: true }
    }
    const missing = traceFixture({
      traceId: 'missing',
      runId: 'missing-run',
      outcome: 'pass',
      runKind: null,
    })
    const replay = traceFixture({
      traceId: 'replay',
      runId: 'replay-run',
      outcome: 'pass',
    })
    if (replay.evaluation) replay.evaluation.lineage = { runKind: 'scored', mode: 'exact' }
    const store = new TraceStore()
    for (const parsed of [camel, lineage, excluded, synthetic, missing, replay]) {
      store.upsert(parsed)
    }

    const dashboard = buildAceDashboard(store)
    expect(dashboard).toMatchObject({
      total: 2,
      pass: 2,
      scope: {
        defaultRunIds: ['camel-run', 'lineage-run'],
        selectedRunIds: ['camel-run', 'lineage-run'],
      },
    })
    expect(dashboard.reliability.cells.map((cell) => cell.runId)).toEqual([
      'camel-run',
      'lineage-run',
    ])
    expect(
      dashboard.scope.availableRuns.map(({ runId, runKind, includedByDefault }) => ({
        runId,
        runKind,
        includedByDefault,
      })),
    ).toEqual([
      { runId: 'camel-run', runKind: 'scored', includedByDefault: true },
      { runId: 'excluded-run', runKind: 'unknown', includedByDefault: false },
      { runId: 'lineage-run', runKind: 'scored', includedByDefault: true },
      { runId: 'missing-run', runKind: 'unknown', includedByDefault: false },
      { runId: 'replay-run', runKind: 'unknown', includedByDefault: false },
      { runId: 'synthetic-run', runKind: 'unknown', includedByDefault: false },
    ])
  })

  it('quarantines a run whose trace-level kinds mix formal and exploratory episodes', () => {
    const store = new TraceStore()
    store.upsert(
      traceFixture({ traceId: 'formal', runId: 'mixed-run', outcome: 'pass', runKind: 'scored' }),
    )
    store.upsert(
      traceFixture({ traceId: 'debug', runId: 'mixed-run', outcome: 'fail', runKind: 'debug' }),
    )

    const batch: AceBatchSummary = {
      runId: 'mixed-run',
      runKind: 'scored',
      schemaVersion: 3,
      lifecycle: 'completed',
      updatedAt: '2026-08-06T00:00:00Z',
      spec: {},
      totals: {
        episodes: 2,
        passed: 1,
        failedGrade: 1,
        runtimeErrors: 0,
        invalidUserSim: 0,
        userSimAttempts: null,
        invalidUserSimAttempts: null,
        passRate: 0.5,
        userSimValidityRate: null,
        userSimAttemptValidityRate: null,
        avgUserTurns: null,
        avgToolCalls: null,
        flagsMajor: 0,
        flagsMinor: 0,
        costUsd: null,
      },
      failureChecks: [],
      terminations: [],
    }

    const defaultDashboard = buildAceDashboard(store, undefined, [], [batch])
    expect(defaultDashboard).toMatchObject({
      total: 0,
      pass: 0,
      fail: 0,
      formalScheduledEpisodes: 0,
      reliability: { cells: [] },
      scope: {
        defaultRunIds: [],
        selectedRunIds: [],
        availableRuns: [{ runId: 'mixed-run', runKind: 'unknown', includedByDefault: false }],
      },
    })

    const explicitDashboard = buildAceDashboard(store, ['mixed-run'], [], [batch])
    expect(explicitDashboard).toMatchObject({
      total: 2,
      pass: 1,
      fail: 1,
      scheduledEpisodes: 2,
      formalScheduledEpisodes: 0,
      reliability: {
        excludedNonFormalTraceCount: 2,
        cells: [],
      },
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
      formalScheduledEpisodes: 3,
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

  it('paginates the complete deterministic triage queue without understating the total', () => {
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

    const first = buildAceDashboard(store, ['large-triage-run'])
    expect(first.triage).toHaveLength(250)
    expect(first.triageTotal).toBe(251)
    expect(first).toMatchObject({
      triageOffset: 0,
      triageLimit: 250,
      triageHasPrevious: false,
      triageHasNext: true,
      triageTruncated: true,
    })

    const second = buildAceDashboard(store, ['large-triage-run'], [], [], {
      offset: 250,
      limit: 250,
    })
    expect(second.triage).toHaveLength(1)
    expect(second).toMatchObject({
      triageTotal: 251,
      triageOffset: 250,
      triageLimit: 250,
      triageHasPrevious: true,
      triageHasNext: false,
      triageTruncated: true,
    })
    expect(new Set([...first.triage, ...second.triage].map((item) => item.traceUid)).size).toBe(251)
  })
})
