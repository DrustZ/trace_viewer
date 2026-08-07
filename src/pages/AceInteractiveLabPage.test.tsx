import type { AceBatchSummary } from '@shared/schema/ace'
import type { AceTaskDetail } from '@shared/schema/aceTasks'
import type { Trace } from '@shared/schema/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  trace: vi.fn(),
  traces: vi.fn(),
  task: vi.fn(),
  checkpoints: vi.fn(),
  run: vi.fn(),
  runs: vi.fn(),
  control: vi.fn(),
}))

vi.mock('../api/hooks', () => ({
  useTrace: mocks.trace,
  useTraces: mocks.traces,
}))
vi.mock('../api/aceTasks', () => ({ useAceTask: mocks.task }))
vi.mock('../api/ace', () => ({
  useAceCheckpoints: mocks.checkpoints,
  useAceRun: mocks.run,
  useAceRuns: mocks.runs,
  useControlAceRun: mocks.control,
}))
vi.mock('../components/ace/AceRunLauncher', () => ({
  ACE_RUN_FIDELITY_FIELDS: [
    'prompt',
    'model',
    'userModel',
    'transport',
    'temperature',
    'userTemperature',
    'reasoningEffort',
    'bot',
    'botOpens',
    'maxMessages',
    'concurrency',
    'stateScope',
    'latentRefundBlockRate',
    'toolFailBeforeRate',
    'toolResponseLostRate',
    'judge',
    'judgeSample',
    'semanticVerify',
    'semanticVerifySample',
    'checkpoints',
  ],
  AceRunLauncher: (props: Record<string, unknown>) => {
    const initial = (props.initialValues ?? {}) as Record<string, unknown>
    const recorded = (props.recordedConfig ?? {}) as { missing?: unknown[] }
    return (
      <div data-testid="launcher">
        launcher:{String(props.initialScenarioFile)}:{String(props.initialScenarioId)}:
        {String(props.initialSeed)}:{String(props.initialRunKind)}:{String(props.sourceTraceUid)}
        <span>
          config:{String(initial.prompt)}:{String(initial.model)}:{String(initial.userModel)}:
          {String(initial.transport)}:{String(initial.bot)}:{String(initial.stateScope)}:missing-
          {String(recorded.missing?.length)}
        </span>
      </div>
    )
  },
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
          runner: {
            max_messages: 32,
            concurrency: 2,
            bot_opens: true,
            state_scope: 'journey',
            latent_refund_block_rate: 0,
            tool_fail_before_rate: 0,
            tool_response_lost_rate: 0,
            judge_mode: 'off',
            judge_sample: 1,
            semantic_verify_mode: 'off',
            semantic_verify_sample: 1,
            checkpoint_enabled: true,
          },
          spec: {
            prompt_source: { kind: 'preset', value: 'baseline' },
            bot_model: 'assistant-recorded',
            user_model: 'user-recorded',
            bot_temperature: 0.3,
            user_temperature: 0.9,
            agent_transport: 'responses',
            reasoning_effort: 'low',
            bot: 'baseline',
          },
        },
      },
    },
    messages: [],
    stats: {
      score: 0,
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
  }
}

const task = {
  scenarioId: 'scenario-01',
  variants: [
    {
      sources: [{ pack: 'atomic', file: 'configs/scenarios/atomic.json' }],
    },
  ],
} as AceTaskDetail

const childRun = {
  runId: 'child-run',
  runKind: 'counterfactual',
  schemaVersion: 3,
  lifecycle: 'running',
  updatedAt: '2026-08-06T00:00:00Z',
  lineage: {
    relation: 'fresh_task_rerun',
    parentTraceUid: 'simulation:parent-run:episode-1',
    parentRunId: 'parent-run',
    fidelity: 'scenario_fresh_rerun_state_regenerated',
    stateExact: false,
    configExact: false,
    llmExact: false,
  },
  spec: {},
  totals: {
    episodes: 1,
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
    costUsd: 0,
  },
  failureChecks: [],
  terminations: [],
} satisfies AceBatchSummary

describe('ACE Interactive Lab page', () => {
  beforeEach(() => {
    mocks.trace
      .mockReset()
      .mockReturnValue({ data: sourceTrace(), isLoading: false, isError: false })
    mocks.task.mockReset().mockReturnValue({ data: task, isLoading: false, isError: false })
    mocks.checkpoints.mockReset().mockReturnValue({
      data: {
        available: true,
        historicalReplayAvailable: false,
        missing: [],
        checkpoints: [{ id: 0, phase: 'await_bot', branchable: true }],
      },
    })
    mocks.run.mockReset().mockReturnValue({ data: childRun, isLoading: false, isError: false })
    mocks.runs.mockReset().mockReturnValue({
      data: {
        items: [
          childRun,
          {
            ...childRun,
            runId: 'sibling-run',
          },
        ],
      },
    })
    mocks.control.mockReset().mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.traces.mockReset().mockReturnValue({ data: { items: [], total: 0 } })
  })

  it('keeps three fidelity modes distinct and prefills a matched fresh ACE branch', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter
        initialEntries={['/ace/lab?trace=simulation%3Aparent-run%3Aepisode-1&run=child-run']}
      >
        <AceInteractiveLabPage />
      </MemoryRouter>,
    )

    expect(html).toContain('Fresh task rerun · full ACE harness')
    expect(html).toContain('Checkpoint fork · restored prefix/state')
    expect(html).toContain('LLM-only continuation · no ACE execution')
    expect(html).toContain(
      'launcher:atomic.json:scenario-01:3:debug:simulation:parent-run:episode-1',
    )
    expect(html).toContain(
      'config:baseline:assistant-recorded:user-recorded:responses:baseline:journey:missing-0',
    )
    expect(html).toContain('Open checkpoint fork controls')
    expect(html).toContain('Compare parent run ↔ branch')
    expect(html).toContain('Compare with sibling sibling-run')
    expect(html).toContain('scenario_fresh_rerun_state_regenerated')
    expect(html).toContain('state exact: false')
    expect(html).toContain('Waiting for the first durable message')
  })

  it('does not guess checkpoint or matched-seed support when provenance is missing', () => {
    const noSeed = sourceTrace()
    noSeed.meta.extra = {}
    mocks.trace.mockReturnValue({ data: noSeed, isLoading: false, isError: false })
    mocks.checkpoints.mockReturnValue({
      data: {
        available: false,
        historicalReplayAvailable: false,
        missing: ['checkpoint archive', 'scenario/config snapshot'],
        checkpoints: [],
      },
    })

    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ace/lab?trace=simulation%3Aparent-run%3Aepisode-1']}>
        <AceInteractiveLabPage />
      </MemoryRouter>,
    )

    expect(html).toContain('Unavailable: checkpoint archive, scenario/config snapshot')
    expect(html).toContain('did not record an environment seed')
    expect(html).toContain('launcher:atomic.json:scenario-01:1:debug:undefined')
    expect(html).not.toContain('launcher:atomic.json:scenario-01:1:debug:simulation:')
  })
})
