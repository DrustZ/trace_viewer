import type { AceDashboardSummary } from '@shared/schema/ace'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { aceDashboardPath } from '../api/ace'
import {
  AceAnalysisReport,
  aceAnalysisRunIds,
  aceAnalysisSearchParams,
  aceAnalysisTriageOffset,
  toggleAceAnalysisRun,
} from './AceAnalysisPage'

function dashboardFixture(): AceDashboardSummary {
  return {
    scope: {
      mode: 'selected',
      requestedRunIds: ['run-a', 'run-b'],
      selectedRunIds: ['run-a', 'run-b'],
      defaultRunIds: ['run-a', 'run-b'],
      unmatchedRunIds: [],
      availableRuns: [
        {
          runId: 'run-a',
          traces: 2,
          corpusIds: ['simulation'],
          runKind: 'scored',
          includedByDefault: true,
          lifecycle: 'completed',
          scheduledEpisodes: 2,
          terminalEpisodes: 2,
          inProgressEpisodes: 0,
          awaitingTraceIngest: 0,
          pass: 1,
          fail: 1,
          invalid: 0,
          runtimeError: 0,
          ungraded: 0,
          passRateExecuted: 0.5,
          costUsd: 1.25,
        },
        {
          runId: 'run-b',
          traces: 1,
          corpusIds: ['simulation'],
          runKind: 'scored',
          includedByDefault: true,
          lifecycle: 'running',
          scheduledEpisodes: 3,
          terminalEpisodes: 1,
          inProgressEpisodes: 2,
          awaitingTraceIngest: 1,
          pass: 0,
          fail: 0,
          invalid: 0,
          runtimeError: 0,
          ungraded: 1,
          passRateExecuted: null,
          costUsd: null,
        },
      ],
    },
    total: 3,
    pass: 1,
    fail: 1,
    invalid: 0,
    runtimeError: 0,
    ungraded: 1,
    scheduledEpisodes: 5,
    formalScheduledEpisodes: 5,
    terminalEpisodes: 3,
    inProgressEpisodes: 2,
    awaitingTraceIngest: 1,
    executed: 2,
    passRateExecuted: 0.5,
    userSimValidityRate: 1,
    userSimValidEpisodes: 2,
    userSimEpisodeDenominator: 2,
    userSimEpisodeValidityRate: 1,
    userSimAttempts: 3,
    userSimInvalidAttempts: 2,
    userSimValidAttempts: 1,
    userSimAttemptValidityRate: 1 / 3,
    userSimAttemptRunCount: 1,
    reliability: {
      authority: {
        metric: 'pass^k',
        method: 'mean_per_scenario_combination_probability',
        formula: 'mean_s(C(successes_s,k)/C(trials_s,k))',
        source: 'ac_express/scripts/run_factorial.py::_task_pass_k',
        trialPolicy: 'pass_fail_only',
      },
      excludedNonFormalTraceCount: 0,
      cells: [
        {
          runId: 'run-a',
          configDigest: 'abcdef0123456789',
          coverage: {
            inputTraceCount: 3,
            gradedTraceCount: 2,
            validTrialCount: 2,
            scenarioDenominator: 1,
            minTrialsPerScenario: 2,
            maxTrialsPerScenario: 2,
          },
          exclusions: {
            invalid: 0,
            runtimeError: 0,
            ungraded: 1,
            missingPairKey: 0,
            duplicatePair: 0,
          },
          commonMaxK: 2,
          curve: [
            { k: 1, value: 0.5, scenarioDenominator: 1 },
            { k: 2, value: 0, scenarioDenominator: 1 },
          ],
        },
      ],
    },
    passAt1: 0.5,
    passToK: 0.5,
    escalation: {
      traceCount: 3,
      knownPairDenominator: 2,
      unknownRequirement: 1,
      unknownObservation: 1,
      requiredObserved: 1,
      requiredNotObserved: 0,
      notRequiredObserved: 0,
      notRequiredNotObserved: 1,
      requiredDenominator: 1,
      notRequiredDenominator: 1,
      observedDenominator: 1,
      notObservedDenominator: 1,
      requiredHitRate: 1,
      unnecessaryEscalationRate: 0,
      observedPrecision: 1,
    },
    requiredEscalations: 1,
    unnecessaryEscalations: 0,
    totalCostUsd: 1.25,
    costRunCount: 1,
    failureChecks: [{ code: 'ACTIONS', count: 1 }],
    failureOrigins: [{ code: 'grader', count: 1 }],
    failureCodes: [{ code: 'grade.actions', count: 1 }],
    detectorTiers: [{ code: 'hard_fact', count: 1 }],
    detectorFamilies: [{ code: 'agent', count: 1 }],
    toolErrors: [],
    terminations: [{ code: 'hangup', count: 2 }],
    issues: [{ code: 'refund', count: 2 }],
    languages: [{ code: 'English', count: 3 }],
    prompts: [{ code: 'optimized', count: 3 }],
    transports: [{ code: 'responses', count: 3 }],
    triageTotal: 1,
    triageOffset: 0,
    triageLimit: 250,
    triageHasPrevious: false,
    triageHasNext: false,
    triageTruncated: false,
    triage: [
      {
        traceUid: 'trace_canonical_1',
        sourceTraceId: 'scenario-01-seed-3',
        runId: 'run-b',
        instanceId: 'scenario-01',
        outcome: 'fail',
        severity: 'major',
        codes: ['grade.actions'],
        judgeDisagreement: false,
      },
    ],
  }
}

describe('ACE aggregate analysis page', () => {
  it('round-trips repeated runId selection and canonicalizes all selection', () => {
    const parsed = aceAnalysisRunIds(new URLSearchParams('runId=run-b&runId=run-a&runId=run-b'))
    expect(parsed).toEqual(['run-b', 'run-a'])
    expect(aceAnalysisSearchParams(parsed).toString()).toBe('runId=run-a&runId=run-b')
    expect(aceDashboardPath(parsed)).toBe('/api/ace/dashboard?runId=run-a&runId=run-b')
    expect(aceDashboardPath(parsed, { triageOffset: 250, triageLimit: 100 })).toBe(
      '/api/ace/dashboard?runId=run-a&runId=run-b&triageOffset=250&triageLimit=100',
    )
    expect(aceAnalysisTriageOffset(new URLSearchParams('triageOffset=250'))).toBe(250)
    expect(aceAnalysisTriageOffset(new URLSearchParams('triageOffset=-1'))).toBe(0)

    expect(toggleAceAnalysisRun([], ['run-a', 'run-b'], 'run-b')).toEqual(['run-a'])
    expect(toggleAceAnalysisRun(['run-a'], ['run-a', 'run-b'], 'run-b')).toEqual([])
  })

  it('renders truthful denominators, every requested breakdown, and canonical triage links', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AceAnalysisReport dashboard={dashboardFixture()} />
      </MemoryRouter>,
    )

    expect(html).toContain('1 / 2 executed')
    expect(html).toContain('Episode validity')
    expect(html).toContain('2 / 2 loaded graded/void episode traces')
    expect(html).toContain('Attempt validity')
    expect(html).toContain('1 / 3 recorded attempts across 1 run(s)')
    expect(html).toContain('Formal reliability curves')
    expect(html).toContain('Pass^1')
    expect(html).toContain('Pass^2')
    expect(html).toContain('2 unique trials')
    expect(html).toContain('1 scenario denominator')
    expect(html).toContain('ungraded 1')
    expect(html).toContain('1 / 1 required opportunities')
    expect(html).toContain('0 / 1 not-required opportunities')
    expect(html).toContain('Formal scheduled')
    expect(html).toContain('In-scope scheduled')
    expect(html).not.toContain('>Pass^k<')
    expect(html).toContain('1 traces')
    expect(html).toContain('Awaiting ingest')
    expect(html).toContain('$1.25')
    expect(html).toContain('Failed grading checks')
    expect(html).toContain('Failure codes')
    expect(html).toContain('Detector families')
    expect(html).toContain('Tool errors')
    expect(html).toContain('Termination reasons')
    expect(html).toContain('Prompts')
    expect(html).toContain('Transports')
    expect(html).toContain('issue.contains.refund')
    expect(html).toContain('/trace/trace_canonical_1?tab=evaluation')
    expect(html).toContain('scenario-01-seed-3')
    // Breakdown links retain both exact run ids with the DSL's `in` operator.
    expect(html).toContain('run.in.run-a%257Crun-b')
  })

  it('labels a bounded triage preview with its full total', () => {
    const dashboard = dashboardFixture()
    dashboard.triageTotal = 300
    dashboard.triageHasNext = true
    dashboard.triageTruncated = true
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AceAnalysisReport dashboard={dashboard} />
      </MemoryRouter>,
    )
    expect(html).toContain('showing 1–1 of 300 traces')
    expect(html).toContain('/ace/analysis?runId=run-a&amp;runId=run-b&amp;triageOffset=250')
    expect(html).toContain('Next →')
    expect(html).not.toContain('>1 traces<')
  })

  it('renders an addressable previous page for a later triage window', () => {
    const dashboard = dashboardFixture()
    dashboard.triageTotal = 501
    dashboard.triageOffset = 250
    dashboard.triageHasPrevious = true
    dashboard.triageHasNext = true
    dashboard.triageTruncated = true
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AceAnalysisReport dashboard={dashboard} />
      </MemoryRouter>,
    )
    expect(html).toContain('showing 251–251 of 501 traces')
    expect(html).toContain('/ace/analysis?runId=run-a&amp;runId=run-b')
    expect(html).toContain('triageOffset=500')
    expect(html).toContain('← Previous')
  })

  it('canonicalizes the formal default while allowing an explicit exploratory run', () => {
    expect(toggleAceAnalysisRun(['formal'], ['debug', 'formal'], 'debug', ['formal'])).toEqual([
      'debug',
      'formal',
    ])
    expect(
      toggleAceAnalysisRun(['debug', 'formal'], ['debug', 'formal'], 'debug', ['formal']),
    ).toEqual([])
  })
})
