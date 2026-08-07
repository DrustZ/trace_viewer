import type { AceCheckpointResponse } from '@shared/schema/ace'
import type { Trace } from '@shared/schema/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const aceMocks = vi.hoisted(() => ({
  checkpoints: vi.fn(),
  replay: vi.fn(),
  regressionCapability: vi.fn(),
  saveRegression: vi.fn(),
}))

vi.mock('../../api/ace', () => ({
  useAceCheckpoints: aceMocks.checkpoints,
  useAceReplay: aceMocks.replay,
  useAceRegressionCapability: aceMocks.regressionCapability,
  useSaveAceRegression: aceMocks.saveRegression,
}))

import {
  checkpointForkMessageId,
  historicalReplayRequest,
  historicalReplayRows,
  historicalReplayUnavailableMessage,
  productionRegressionScenarioSeed,
  ReplayTab,
  validateRegressionScenarioDraft,
} from './ReplayTab'

function makeTrace(overrides: Partial<Trace['meta']> = {}): Trace {
  return {
    meta: {
      traceId: 'producer-duplicate',
      traceUid: 'production:abc123',
      sourceTraceId: 'producer-duplicate',
      corpusId: 'production',
      runId: 'production',
      instanceId: 'case-1',
      component: 'ace/support',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'unknown',
      sourceFormat: 'ace-production',
      ...overrides,
    },
    messages: [],
    stats: {
      score: null,
      hasError: false,
      truncated: false,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      turns: 0,
      toolUses: 0,
      sandboxExecutions: 0,
      thinkingPortion: 0,
    },
  }
}

function capability(overrides: Partial<AceCheckpointResponse> = {}): AceCheckpointResponse {
  return {
    traceUid: 'production:abc123',
    available: false,
    forkAvailable: false,
    historicalReplayAvailable: false,
    missing: ['checkpoint archive', 'scenario snapshot'],
    checkpoints: [],
    ...overrides,
  }
}

describe('ReplayTab', () => {
  beforeEach(() => {
    aceMocks.checkpoints.mockReset()
    aceMocks.replay.mockReset()
    aceMocks.regressionCapability.mockReset()
    aceMocks.saveRegression.mockReset()
    aceMocks.replay.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      data: undefined,
      error: null,
    })
    aceMocks.regressionCapability.mockReturnValue({
      isLoading: false,
      data: {
        traceUid: 'production:abc123',
        available: true,
        expectedArtifactKind: 'regression_draft',
        scenarioSnapshotAvailable: false,
        messageCount: 0,
        missing: [],
        explanation: 'No trace-bound Scenario snapshot is available.',
      },
    })
    aceMocks.saveRegression.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      data: undefined,
      error: null,
    })
  })

  it('addresses historical replay by canonical traceUid, never the duplicate producer id', () => {
    expect(historicalReplayRequest(makeTrace())).toEqual({
      sourceTraceUid: 'production:abc123',
      mode: 'historical_tools',
    })
  })

  it('explains both unavailable replay capabilities instead of silently disabling controls', () => {
    const data = capability()
    aceMocks.checkpoints.mockReturnValue({ isLoading: false, isError: false, data })

    const html = renderToStaticMarkup(<ReplayTab trace={makeTrace()} />)

    expect(html).toContain(historicalReplayUnavailableMessage(data))
    expect(html).toContain('Unavailable: checkpoint archive, scenario snapshot')
    expect(html).toMatch(/data-testid="historical-tool-replay"[^>]*disabled=""/)
  })

  it('labels successful historical replay as tool-only evidence, not exact LLM replay', () => {
    aceMocks.checkpoints.mockReturnValue({
      isLoading: false,
      isError: false,
      data: capability({ historicalReplayAvailable: true }),
    })
    aceMocks.replay.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
      data: {
        result: {
          fidelity: 'historical_tool_replay',
          informative: 7,
          informative_matches: 6,
          skipped_orphans: 2,
          records: [
            {
              tool: 'get_order_details',
              index: 4,
              raw_index: 7,
              stratum: 'informative_read',
              kind: 'state_mismatch',
              detail: 'recorded status differs',
            },
            {
              tool: 'escalate_to_human',
              index: 5,
              stratum: 'arg_echo',
              kind: 'match',
              detail: '',
            },
          ],
          residuals: [
            {
              tool: 'fallback_should_not_replace_records',
              index: 9,
              stratum: 'informative_read',
              kind: 'error_mismatch',
            },
          ],
        },
      },
    })

    const html = renderToStaticMarkup(<ReplayTab trace={makeTrace()} />)

    expect(html).toContain('compatibility evidence, not an exact LLM replay')
    expect(html).toContain('Informative')
    expect(html).toContain('Matches')
    expect(html).toContain('tool-only')
    expect(html).toContain('get_order_details')
    expect(html).toContain('chrono 4 · raw 7')
    expect(html).toContain('informative_read')
    expect(html).toContain('state_mismatch')
    expect(html).toContain('recorded status differs')
    expect(html).toContain('Showing 1/2 records')
    expect(html).not.toContain('escalate_to_human')
    expect(html).not.toContain('fallback_should_not_replace_records')
    expect(html).not.toContain('historical-replay-unavailable')
  })

  it('filters historical rows by replay stratum and falls back to residual-only output', () => {
    const bridgeResult = {
      residuals: [
        {
          tool: 'issue_refund',
          chronological_index: 2,
          rawIndex: 8,
          stratum: 'informative_write',
          kind: 'we_block_they_allow',
          detail: 'policy gate differs',
        },
        {
          tool: 'get_customer_orders',
          index: 3,
          stratum: 'arg_echo',
          kind: 'match',
        },
      ],
    }

    expect(historicalReplayRows(bridgeResult, true)).toEqual([
      {
        tool: 'issue_refund',
        chronologicalIndex: 2,
        rawIndex: 8,
        stratum: 'informative_write',
        kind: 'we_block_they_allow',
        detail: 'policy gate differs',
      },
    ])
    expect(historicalReplayRows(bridgeResult, false)).toHaveLength(2)
  })

  it('maps checkpoint prefix length to its last chronological message without off-by-one', () => {
    const trace = makeTrace()
    trace.messages = [
      {
        id: 'raw-first-but-last',
        role: 'assistant',
        content: '',
        rawIndex: 0,
        chronologicalIndex: 2,
      },
      { id: 'chronological-first', role: 'user', content: '', rawIndex: 1, chronologicalIndex: 0 },
      {
        id: 'chronological-second',
        role: 'assistant',
        content: '',
        rawIndex: 2,
        chronologicalIndex: 1,
      },
    ]

    expect(checkpointForkMessageId({ id: 3, phase: 'bot', message_count: 2 }, trace.messages)).toBe(
      'chronological-second',
    )
    expect(
      checkpointForkMessageId(
        {
          id: 3,
          phase: 'bot',
          message_count: 2,
          fork_message_id: 'bridge-authoritative-boundary',
        },
        trace.messages,
      ),
    ).toBe('bridge-authoritative-boundary')
    expect(
      checkpointForkMessageId({ id: 0, phase: 'user', message_count: 0 }, trace.messages),
    ).toBe(undefined)
    expect(checkpointForkMessageId({ id: 9, phase: 'bot', message_count: 4 }, trace.messages)).toBe(
      undefined,
    )
  })

  it('displays the selected checkpoint boundary and returned immutable lineage', () => {
    const trace = makeTrace({ corpusId: 'simulation', runId: 'parent-run' })
    trace.messages = [
      { id: 'm-chronological-0', role: 'user', content: 'hello', chronologicalIndex: 0 },
      { id: 'm-chronological-1', role: 'assistant', content: 'hi', chronologicalIndex: 1 },
    ]
    aceMocks.checkpoints.mockReturnValue({
      isLoading: false,
      isError: false,
      data: capability({
        available: true,
        forkAvailable: true,
        checkpoints: [
          {
            id: 7,
            phase: 'bot',
            message_count: 2,
            branchable: true,
            counterfactual_branchable: true,
          },
        ],
      }),
    })
    aceMocks.replay.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
      data: {
        result: {
          child_run_id: 'child-run',
          lineage: {
            checkpoint_id: 7,
            fork_message_id: 'm-chronological-1',
          },
        },
      },
    })

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ReplayTab trace={trace} />
      </MemoryRouter>,
    )

    expect(html).toContain('Fork lineage · checkpoint')
    expect(html).toContain('m-chronological-1')
    expect(html).toContain('Recorded lineage · checkpoint')
    expect(html).toContain('child-run')
  })

  it('keeps restore available but disables fork when trace-bound prerequisites are missing', () => {
    const trace = makeTrace({ corpusId: 'simulation' })
    aceMocks.checkpoints.mockReturnValue({
      isLoading: false,
      isError: false,
      data: capability({
        available: true,
        forkAvailable: false,
        missing: ['scenario snapshot', 'config snapshot'],
        checkpoints: [
          {
            id: 3,
            phase: 'bot',
            message_count: 1,
            branchable: true,
            counterfactual_branchable: true,
          },
        ],
      }),
    })

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ReplayTab trace={trace} />
      </MemoryRouter>,
    )

    expect(html).toContain('Fork unavailable: scenario snapshot, config snapshot')
    expect(html).toMatch(/>Restore snapshot \(no execution\)<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Fork exact config<\/button>/)
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Fork counterfactual · policy changed<\/button>/,
    )
  })

  it('explains draft fidelity and exposes raw plus chronological prefix anchors', () => {
    aceMocks.checkpoints.mockReturnValue({
      isLoading: false,
      isError: false,
      data: capability(),
    })
    const trace = makeTrace()
    trace.messages = [
      {
        id: 'm-raw-1',
        role: 'assistant',
        content: 'hello',
        rawIndex: 1,
        chronologicalIndex: 0,
      },
      {
        id: 'm-raw-0',
        role: 'user',
        content: 'help',
        rawIndex: 0,
        chronologicalIndex: 1,
      },
    ]

    const html = renderToStaticMarkup(<ReplayTab trace={trace} />)

    expect(html).toContain('Save as regression scenario')
    expect(html).toContain('Non-runnable regression draft')
    expect(html).toContain('chrono 0 · raw 1 · assistant')
    expect(html).toContain('chrono 1 · raw 0 · user')
    expect(html).toContain('does not call a model or tool')
    expect(html).toContain('Complete production evidence as a Scenario')
    expect(html).toContain('Synthetic reruns are always Debug/Counterfactual')
    expect(html).toContain('scenario-validation-error')
  })

  it('seeds a production Scenario from transcript and tool metadata without inventing targets', () => {
    const trace = makeTrace({
      sourceTraceId: 'case/with unsafe chars',
      extra: { issue: 'refund_payment', language: 'Spanish' },
    })
    trace.messages = [
      { id: 'm-0', role: 'user', content: 'Please refund order_003.' },
      {
        id: 'm-1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            name: 'issue_refund',
            arguments: '{"order_id":"order_003"}',
            parsedArguments: { order_id: 'order_003' },
          },
        ],
      },
    ]

    const seed = productionRegressionScenarioSeed(trace)

    expect(seed).toMatchObject({
      scenario_id: 'production-case-with-unsafe-chars',
      suite: 'regression',
      card: {
        issue: 'refund_payment',
        language: 'es',
        id_knowledge: 'exact',
        order_id: 'order_003',
        goal: 'Please refund order_003.',
      },
      expected_actions: [{ name: 'issue_refund', args_subset: { order_id: 'order_003' } }],
      expected_outcome: 'refund',
      reward_basis: ['ACTIONS', 'OUTCOME'],
    })
    expect(validateRegressionScenarioDraft(JSON.stringify(seed))).toEqual({
      ok: true,
      scenario: seed,
    })
  })

  it('returns actionable production Scenario JSON errors before saving', () => {
    expect(validateRegressionScenarioDraft('{not json')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Scenario JSON is invalid'),
    })
    const seed = productionRegressionScenarioSeed(makeTrace())
    expect(validateRegressionScenarioDraft(JSON.stringify(seed))).toEqual({
      ok: false,
      error: 'scenarioSnapshot.card.order_id must be a non-empty string of at most 128 characters',
    })
  })
})
