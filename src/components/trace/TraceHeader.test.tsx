import type { Trace } from '@shared/schema/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hookMocks = vi.hoisted(() => ({ neighbors: vi.fn() }))

vi.mock('../../api/hooks', () => ({ useNeighbors: hookMocks.neighbors }))

import { resolveTraceTab, TRACE_TABS, TraceHeader } from './TraceHeader'

function makeTrace(): Trace {
  return {
    meta: {
      traceId: 'same-producer-id',
      traceUid: 'simulation:run-a:sha-123',
      sourceTraceId: 'same-producer-id',
      corpusId: 'simulation',
      runId: 'run-a',
      instanceId: 'scenario-1',
      component: 'ace/support',
      status: 'failed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'ace-episode',
    },
    messages: [{ id: 'm-0', role: 'user', content: 'Help' }],
    stats: {
      score: 0.123,
      hasError: false,
      truncated: false,
      inputTokens: 1,
      outputTokens: 2,
      thinkingTokens: 0,
      totalTokens: 3,
      turns: 1,
      toolUses: 0,
      sandboxExecutions: 0,
      thinkingPortion: 0,
    },
    evaluation: {
      lifecycle: { state: 'failed' },
      outcome: 'fail',
      checks: [],
      metrics: {},
      failures: [
        {
          origin: 'grader',
          code: 'secret-grader-failure',
          severity: 'major',
          gating: true,
          source: 'test',
        },
      ],
      flags: [],
      worldDiff: [],
      ledger: [],
    },
  }
}

describe('TraceHeader cockpit tabs and identity', () => {
  beforeEach(() => {
    hookMocks.neighbors.mockReset()
    hookMocks.neighbors.mockReturnValue({
      data: { prevId: null, nextId: null, position: 1, total: 1 },
    })
  })

  it('converges on five primary tabs: conversation, evaluation, rerun, review, raw', () => {
    expect(TRACE_TABS).toEqual(['conversation', 'evaluation', 'rerun', 'review', 'raw'])
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TraceHeader trace={makeTrace()} activeTab="rerun" onTabChange={() => undefined} />
      </MemoryRouter>,
    )

    expect(html).toContain('Conversation')
    expect(html).toContain('Evaluation')
    expect(html).toContain('Rerun &amp; Fork')
    expect(html).toContain('Human Review')
    expect(html).toContain('Raw')
    // The merged surfaces no longer exist as standalone tabs.
    expect(html).not.toContain('State &amp; Tools')
    expect(html).not.toContain('Metadata</button>')
    expect(html).not.toContain('LLM-only continuation</button>')
  })

  it('maps legacy ?tab= deep links onto the consolidated tabs', () => {
    expect(resolveTraceTab('state')).toBe('evaluation')
    expect(resolveTraceTab('replay')).toBe('rerun')
    expect(resolveTraceTab('playground')).toBe('rerun')
    expect(resolveTraceTab('metadata')).toBe('raw')
    expect(resolveTraceTab('evolution')).toBe('evolution')
    expect(resolveTraceTab('rerun')).toBe('rerun')
    expect(resolveTraceTab('unknown')).toBe('conversation')
    expect(resolveTraceTab(null)).toBe('conversation')
  })

  it('keeps Evolution behind More only when a checkpoint was recorded', () => {
    const withCheckpoint = renderToStaticMarkup(
      <MemoryRouter>
        <TraceHeader trace={makeTrace()} activeTab="conversation" onTabChange={() => undefined} />
      </MemoryRouter>,
    )
    expect(withCheckpoint).toContain('trace-tabs-more')
    expect(withCheckpoint).toContain('Evolution')

    const trace = makeTrace()
    // Synthetic checkpoint provenance ⇒ no evolution data exists for this trace.
    trace.meta.extra = { normalization: { checkpointStep: 'default' } }
    const withoutCheckpoint = renderToStaticMarkup(
      <MemoryRouter>
        <TraceHeader trace={trace} activeTab="conversation" onTabChange={() => undefined} />
      </MemoryRouter>,
    )
    expect(withoutCheckpoint).not.toContain('trace-tabs-more')
    expect(withoutCheckpoint).not.toContain('Evolution')
  })

  it('uses canonical traceUid for neighbors and drawer expansion while displaying sourceTraceId', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TraceHeader
          trace={makeTrace()}
          activeTab="rerun"
          onTabChange={() => undefined}
          variant="drawer"
        />
      </MemoryRouter>,
    )

    expect(hookMocks.neighbors).toHaveBeenCalledWith('simulation:run-a:sha-123', {})
    expect(html).toContain('same-producer-id')
    expect(html).toMatch(/href="\/trace\/simulation(?::|%3A)run-a(?::|%3A)sha-123\?tab=rerun"/)
  })

  it('links simulation traces to their task definition without guessing for production traces', () => {
    const simulation = renderToStaticMarkup(
      <MemoryRouter>
        <TraceHeader trace={makeTrace()} activeTab="conversation" onTabChange={() => undefined} />
      </MemoryRouter>,
    )
    expect(simulation).toContain('View task definition')
    expect(simulation).toMatch(/href="\/ace\/tasks\/scenario-1"/)

    const production = makeTrace()
    production.meta.corpusId = 'production'
    const productionHtml = renderToStaticMarkup(
      <MemoryRouter>
        <TraceHeader trace={production} activeTab="conversation" onTabChange={() => undefined} />
      </MemoryRouter>,
    )
    expect(productionHtml).not.toContain('View task definition')
  })

  it('does not leak automatic status, score, or failure counts into blind calibration chrome', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TraceHeader
          trace={makeTrace()}
          activeTab="review"
          onTabChange={() => undefined}
          blindReview
        />
      </MemoryRouter>,
    )

    expect(html).toContain('blind calibration · automatic outcome hidden')
    expect(html).not.toContain('12.3%')
    expect(html).not.toContain('Evaluation<!-- --> (1)')
  })
})
