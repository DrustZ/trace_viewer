import type { Message, Trace, TraceStats } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import { OUTPUT_TOO_LONG_CHARS, unitFlags } from './unitFlags'
import { buildUnits } from './unitize'

let nextId = 0
function msg(over: Partial<Message>): Message {
  nextId += 1
  return { id: `m-${nextId}`, role: 'user', content: '', ...over }
}

function makeTrace(messages: Message[], statsOver?: Partial<TraceStats>): Trace {
  return {
    meta: {
      traceId: 't-1',
      instanceId: 'i-1',
      component: 'test',
      status: 'completed',
      timestamp: '2026-01-01T00:00:00.000Z',
      checkpointStep: 0,
      split: 'train',
      sourceFormat: 'native',
    },
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
      ...statsOver,
    },
    messages,
  }
}

/** Units + trace for a call → failed result → repeat-call shape (retry fixture). */
function retryFixture(secondCallName: string, firstResultIsError: boolean) {
  const messages = [
    msg({
      role: 'assistant',
      channel: 'commentary',
      stepIndex: 1,
      toolCalls: [{ id: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }],
    }),
    msg({
      role: 'tool',
      stepIndex: 1,
      content: 'failed',
      toolResult: { toolCallId: 'c1', isError: firstResultIsError },
    }),
    msg({
      role: 'assistant',
      channel: 'commentary',
      stepIndex: 2,
      toolCalls: [{ id: 'c2', name: secondCallName, arguments: '{"cmd":"ls"}' }],
    }),
  ]
  const trace = makeTrace(messages)
  return { trace, units: buildUnits(messages) }
}

describe('unitFlags', () => {
  it("flags 'output too long' for tool results over the char cap, not at it", () => {
    const long = msg({ role: 'tool', content: 'x'.repeat(OUTPUT_TOO_LONG_CHARS + 1) })
    const atCap = msg({ role: 'tool', content: 'x'.repeat(OUTPUT_TOO_LONG_CHARS) })
    const trace = makeTrace([long, atCap])
    const units = buildUnits(trace.messages)
    expect(unitFlags(units[0], trace)).toContain('output too long')
    expect(unitFlags(units[1], trace)).not.toContain('output too long')
  })

  it("flags 'timeout' when a tool result's content contains TIMEOUT", () => {
    const timedOut = msg({ role: 'tool', content: 'Command TIMEOUT after 30s' })
    const ok = msg({ role: 'tool', content: 'exit 0' })
    const user = msg({ role: 'user', content: 'the word TIMEOUT in a user message' })
    const trace = makeTrace([timedOut, ok, user])
    const units = buildUnits(trace.messages)
    expect(unitFlags(units[0], trace)).toContain('timeout')
    expect(unitFlags(units[1], trace)).not.toContain('timeout')
    // only tool results are inspected
    expect(unitFlags(units[2], trace)).toEqual([])
  })

  it("flags 'malformed JSON' when any tool call in a step has a parseError", () => {
    const bad = msg({
      role: 'assistant',
      channel: 'commentary',
      stepIndex: 1,
      toolCalls: [
        { id: 'c1', name: 'bash', arguments: '{"cmd":', parseError: 'Unexpected end of input' },
      ],
    })
    const good = msg({
      role: 'assistant',
      channel: 'commentary',
      stepIndex: 2,
      toolCalls: [{ id: 'c2', name: 'bash', arguments: '{}' }],
    })
    const trace = makeTrace([bad, msg({ role: 'user', content: 'x' }), good])
    const units = buildUnits(trace.messages)
    expect(unitFlags(units[0], trace)).toContain('malformed JSON')
    expect(unitFlags(units[2], trace)).not.toContain('malformed JSON')
  })

  it("flags 'retry' when a step repeats the immediately-previous failed call", () => {
    const { trace, units } = retryFixture('bash', true)
    expect(unitFlags(units[0], trace)).not.toContain('retry')
    expect(unitFlags(units[2], trace)).toContain('retry')
  })

  it("does not flag 'retry' when the previous result succeeded or the tool differs", () => {
    const succeeded = retryFixture('bash', false)
    expect(unitFlags(succeeded.units[2], succeeded.trace)).not.toContain('retry')
    const differentTool = retryFixture('search', true)
    expect(unitFlags(differentTool.units[2], differentTool.trace)).not.toContain('retry')
  })

  it("flags 'truncated' only on the last assistant unit of a truncated trace", () => {
    const messages = [
      msg({ role: 'assistant', channel: 'final', stepIndex: 1, content: 'first' }),
      msg({ role: 'user', content: 'go on' }),
      msg({ role: 'assistant', channel: 'final', stepIndex: 2, content: 'last' }),
    ]
    const truncated = makeTrace(messages, { truncated: true })
    const units = buildUnits(messages)
    expect(unitFlags(units[0], truncated)).not.toContain('truncated')
    expect(unitFlags(units[2], truncated)).toContain('truncated')
    const clean = makeTrace(messages, { truncated: false })
    expect(unitFlags(units[2], clean)).not.toContain('truncated')
  })

  it('returns no flags for ordinary units', () => {
    const messages = [
      msg({ role: 'system', content: 'sys' }),
      msg({ role: 'user', content: 'hi' }),
      msg({ role: 'assistant', channel: 'final', stepIndex: 1, content: 'answer' }),
    ]
    const trace = makeTrace(messages)
    for (const unit of buildUnits(messages)) {
      expect(unitFlags(unit, trace)).toEqual([])
    }
  })
})
