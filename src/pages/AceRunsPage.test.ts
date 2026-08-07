import type { AceBatchEpisode, AceBatchTotals, AceRunTraceSummary } from '@shared/schema/ace'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AceRunAccessStatus,
  aceRunControlDisabled,
  aceRunHeartbeat,
  aceRunProgress,
  aceRunRowDiagnosis,
  aceRunRowMatchesChip,
  buildAceRunRows,
  collectRunIssues,
  filterAceRunRows,
  RunStatTiles,
} from './AceRunsPage'

function episode(overrides: Partial<AceBatchEpisode> = {}): AceBatchEpisode {
  return {
    scenarioId: 'scenario-a',
    seed: 1,
    sourceTraceId: 'scenario-a-s1',
    traceUid: 'trace-a',
    status: 'completed',
    outcome: 'pass',
    failedChecks: [],
    flagsMajor: 0,
    flagsMinor: 0,
    invalidUserSim: false,
    environmentSeed: 1,
    pairKey: 'schedule:scenario-a:1',
    ...overrides,
  }
}

function trace(overrides: Partial<AceRunTraceSummary> = {}): AceRunTraceSummary {
  return {
    traceUid: 'trace-a',
    sourceTraceId: 'scenario-a-s1',
    scenarioId: 'scenario-a',
    status: 'completed',
    outcome: 'pass',
    messageCount: 6,
    turns: 2,
    toolUses: 1,
    toolErrors: 0,
    failureCount: 0,
    majorFailureCount: 0,
    failureCodes: [],
    failureOrigins: [],
    judgeDisagreement: false,
    timestamp: '2026-08-06T00:00:00Z',
    ...overrides,
  }
}

function totals(overrides: Partial<AceBatchTotals> = {}): AceBatchTotals {
  return {
    episodes: 45,
    passed: 30,
    failedGrade: 10,
    runtimeErrors: 2,
    invalidUserSim: 3,
    userSimAttempts: 50,
    invalidUserSimAttempts: 5,
    passRate: 0.667,
    userSimValidityRate: 0.9,
    userSimAttemptValidityRate: 0.9,
    avgUserTurns: 4,
    avgToolCalls: 6,
    flagsMajor: 1,
    flagsMinor: 2,
    costUsd: 12.34,
    ...overrides,
  }
}

describe('RunStatTiles', () => {
  it('shows exactly the six primary tiles and folds the rest into More stats', () => {
    const html = renderToStaticMarkup(
      RunStatTiles({
        totals: totals(),
        tracesLoaded: 41,
        progress: { inProgress: 7, stateNotRepresented: 4 },
      }),
    )
    const [primary = '', more = ''] = html.split('More stats')
    for (const label of ['Scheduled', 'Pass', 'Fail', 'Invalid', 'Pass rate', 'Cost']) {
      expect(primary).toContain(`>${label}</span>`)
    }
    expect(primary.match(/<span class="text-slate-400">/g)).toHaveLength(6)
    expect(primary).toContain('$12.34')
    for (const label of ['Traces loaded', 'Runtime', 'In progress', 'Attempt validity']) {
      expect(primary).not.toContain(`>${label}</span>`)
      expect(more).toContain(`>${label}</span>`)
    }
    expect(more).toContain('4 schedule states not yet represented')
    expect(more).toContain('45 / 50 attempts')
  })

  it('renders a placeholder cost when the run reports none', () => {
    const html = renderToStaticMarkup(
      RunStatTiles({ totals: totals({ costUsd: null }), tracesLoaded: 0, progress: null }),
    )
    expect(html).toContain('—')
  })
})

describe('collectRunIssues', () => {
  it('returns nothing for a healthy scored run', () => {
    expect(collectRunIssues({ runKind: 'scored' })).toEqual([])
  })

  it('merges every run notice into one ordered list, errors first', () => {
    const issues = collectRunIssues(
      {
        runKind: 'debug',
        staleManifest: true,
        manifestError: 'EPARSE',
        lifecycleError: 'harness crashed',
        reconciliation: {
          scheduledEpisodes: 45,
          manifestEpisodes: 40,
          ingestedTraces: 39,
          matchedTraces: 39,
          pendingTraceFiles: 0,
          missingTerminalTraces: 1,
          orphanTraces: 2,
        },
      },
      new Error('bridge offline'),
    )
    expect(issues.map((issue) => issue.key)).toEqual([
      'lifecycle',
      'control',
      'run-kind',
      'stale-manifest',
      'reconciliation',
    ])
    expect(issues.filter((issue) => issue.severity === 'error')).toHaveLength(2)
    expect(issues.find((issue) => issue.key === 'control')?.text).toContain('bridge offline')
    expect(issues.find((issue) => issue.key === 'reconciliation')?.text).toContain(
      '1 terminal trace(s) missing · 2 orphan trace(s) · 40/45 scheduled states represented.',
    )
  })

  it('skips reconciliation when the schedule is fully represented', () => {
    expect(
      collectRunIssues({
        runKind: 'scored',
        reconciliation: {
          scheduledEpisodes: 45,
          manifestEpisodes: 45,
          ingestedTraces: 45,
          matchedTraces: 45,
          pendingTraceFiles: 0,
          missingTerminalTraces: 0,
          orphanTraces: 0,
        },
      }),
    ).toEqual([])
  })
})

describe('ACE run diagnostics helpers', () => {
  it('labels trace-only runs read-only and disables every control action', () => {
    const run = {
      manifestAvailable: false,
      controlsAvailable: false,
      lifecycle: 'running' as const,
    }
    expect(renderToStaticMarkup(AceRunAccessStatus(run))).toContain('trace-only · read-only')
    expect(aceRunControlDisabled(run, 'pause')).toBe(true)
    expect(aceRunControlDisabled(run, 'resume')).toBe(true)
    expect(aceRunControlDisabled(run, 'cancel')).toBe(true)

    expect(aceRunControlDisabled({ controlsAvailable: true, lifecycle: 'running' }, 'pause')).toBe(
      false,
    )
  })

  it('marks only active runs with a heartbeat older than two minutes as stale', () => {
    const now = Date.parse('2026-08-06T00:03:00Z')
    expect(aceRunHeartbeat('2026-08-06T00:00:00Z', 'running', now).stale).toBe(true)
    expect(aceRunHeartbeat('2026-08-06T00:02:00Z', 'running', now).stale).toBe(false)
    expect(aceRunHeartbeat('2026-08-06T00:00:00Z', 'completed', now).stale).toBe(false)
    expect(aceRunHeartbeat('not-a-date', 'running', now)).toEqual({ ageMs: null, stale: false })
  })

  it('derives in-progress from the complete schedule when manifest states are partial', () => {
    expect(
      aceRunProgress(45, [
        ...Array.from({ length: 8 }, () => ({ status: 'completed' })),
        ...Array.from({ length: 2 }, () => ({ status: 'running' })),
      ]),
    ).toEqual({ terminal: 8, inProgress: 37, stateNotRepresented: 35 })
  })
})

describe('unified episodes table', () => {
  const scheduled = [
    episode(),
    episode({
      scenarioId: 'scenario-b',
      sourceTraceId: 'scenario-b-s2',
      traceUid: 'trace-b',
      seed: 2,
      status: 'failed',
      outcome: 'runtime_error',
      pairKey: 'schedule:scenario-b:2',
    }),
    episode({
      scenarioId: 'scenario-c',
      sourceTraceId: 'scenario-c-s3',
      traceUid: undefined,
      seed: 3,
      status: 'running',
      outcome: 'ungraded',
      pairKey: 'schedule:scenario-c:3',
    }),
    episode({
      scenarioId: 'scenario-d',
      sourceTraceId: 'scenario-d-s4',
      traceUid: undefined,
      seed: 4,
      status: 'completed',
      outcome: 'invalid',
      invalidUserSim: true,
      pairKey: 'schedule:scenario-d:4',
    }),
  ]
  const durable = [
    trace(),
    trace({
      traceUid: 'trace-b',
      sourceTraceId: 'scenario-b-s2',
      scenarioId: 'scenario-b',
      status: 'failed',
      outcome: 'runtime_error',
      majorFailureCount: 1,
      failureCodes: ['runtime.provider_timeout'],
      failureOrigins: ['runtime'],
    }),
    trace({
      traceUid: 'trace-orphan',
      sourceTraceId: 'scenario-x-s9',
      scenarioId: 'scenario-x',
      outcome: 'fail',
      failureCount: 2,
      failureCodes: ['agent.wrong_tool'],
    }),
  ]
  const rows = buildAceRunRows(scheduled, durable)

  it('joins the schedule with durable traces and appends orphan traces', () => {
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual({ episode: scheduled[0], trace: durable[0] })
    expect(rows[1]).toEqual({ episode: scheduled[1], trace: durable[1] })
    expect(rows[2]).toEqual({ episode: scheduled[2], trace: undefined })
    expect(rows[4]).toEqual({ trace: durable[2] })
  })

  it('implements the four chips: All | In progress | Failures only | Invalid', () => {
    const names = (chip: 'all' | 'in_progress' | 'failures' | 'invalid') =>
      filterAceRunRows(rows, { chip, query: '', status: '' }).map(
        (row) => row.episode?.scenarioId ?? row.trace?.scenarioId,
      )
    expect(names('all')).toEqual([
      'scenario-a',
      'scenario-b',
      'scenario-c',
      'scenario-d',
      'scenario-x',
    ])
    expect(names('in_progress')).toEqual(['scenario-c'])
    expect(names('failures')).toEqual(['scenario-b', 'scenario-d', 'scenario-x'])
    expect(names('invalid')).toEqual(['scenario-d'])
  })

  it('keeps the search + status pipeline on top of the chips', () => {
    expect(
      filterAceRunRows(rows, { chip: 'all', query: 'provider_timeout', status: 'failed' }).map(
        (row) => row.episode?.scenarioId,
      ),
    ).toEqual(['scenario-b'])
    expect(
      filterAceRunRows(rows, { chip: 'failures', query: 'wrong_tool', status: '' }).map(
        (row) => row.trace?.scenarioId,
      ),
    ).toEqual(['scenario-x'])
    expect(filterAceRunRows(rows, { chip: 'failures', query: 'nope', status: '' })).toEqual([])
  })

  it('keeps an otherwise passing episode in Failures only when diagnostics disagree', () => {
    const disagreeing = buildAceRunRows(
      [episode()],
      [
        trace({
          failureCount: 1,
          failureCodes: ['agent.cot_leak'],
          failureOrigins: ['detector'],
          judgeDisagreement: true,
        }),
      ],
    )
    expect(aceRunRowMatchesChip(disagreeing[0], 'failures')).toBe(true)
    expect(filterAceRunRows(disagreeing, { chip: 'all', query: 'detector', status: '' })).toEqual(
      disagreeing,
    )
  })

  it('merges triage-only details (flags, termination, turns/tools) into the diagnosis', () => {
    const row = buildAceRunRows(
      [
        episode({
          failedChecks: ['refund_contract'],
          flagsMajor: 1,
          flagsMinor: 2,
          termination: 'user_stop',
        }),
      ],
      [
        trace({
          failureCodes: ['refund_contract', 'agent.cot_leak'],
          judgeDisagreement: true,
          turns: 4,
          toolUses: 7,
        }),
      ],
    )[0]
    expect(aceRunRowDiagnosis(row)).toEqual({
      signals: ['refund_contract', 'agent.cot_leak', 'judge disagreement'],
      details: ['flags 1M/2m', 'termination user_stop', 'turns 4 · tools 7'],
    })
  })
})
