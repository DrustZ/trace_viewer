import { describe, expect, it } from 'vitest'
import type { Message, TraceMeta } from '../schema/types'
import { computeStats, estimateTokens, finalizeTrace } from './computeStats'

const meta: TraceMeta = {
  traceId: 't-test-1',
  instanceId: 'inst-1',
  component: 'test/component',
  status: 'completed',
  timestamp: '2026-03-01T00:00:00.000Z',
  checkpointStep: 50,
  split: 'train',
  sourceFormat: 'native',
}

const msg = (partial: Partial<Message>): Message => ({
  id: '',
  role: 'user',
  content: '',
  ...partial,
})

describe('computeStats', () => {
  it('handles an empty trace', () => {
    const stats = computeStats(meta, [])
    expect(stats.turns).toBe(0)
    expect(stats.totalTokens).toBe(0)
    expect(stats.thinkingPortion).toBe(0)
    expect(stats.score).toBeNull()
    expect(stats.hasError).toBe(false)
  })

  it('counts turns as contiguous assistant blocks and splits token classes', () => {
    const messages: Message[] = [
      msg({ role: 'user', content: 'x'.repeat(40) }), // 10 input tokens
      msg({ role: 'assistant', channel: 'analysis', content: 'y'.repeat(80) }), // 20 thinking
      msg({ role: 'assistant', channel: 'final', content: 'z'.repeat(40) }), // 10 output
      msg({ role: 'user', content: 'x'.repeat(4) }), // 1 input
      msg({ role: 'assistant', channel: 'final', content: 'z'.repeat(4) }), // 1 output
    ]
    const stats = computeStats(meta, messages)
    expect(stats.turns).toBe(2)
    expect(stats.inputTokens).toBe(11)
    expect(stats.outputTokens).toBe(31)
    expect(stats.thinkingTokens).toBe(20)
    expect(stats.thinkingPortion).toBeCloseTo(20 / 31)
  })

  it('tracks tool uses, sandbox executions and errors', () => {
    const messages: Message[] = [
      msg({
        role: 'assistant',
        channel: 'commentary',
        content: '',
        toolCalls: [
          { id: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' },
          { id: 'c2', name: 'search', arguments: '{"q":"docs"}' },
        ],
      }),
      msg({ role: 'tool', content: 'ok', toolResult: { toolCallId: 'c1', isError: false } }),
      msg({ role: 'tool', content: 'boom', toolResult: { toolCallId: 'c2', isError: true } }),
    ]
    const stats = computeStats(meta, messages)
    expect(stats.toolUses).toBe(2)
    expect(stats.sandboxExecutions).toBe(1) // bash only; search is not sandbox-class
    expect(stats.hasError).toBe(true)
  })

  it('prefers timestamps for duration and falls back to summed durations', () => {
    const stamped: Message[] = [
      msg({ role: 'user', content: 'a', timestamp: '2026-03-01T00:00:00.000Z' }),
      msg({
        role: 'assistant',
        content: 'b',
        timestamp: '2026-03-01T00:00:01.000Z',
        durationMs: 500,
      }),
    ]
    expect(computeStats(meta, stamped).durationMs).toBe(1500)
    const unstamped: Message[] = [msg({ role: 'assistant', content: 'b', durationMs: 250 })]
    expect(computeStats(meta, unstamped).durationMs).toBe(250)
  })

  it('lets overrides win and recomputes thinkingPortion from overridden tokens', () => {
    const stats = computeStats(meta, [], {
      score: 1,
      truncated: true,
      outputTokens: 100,
      thinkingTokens: 40,
    })
    expect(stats.score).toBe(1)
    expect(stats.truncated).toBe(true)
    expect(stats.thinkingPortion).toBeCloseTo(0.4)
  })
})

describe('finalizeTrace', () => {
  it('assigns ids and step indices', () => {
    const trace = finalizeTrace(meta, [
      msg({ role: 'user', content: 'q' }),
      msg({ role: 'assistant', channel: 'analysis', content: 'think' }),
      msg({
        role: 'assistant',
        channel: 'commentary',
        content: '',
        toolCalls: [{ id: 'c1', name: 'bash', arguments: '{}' }],
      }),
      msg({ role: 'tool', content: 'out', toolResult: { toolCallId: 'c1', isError: false } }),
      msg({ role: 'assistant', channel: 'final', content: 'done' }),
    ])
    expect(trace.messages.map((m) => m.id)).toEqual(['m-0', 'm-1', 'm-2', 'm-3', 'm-4'])
    expect(trace.messages.map((m) => m.stepIndex)).toEqual([undefined, 1, 1, 1, 2])
    expect(trace.stats.turns).toBe(2)
  })
})

describe('estimateTokens', () => {
  it('is ceil(len/4) with zero for empty', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})
