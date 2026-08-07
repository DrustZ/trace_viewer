import type { AceCheckpointResponse } from '@shared/schema/ace'
import type { Trace } from '@shared/schema/types'
import { renderToStaticMarkup } from 'react-dom/server'
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

import { historicalReplayRequest, historicalReplayUnavailableMessage, ReplayTab } from './ReplayTab'

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
        },
      },
    })

    const html = renderToStaticMarkup(<ReplayTab trace={makeTrace()} />)

    expect(html).toContain('compatibility evidence, not an exact LLM replay')
    expect(html).toContain('Informative')
    expect(html).toContain('Matches')
    expect(html).toContain('tool-only')
    expect(html).not.toContain('historical-replay-unavailable')
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
  })
})
