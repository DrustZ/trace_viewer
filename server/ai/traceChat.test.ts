import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { Message, Trace } from '../../shared/schema/types'
import {
  buildTraceContext,
  type ChatMessage,
  CONTEXT_CHAR_LIMIT,
  MESSAGE_CHAR_LIMIT,
  type TraceChatClient,
  TraceChatError,
  traceChat,
} from './traceChat'

type CreateMock = Mock<TraceChatClient['messages']['create']>

function fakeClient(create: CreateMock): TraceChatClient {
  return { messages: { create } }
}

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] }
}

function makeTrace(messages: Message[]): Trace {
  return {
    meta: {
      traceId: 'lc-i01-s100-r01',
      instanceId: 'lc-i01',
      component: 'code/leetcode',
      status: 'completed',
      timestamp: '2026-03-01T00:00:00.000Z',
      checkpointStep: 100,
      split: 'train',
      sourceFormat: 'native',
      rewardDetails: { tests_passed: 3, tests_total: 5 },
      extra: { verdict: 'partial' },
    },
    stats: {
      score: 0.6,
      hasError: false,
      truncated: false,
      inputTokens: 1000,
      outputTokens: 500,
      thinkingTokens: 100,
      totalTokens: 1500,
      turns: 2,
      toolUses: 1,
      sandboxExecutions: 0,
      thinkingPortion: 0.2,
    },
    messages,
  }
}

const BASE_MESSAGES: Message[] = [
  { id: 'm-0', role: 'user', content: 'Solve the coding task' },
  {
    id: 'm-1',
    role: 'assistant',
    channel: 'commentary',
    content: 'Running the tests',
    toolCalls: [{ id: 't-1', name: 'run_tests', arguments: '{}' }],
  },
  { id: 'm-2', role: 'assistant', channel: 'final', content: 'Use two pointers' },
]

const HISTORY: ChatMessage[] = [{ role: 'user', content: 'Why did this trace only score 0.6?' }]

describe('buildTraceContext', () => {
  it('includes meta, stats, reward details, and numbered messages with role/channel', () => {
    const ctxText = buildTraceContext(makeTrace(BASE_MESSAGES))
    expect(ctxText).toContain('Trace lc-i01-s100-r01')
    expect(ctxText).toContain('score=0.6')
    expect(ctxText).toContain('Reward details: {"tests_passed":3,"tests_total":5}')
    expect(ctxText).toContain('Extra verdict data: {"verdict":"partial"}')
    expect(ctxText).toContain('#1 user: Solve the coding task')
    expect(ctxText).toContain('#2 assistant/commentary [tool calls: run_tests]: Running the tests')
    expect(ctxText).toContain('#3 assistant/final: Use two pointers')
  })

  it('clamps each message content to MESSAGE_CHAR_LIMIT with a truncation marker', () => {
    const long = 'x'.repeat(MESSAGE_CHAR_LIMIT + 500)
    const ctxText = buildTraceContext(
      makeTrace([{ id: 'm-0', role: 'user', content: long }, ...BASE_MESSAGES.slice(1)]),
    )
    expect(ctxText).toContain(`${'x'.repeat(MESSAGE_CHAR_LIMIT)}[…truncated]`)
    expect(ctxText).not.toContain('x'.repeat(MESSAGE_CHAR_LIMIT + 1))
  })

  it('clamps the total context to ~CONTEXT_CHAR_LIMIT and reports omitted messages', () => {
    const many: Message[] = Array.from({ length: 100 }, (_, i) => ({
      id: `m-${i}`,
      role: 'assistant' as const,
      content: 'y'.repeat(1000),
    }))
    const ctxText = buildTraceContext(makeTrace(many))
    expect(ctxText.length).toBeLessThanOrEqual(CONTEXT_CHAR_LIMIT + 100)
    expect(ctxText).toMatch(/\[…truncated\] \(\d+ more messages omitted\)/)
    // Messages past the clamp never appear.
    expect(ctxText).not.toContain('#100 ')
  })
})

describe('traceChat', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws a 503 TraceChatError without ANTHROPIC_API_KEY', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const create: CreateMock = vi.fn().mockResolvedValue(textResponse('never used'))

    await expect(traceChat(makeTrace(BASE_MESSAGES), HISTORY, fakeClient(create))).rejects.toThrow(
      TraceChatError,
    )
    await expect(
      traceChat(makeTrace(BASE_MESSAGES), HISTORY, fakeClient(create)),
    ).rejects.toMatchObject({ status: 503, message: 'AI chat requires ANTHROPIC_API_KEY' })
    expect(create).not.toHaveBeenCalled()
  })

  it('returns the model text on the happy path with the expected request shape', async () => {
    const create: CreateMock = vi
      .fn()
      .mockResolvedValue(textResponse('It failed 2 of 5 tests — see #2.'))
    const result = await traceChat(makeTrace(BASE_MESSAGES), HISTORY, fakeClient(create))

    expect(result).toEqual({ reply: 'It failed 2 of 5 tests — see #2.' })
    expect(create).toHaveBeenCalledTimes(1)
    const [params, options] = create.mock.calls[0]
    expect(params.model).toBe('claude-sonnet-5')
    expect(params.max_tokens).toBe(1200)
    expect(params.messages).toEqual(HISTORY)
    expect(String(params.system)).toContain('trace-debugging assistant')
    expect(String(params.system)).toContain('#1 user: Solve the coding task')
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends only the last 20 history messages', async () => {
    const create: CreateMock = vi.fn().mockResolvedValue(textResponse('ok'))
    const history: ChatMessage[] = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `msg ${i}`,
    }))
    await traceChat(makeTrace(BASE_MESSAGES), history, fakeClient(create))

    const [params] = create.mock.calls[0]
    expect(params.messages).toHaveLength(20)
    expect(params.messages[0]).toEqual({ role: 'assistant', content: 'msg 5' })
  })

  it('maps upstream failures to a 502 TraceChatError', async () => {
    const create: CreateMock = vi.fn().mockRejectedValue(new Error('overloaded'))
    await expect(
      traceChat(makeTrace(BASE_MESSAGES), HISTORY, fakeClient(create)),
    ).rejects.toMatchObject({ status: 502, message: 'overloaded' })
  })

  it('maps an empty model reply to a 502 TraceChatError', async () => {
    const create: CreateMock = vi.fn().mockResolvedValue({ content: [] })
    await expect(
      traceChat(makeTrace(BASE_MESSAGES), HISTORY, fakeClient(create)),
    ).rejects.toMatchObject({ status: 502 })
  })
})
