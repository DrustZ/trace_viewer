import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import type { RouteCtx } from '../routes/context'
import { SearchIndex } from '../search/searchIndex'
import { TraceStore } from '../store/traceStore'
import { AnalysisError, type AnalystClient, executeTool, runAnalysis } from './analyst'

type CreateMock = Mock<AnalystClient['messages']['create']>

function fakeClient(create: CreateMock): AnalystClient {
  return { messages: { create } }
}

function parsedTrace(opts: {
  traceId: string
  status?: 'completed' | 'failed'
  step?: number
  score?: number
  content?: string
  extra?: Record<string, unknown>
}): ParsedTrace {
  return {
    meta: {
      traceId: opts.traceId,
      instanceId: `inst-${opts.traceId}`,
      component: 'code/leetcode',
      status: opts.status ?? 'completed',
      timestamp: '2026-03-01T00:00:00.000Z',
      checkpointStep: opts.step ?? 100,
      split: 'train',
      sourceFormat: 'native',
      ...(opts.extra ? { extra: opts.extra } : {}),
    },
    messages: [
      { id: 'm-0', role: 'user', content: 'Solve the coding task' },
      { id: 'm-1', role: 'assistant', channel: 'final', content: opts.content ?? 'answer' },
    ],
    ...(opts.score !== undefined ? { statsOverrides: { score: opts.score } } : {}),
    warnings: [],
  }
}

function makeCtx(traces: ParsedTrace[]): RouteCtx {
  const store = new TraceStore()
  for (const t of traces) store.upsert(t)
  return { store, searchIndex: new SearchIndex(store), dataRoots: [], importDir: '/tmp' }
}

const CTX = () =>
  makeCtx([
    parsedTrace({
      traceId: 't-fail',
      status: 'failed',
      score: 0,
      extra: { kl: 0.42, end_reason: 'timeout' },
    }),
    parsedTrace({
      traceId: 't-ok',
      score: 0.9,
      content: 'the reward hacking pattern appears here',
    }),
  ])

function toolUseResponse(name: string, input: unknown, id = 'tu-1') {
  return { content: [{ type: 'tool_use', id, name, input }] }
}

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] }
}

describe('executeTool', () => {
  it('list_traces applies the filter DSL and condenses rows (with extra keys)', () => {
    const out = executeTool(CTX(), 'list_traces', { filters: 'status.eq.failed' }) as {
      total: number
      items: Array<Record<string, unknown>>
    }
    expect(out.total).toBe(1)
    expect(out.items[0]).toMatchObject({
      traceId: 't-fail',
      component: 'code/leetcode',
      step: 100,
      split: 'train',
      status: 'failed',
      score: 0,
      kl: 0.42,
      end_reason: 'timeout',
    })
    expect(out.items[0]).not.toHaveProperty('instanceId')
  })

  it('list_traces caps limit at 50', () => {
    const many = Array.from({ length: 60 }, (_, i) => parsedTrace({ traceId: `t-${i}` }))
    const out = executeTool(makeCtx(many), 'list_traces', { limit: 500 }) as {
      total: number
      items: unknown[]
    }
    expect(out.total).toBe(60)
    expect(out.items).toHaveLength(50)
  })

  it('aggregate groups by status with compact rows', () => {
    const out = executeTool(CTX(), 'aggregate', { groupBy: 'status' }) as {
      rows: Array<Record<string, unknown>>
    }
    const failed = out.rows.find((r) => r.status === 'failed')
    expect(failed).toMatchObject({ count: 1, failed: 1, avgScore: 0 })
    expect(out.rows.find((r) => r.status === 'completed')).toMatchObject({
      count: 1,
      avgScore: 0.9,
    })
  })

  it('aggregate rejects an unknown groupBy', () => {
    expect(executeTool(CTX(), 'aggregate', { groupBy: 'model' })).toHaveProperty('error')
  })

  it('get_trace returns meta+stats+clamped messages and 404s unknown ids', () => {
    const out = executeTool(CTX(), 'get_trace', { traceId: 't-ok' }) as Record<string, unknown>
    expect(out.traceId).toBe('t-ok')
    expect(out.instanceId).toBe('inst-t-ok')
    expect(out.messages).toEqual([
      '#1 user: Solve the coding task',
      '#2 assistant/final: the reward hacking pattern appears here',
    ])
    expect(executeTool(CTX(), 'get_trace', { traceId: 'nope' })).toHaveProperty('error')
  })

  it('get_trace honors the maxChars budget with an omission marker', () => {
    const out = executeTool(CTX(), 'get_trace', { traceId: 't-ok', maxChars: 500 }) as {
      messages: string[]
    }
    // Budget floor is applied via toNumber(fallback on <=0); 500 keeps both short messages.
    expect(out.messages.length).toBeGreaterThan(0)
    const tiny = executeTool(CTX(), 'get_trace', { traceId: 't-ok', maxChars: 10 }) as {
      messages: string[]
    }
    expect(tiny.messages[tiny.messages.length - 1]).toMatch(/more messages omitted/)
  })

  it('search_traces finds message content', () => {
    const out = executeTool(CTX(), 'search_traces', { q: 'reward hacking' }) as {
      hits: Array<{ traceId: string }>
    }
    expect(out.hits.map((h) => h.traceId)).toContain('t-ok')
  })

  it('unknown tools return an error payload instead of throwing', () => {
    expect(executeTool(CTX(), 'nope', {})).toEqual({ error: 'unknown tool: nope' })
  })
})

describe('runAnalysis', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws a 503 AnalysisError without ANTHROPIC_API_KEY', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const create: CreateMock = vi.fn()
    await expect(runAnalysis(CTX(), 'why?', fakeClient(create))).rejects.toMatchObject({
      status: 503,
    })
    await expect(runAnalysis(CTX(), 'why?', fakeClient(create))).rejects.toThrow(AnalysisError)
    expect(create).not.toHaveBeenCalled()
  })

  it('dispatches tool calls, feeds results back, and returns the emit_report payload', async () => {
    const create: CreateMock = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse('list_traces', { filters: 'status.eq.failed' }))
      .mockResolvedValueOnce(
        toolUseResponse('emit_report', {
          summary: 'One failed trace.',
          findings: [{ traceId: 't-fail', note: 'timed out' }],
          suggestedFilter: 'status.eq.failed',
          confidence: 'high',
        }),
      )
    const result = await runAnalysis(CTX(), 'find failures', fakeClient(create))

    expect(result.report).toEqual({
      summary: 'One failed trace.',
      findings: [{ traceId: 't-fail', note: 'timed out' }],
      suggestedFilter: 'status.eq.failed',
      confidence: 'high',
    })
    expect(result.steps.map((s) => s.tool)).toEqual(['list_traces', 'emit_report'])

    // Second request carries the assistant turn plus the tool_result with real data.
    const [params] = create.mock.calls[1]
    expect(params.messages).toHaveLength(3)
    expect(params.messages[1].role).toBe('assistant')
    const toolResultTurn = params.messages[2]
    expect(toolResultTurn.role).toBe('user')
    const blocks = toolResultTurn.content as Array<{ tool_use_id: string; content: string }>
    expect(blocks[0].tool_use_id).toBe('tu-1')
    expect(blocks[0].content).toContain('t-fail')
    expect(params.tool_choice).toEqual({ type: 'auto' })
    expect(params.model).toBe('claude-sonnet-5')
    expect(String(params.system)).toContain('emit_report')
    expect(String(params.system)).toContain('score (number)')
  })

  it('stops at the 8-turn cap and wraps the last text as the summary', async () => {
    const create: CreateMock = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'still digging' },
        { type: 'tool_use', id: 'tu-x', name: 'aggregate', input: { groupBy: 'status' } },
      ],
    })
    const result = await runAnalysis(CTX(), 'loop forever', fakeClient(create))
    expect(create).toHaveBeenCalledTimes(8)
    expect(result.report.summary).toBe('still digging')
    expect(result.report.findings).toEqual([])
    expect(result.steps).toHaveLength(8)
  })

  it('wraps a plain-text answer (no emit_report) as the summary', async () => {
    const create: CreateMock = vi.fn().mockResolvedValue(textResponse('Plain answer.'))
    const result = await runAnalysis(CTX(), 'q', fakeClient(create))
    expect(create).toHaveBeenCalledTimes(1)
    expect(result.report.summary).toBe('Plain answer.')
    expect(result.steps).toEqual([])
  })

  it('falls back gracefully when emit_report input fails validation', async () => {
    const create: CreateMock = vi.fn().mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'partial notes' },
        { type: 'tool_use', id: 'tu-r', name: 'emit_report', input: { findings: 'oops' } },
      ],
    })
    const result = await runAnalysis(CTX(), 'q', fakeClient(create))
    expect(result.report.summary).toBe('partial notes')
    expect(result.report.findings).toEqual([])
  })

  it('maps upstream failures to a 502 AnalysisError', async () => {
    const create: CreateMock = vi.fn().mockRejectedValue(new Error('overloaded'))
    await expect(runAnalysis(CTX(), 'q', fakeClient(create))).rejects.toMatchObject({
      status: 502,
      message: 'overloaded',
    })
  })
})
