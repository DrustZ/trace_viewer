import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { Message, Trace } from '../../shared/schema/types'
import {
  buildReplayPrefix,
  type PlaygroundClient,
  PlaygroundError,
  PREFIX_CHAR_LIMIT,
  runPlayground,
} from './playground'

type CreateMock = Mock<PlaygroundClient['messages']['create']>

function fakeClient(create: CreateMock): PlaygroundClient {
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
  { id: 'm-0', role: 'system', content: 'You are a coding agent.' },
  { id: 'm-1', role: 'user', content: 'Solve the coding task' },
  {
    id: 'm-2',
    role: 'assistant',
    channel: 'commentary',
    content: 'Running the tests',
    toolCalls: [{ id: 't-1', name: 'run_tests', arguments: '{}' }],
  },
  {
    id: 'm-3',
    role: 'tool',
    content: '3/5 passed',
    toolResult: { toolCallId: 't-1', isError: false },
  },
  { id: 'm-4', role: 'assistant', channel: 'final', content: 'Use two pointers' },
]

describe('buildReplayPrefix', () => {
  it('defaults to everything before the first assistant step', () => {
    const prefix = buildReplayPrefix(makeTrace(BASE_MESSAGES), {})
    expect(prefix.system).toBe('You are a coding agent.')
    expect(prefix.messages).toEqual([{ role: 'user', content: 'Solve the coding task' }])
  })

  it('cuts at uptoMessageId inclusive, mapping tool results into user turns', () => {
    const prefix = buildReplayPrefix(makeTrace(BASE_MESSAGES), { uptoMessageId: 'm-3' })
    expect(prefix.messages).toEqual([
      { role: 'user', content: 'Solve the coding task' },
      { role: 'assistant', content: 'Running the tests\n[tool call run_tests: {}]' },
      { role: 'user', content: '[tool result] 3/5 passed' },
    ])
    // The final assistant answer (m-4) is excluded.
    expect(JSON.stringify(prefix.messages)).not.toContain('Use two pointers')
  })

  it('throws a 400 PlaygroundError for an unknown uptoMessageId', () => {
    expect(() => buildReplayPrefix(makeTrace(BASE_MESSAGES), { uptoMessageId: 'nope' })).toThrow(
      PlaygroundError,
    )
    try {
      buildReplayPrefix(makeTrace(BASE_MESSAGES), { uptoMessageId: 'nope' })
    } catch (err) {
      expect((err as PlaygroundError).status).toBe(400)
    }
  })

  it('swaps userOverride in for the last user message', () => {
    const prefix = buildReplayPrefix(makeTrace(BASE_MESSAGES), {
      uptoMessageId: 'm-3',
      userOverride: 'Try a different approach',
    })
    expect(prefix.messages[prefix.messages.length - 1]).toEqual({
      role: 'user',
      content: 'Try a different approach',
    })
    expect(JSON.stringify(prefix.messages)).not.toContain('tool result')
    // Earlier turns are untouched.
    expect(prefix.messages[0]).toEqual({ role: 'user', content: 'Solve the coding task' })
  })

  it('merges consecutive same-role turns', () => {
    const prefix = buildReplayPrefix(
      makeTrace([
        { id: 'm-0', role: 'user', content: 'part one' },
        { id: 'm-1', role: 'user', content: 'part two' },
        { id: 'm-2', role: 'assistant', content: 'answer' },
      ]),
      {},
    )
    expect(prefix.messages).toEqual([{ role: 'user', content: 'part one\n\npart two' }])
  })

  it('clamps the total prefix to ~PREFIX_CHAR_LIMIT chars, truncating oldest turns first', () => {
    const prefix = buildReplayPrefix(
      makeTrace([
        { id: 'm-0', role: 'user', content: 'x'.repeat(30_000) },
        { id: 'm-1', role: 'assistant', content: 'a'.repeat(5_000) },
        { id: 'm-2', role: 'user', content: 'final question' },
      ]),
      { uptoMessageId: 'm-2' },
    )
    const total = prefix.system.length + prefix.messages.reduce((s, m) => s + m.content.length, 0)
    expect(total).toBeLessThanOrEqual(PREFIX_CHAR_LIMIT + 100)
    // The oldest turn is truncated; newer turns survive intact.
    expect(prefix.messages[0].content).toContain('[…truncated]')
    expect(prefix.messages[1].content).toBe('a'.repeat(5_000))
    expect(prefix.messages[2].content).toBe('final question')
  })
})

describe('runPlayground', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws a 503 PlaygroundError without ANTHROPIC_API_KEY', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const create: CreateMock = vi.fn().mockResolvedValue(textResponse('never used'))
    await expect(
      runPlayground(makeTrace(BASE_MESSAGES), {}, fakeClient(create)),
    ).rejects.toMatchObject({ status: 503 })
    expect(create).not.toHaveBeenCalled()
  })

  it('calls the model with the simulation preamble and returns reply/promptChars/model', async () => {
    const create: CreateMock = vi.fn().mockResolvedValue(textResponse('Simulated answer'))
    const result = await runPlayground(
      makeTrace(BASE_MESSAGES),
      { checkpointStep: 250 },
      fakeClient(create),
    )

    expect(result.reply).toBe('Simulated answer')
    expect(result.model).toBe('claude-sonnet-5')
    expect(result.promptChars).toBeGreaterThan(0)
    const [params, options] = create.mock.calls[0]
    expect(params.max_tokens).toBe(1500)
    expect(String(params.system)).toContain('simulating policy checkpoint step 250')
    expect(String(params.system)).toContain('You are a coding agent.')
    expect(params.messages).toEqual([{ role: 'user', content: 'Solve the coding task' }])
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it("defaults the preamble step to the trace's checkpoint step", async () => {
    const create: CreateMock = vi.fn().mockResolvedValue(textResponse('ok'))
    await runPlayground(makeTrace(BASE_MESSAGES), {}, fakeClient(create))
    expect(String(create.mock.calls[0][0].system)).toContain(
      'simulating policy checkpoint step 100',
    )
  })

  it('does not present a connector default as a recorded policy checkpoint', async () => {
    const trace = makeTrace(BASE_MESSAGES)
    trace.meta.checkpointStep = 0
    trace.meta.extra = { normalization: { checkpointStep: 'default' } }
    const create: CreateMock = vi.fn().mockResolvedValue(textResponse('ok'))

    await runPlayground(trace, {}, fakeClient(create))

    const system = String(create.mock.calls[0][0].system)
    expect(system).toContain('does not record a policy checkpoint')
    expect(system).not.toContain('checkpoint step 0')
  })

  it('labels a user override as hypothetical when the source checkpoint is unavailable', async () => {
    const trace = makeTrace(BASE_MESSAGES)
    trace.meta.checkpointStep = 0
    trace.meta.extra = { normalization: { checkpointStep: 'default' } }
    const create: CreateMock = vi.fn().mockResolvedValue(textResponse('ok'))

    await runPlayground(trace, { checkpointStep: 250 }, fakeClient(create))

    const system = String(create.mock.calls[0][0].system)
    expect(system).toContain('hypothetical task-agent checkpoint labeled step 250')
    expect(system).toContain('user-specified, not recorded')
  })

  it('maps upstream failures to a 502 PlaygroundError', async () => {
    const create: CreateMock = vi.fn().mockRejectedValue(new Error('overloaded'))
    await expect(
      runPlayground(makeTrace(BASE_MESSAGES), {}, fakeClient(create)),
    ).rejects.toMatchObject({ status: 502, message: 'overloaded' })
  })
})
