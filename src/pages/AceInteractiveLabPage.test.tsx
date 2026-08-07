import type { AceBatchSummary } from '@shared/schema/ace'
import type { Trace } from '@shared/schema/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  trace: vi.fn(),
  traces: vi.fn(),
  tasks: vi.fn(),
  capabilities: vi.fn(),
  scenarios: vi.fn(),
  startRun: vi.fn(),
  run: vi.fn(),
  runs: vi.fn(),
  control: vi.fn(),
  checkpoints: vi.fn(),
  replay: vi.fn(),
  regressionCapability: vi.fn(),
  saveRegression: vi.fn(),
}))

vi.mock('../api/hooks', () => ({
  useTrace: mocks.trace,
  useTraces: mocks.traces,
}))
vi.mock('../api/aceTasks', () => ({ useAceTasks: mocks.tasks }))
vi.mock('../api/ace', () => ({
  useAceCapabilities: mocks.capabilities,
  useAceScenarios: mocks.scenarios,
  useStartAceRun: mocks.startRun,
  useAceRun: mocks.run,
  useAceRuns: mocks.runs,
  useControlAceRun: mocks.control,
  useAceCheckpoints: mocks.checkpoints,
  useAceReplay: mocks.replay,
  useAceRegressionCapability: mocks.regressionCapability,
  useSaveAceRegression: mocks.saveRegression,
}))

import AceInteractiveLabPage from './AceInteractiveLabPage'

function sourceTrace(): Trace {
  return {
    meta: {
      traceId: 'episode-1',
      traceUid: 'simulation:parent-run:episode-1',
      sourceTraceId: 'episode-1',
      corpusId: 'simulation',
      runId: 'parent-run',
      instanceId: 'scenario-01',
      component: 'ace/test',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
      extra: {
        environment_seed: 3,
        config_snapshot: {
          runner: {},
          spec: {
            prompt_source: { kind: 'preset', value: 'baseline' },
            bot_model: 'assistant-recorded',
            bot_temperature: 0.3,
            reasoning_effort: 'low',
            bot: 'baseline',
          },
        },
      },
    },
    messages: [
      { id: 'm-0', role: 'user', content: 'My order is late' },
      {
        id: 'm-1',
        role: 'assistant',
        content: 'Let me check.',
        metadata: { agentType: 'beta' },
      },
    ],
    stats: {
      score: 1,
      hasError: false,
      truncated: false,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      turns: 2,
      toolUses: 1,
      sandboxExecutions: 0,
      thinkingPortion: 0,
    },
    evaluation: {
      lifecycle: { state: 'completed' },
      outcome: 'pass',
      checks: [],
      metrics: {},
      failures: [],
      flags: [],
      worldDiff: [],
      ledger: [],
    },
  }
}

const childRun = {
  runId: 'child-run',
  runKind: 'debug',
  schemaVersion: 3,
  manifestAvailable: true,
  controlsAvailable: true,
  lifecycle: 'running',
  updatedAt: '2026-08-06T00:00:00Z',
  spec: {},
  totals: {
    episodes: 1,
    passed: 1,
    failedGrade: 0,
    runtimeErrors: 0,
    invalidUserSim: 0,
    userSimAttempts: null,
    invalidUserSimAttempts: null,
    passRate: 1,
    userSimValidityRate: null,
    userSimAttemptValidityRate: null,
    avgUserTurns: null,
    avgToolCalls: null,
    flagsMajor: 0,
    flagsMinor: 0,
    costUsd: 0.05,
  },
  failureChecks: [],
  terminations: [],
} satisfies AceBatchSummary

describe('Playground page', () => {
  beforeEach(() => {
    mocks.trace
      .mockReset()
      .mockImplementation((uid?: string) =>
        uid === undefined
          ? { data: undefined, isLoading: false, isError: false }
          : { data: sourceTrace(), isLoading: false, isError: false },
      )
    mocks.traces.mockReset().mockReturnValue({ data: { items: [], total: 0 } })
    mocks.tasks.mockReset().mockReturnValue({
      data: {
        items: [
          {
            scenarioId: 'scenario-01',
            issue: 'late_order',
            sourceFiles: ['configs/scenarios/atomic.json'],
          },
          {
            scenarioId: 'refund-02',
            issue: 'refund',
            sourceFiles: ['configs/scenarios/atomic.json'],
          },
          {
            scenarioId: 'other-pack-1',
            issue: null,
            sourceFiles: ['configs/scenarios/multi.json'],
          },
        ],
      },
    })
    mocks.capabilities.mockReset().mockReturnValue({ data: { available: true }, isLoading: false })
    mocks.scenarios.mockReset().mockReturnValue({
      data: { items: [{ file: 'atomic.json', count: 12 }] },
    })
    mocks.startRun
      .mockReset()
      .mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null })
    mocks.run.mockReset().mockReturnValue({ data: childRun, isLoading: false, isError: false })
    mocks.runs.mockReset().mockReturnValue({ data: { items: [childRun] } })
    mocks.control.mockReset().mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.checkpoints.mockReset().mockReturnValue({ data: undefined })
    mocks.replay.mockReset().mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.regressionCapability.mockReset().mockReturnValue({ data: undefined })
    mocks.saveRegression.mockReset().mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  it('renders a left config panel prefilled from the source trace and a Run episode button', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ace/lab?trace=simulation%3Aparent-run%3Aepisode-1']}>
        <AceInteractiveLabPage />
      </MemoryRouter>,
    )

    expect(html).toContain('Playground')
    expect(html).toContain('data-testid="playground-config"')
    expect(html).toContain('data-testid="playground-run-episode"')
    // Recorded config prefilled: model input, seed, scenario id from provenance.
    expect(html).toContain('value="assistant-recorded"')
    expect(html).toMatch(/data-testid="playground-seed"[^>]*value="3"/)
    expect(html).toContain('scenario-01')
    expect(html).toContain('matched fresh rerun · lineage recorded')
    // The three capability cards and the 30-field batch form are gone.
    expect(html).not.toContain('Fresh task rerun · full ACE harness')
    expect(html).not.toContain('Checkpoint fork · restored prefix/state')
    expect(html).not.toContain('LLM-only continuation · no ACE execution')
    expect(html).not.toContain('Concurrency')
    expect(html).not.toContain('Response-lost rate')
    expect(html).not.toContain('Judge sample')
    // Batch escape hatch is signposted instead.
    expect(html).toContain('Runs → New run')
  })

  it('renders the session area with conversation bubbles and the grade card for a run', () => {
    const episodeSummary = sourceTrace()
    mocks.traces.mockReturnValue({ data: { items: [episodeSummary], total: 1 } })
    mocks.checkpoints.mockReturnValue({
      data: {
        available: true,
        forkAvailable: true,
        historicalReplayAvailable: false,
        missing: [],
        checkpoints: [{ id: 0, phase: 'await_bot', branchable: true, message_count: 2 }],
      },
    })
    mocks.regressionCapability.mockReturnValue({
      data: {
        available: true,
        scenarioSnapshotAvailable: true,
        expectedArtifactKind: 'runnable_scenario_pack',
        explanation: 'ok',
        missing: [],
      },
    })

    const html = renderToStaticMarkup(
      <MemoryRouter
        initialEntries={['/ace/lab?trace=simulation%3Aparent-run%3Aepisode-1&run=child-run']}
      >
        <AceInteractiveLabPage />
      </MemoryRouter>,
    )

    expect(html).toContain('data-testid="playground-session"')
    // Live status pill + Stop while the run is active.
    expect(html).toContain('data-testid="playground-session-status"')
    expect(html).toMatch(/data-testid="playground-session-phase"[^>]*>running · 2 messages</)
    expect(html).toContain('data-testid="playground-stop"')
    expect(html).toContain('data-role="user"')
    expect(html).toContain('data-role="beta"')
    expect(html).toContain('data-testid="playground-result-card"')
    expect(html).toContain('cost $0.050')
    expect(html).toContain('data-testid="playground-fork"')
    expect(html).toContain('data-testid="playground-save-regression"')
    expect(html).toContain('data-testid="playground-human-input"')
    // LiveRunMonitor stays below the session as run status.
    expect(html).toContain('data-testid="lab-live-run"')
    expect(html).toContain('Available now: pause, cancel')
  })

  it('offers a zero-config Quick run as the primary CTA when no scenario is picked', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ace/lab']}>
        <AceInteractiveLabPage />
      </MemoryRouter>,
    )

    expect(html).toMatch(/data-testid="playground-run-episode"[^>]*>Quick run</)
    // The CTA explains its auto-pick: first scenario of the default pack, seed 1.
    expect(html).toContain('Auto-picks scenario-01 from atomic.json · seed 1')
    // One primary CTA only — no separate Run episode button while unpicked.
    expect(html).not.toContain('>Run episode<')
    // Empty state carries the one-line guidance.
    expect(html).toContain(
      'Pick a scenario or just hit Quick run — messages stream in as the episode executes.',
    )
  })

  it('keeps Run episode as the CTA once a scenario is selected', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ace/lab?scenarioId=refund-02']}>
        <AceInteractiveLabPage />
      </MemoryRouter>,
    )
    expect(html).toMatch(/data-testid="playground-run-episode"[^>]*>Run episode</)
    expect(html).not.toContain('>Quick run<')
  })

  it('defaults transport to responses and keeps it editable in the config panel', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ace/lab']}>
        <AceInteractiveLabPage />
      </MemoryRouter>,
    )
    const select = html.match(/<select[^>]*data-testid="playground-transport"[\s\S]*?<\/select>/)
    expect(select).not.toBeNull()
    expect(select?.[0]).toMatch(/<option value="responses" selected/)
    expect(html).toContain('Chat supports function tools only with reasoning')
  })

  it('corrects a recorded never-runnable chat+reasoning combo and explains it in the panel', () => {
    const recorded = sourceTrace()
    const snapshot = recorded.meta.extra?.config_snapshot as { spec: Record<string, unknown> }
    snapshot.spec.agent_transport = 'chat_completions' // recorded reasoning stays 'low'
    mocks.trace.mockImplementation((uid?: string) =>
      uid === undefined
        ? { data: undefined, isLoading: false, isError: false }
        : { data: recorded, isLoading: false, isError: false },
    )

    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ace/lab?trace=simulation%3Aparent-run%3Aepisode-1']}>
        <AceInteractiveLabPage />
      </MemoryRouter>,
    )

    expect(html).toContain('data-testid="playground-transport-corrected"')
    expect(html).toContain('corrected to Responses. The original run failed with this config.')
    const select = html.match(/<select[^>]*data-testid="playground-transport"[\s\S]*?<\/select>/)
    expect(select?.[0]).toMatch(/<option value="responses" selected/)
    // Legal recordings render no correction banner (base fixture: no transport).
    const clean = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ace/lab']}>
        <AceInteractiveLabPage />
      </MemoryRouter>,
    )
    expect(clean).not.toContain('playground-transport-corrected')
  })

  it('surfaces the run lifecycle error headline in the session area', () => {
    mocks.run.mockReturnValue({
      data: {
        ...childRun,
        lifecycle: 'failed',
        controlsAvailable: false,
        lifecycleError:
          'BadRequestError: Error code: 400 - Function tools with reasoning_effort are not supported…\nTraceback…',
      },
      isLoading: false,
      isError: false,
    })

    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ace/lab?run=child-run&scenarioId=scenario-01']}>
        <AceInteractiveLabPage />
      </MemoryRouter>,
    )
    expect(html).toContain('data-testid="playground-runtime-error"')
    expect(html).toContain('Function tools with reasoning_effort are not supported…')
    expect(html).not.toContain('Traceback…')
  })

  it('disables and explains every control for a completed run', () => {
    mocks.run.mockReturnValue({
      data: { ...childRun, lifecycle: 'completed', controlsAvailable: false },
      isLoading: false,
      isError: false,
    })

    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ace/lab?run=child-run&scenarioId=scenario-01']}>
        <AceInteractiveLabPage />
      </MemoryRouter>,
    )

    expect(html).toContain('Run is completed; no further control actions are valid.')
    for (const action of ['pause', 'resume', 'cancel']) {
      expect(html.match(new RegExp(`<button([^>]*)>${action}</button>`))?.[1]).toContain(
        'disabled=""',
      )
    }
  })
})
