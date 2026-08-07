import type { AceBatchEpisode, AceRunTraceSummary } from '@shared/schema/ace'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AceRunAccessStatus,
  aceRunControlDisabled,
  aceRunHeartbeat,
  filterAceRunEpisodes,
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

  it('filters the complete schedule by status and trace-level root-cause signals', () => {
    const rows = [
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
    ]
    const traces = new Map([
      ['trace-a', trace()],
      [
        'trace-b',
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
      ],
    ])

    expect(
      filterAceRunEpisodes(rows, traces, { query: '', status: '', failuresOnly: true }).map(
        (row) => row.scenarioId,
      ),
    ).toEqual(['scenario-b'])
    expect(
      filterAceRunEpisodes(rows, traces, {
        query: 'provider_timeout',
        status: 'failed',
        failuresOnly: false,
      }).map((row) => row.scenarioId),
    ).toEqual(['scenario-b'])
  })

  it('keeps an otherwise passing episode in problems-only triage when diagnostics disagree', () => {
    const row = episode()
    const traces = new Map([
      [
        'trace-a',
        trace({
          failureCount: 1,
          failureCodes: ['agent.cot_leak'],
          failureOrigins: ['detector'],
          judgeDisagreement: true,
        }),
      ],
    ])

    expect(
      filterAceRunEpisodes([row], traces, { query: '', status: '', failuresOnly: true }),
    ).toEqual([row])
    expect(
      filterAceRunEpisodes([row], traces, {
        query: 'detector',
        status: '',
        failuresOnly: false,
      }),
    ).toEqual([row])
  })
})
