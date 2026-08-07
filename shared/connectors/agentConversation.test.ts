import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentConversationConnector } from './agentConversation'

const ctx = {
  sourcePath: '/data/0054a6c4-4fdc-47c3-b885-f8ddb282aab1.json',
  fallbackTimestamp: '2026-01-02T03:04:05.000Z',
}

const sample = readFileSync(join(process.cwd(), 'examples/agent-conversation-sample.json'), 'utf8')

/** The sample cut mid-way through a message object (as a partial write would). */
const truncatedSample = sample.slice(0, sample.indexOf('"tool_name": "get_order_details"'))

describe('agentConversationConnector.detect', () => {
  it('claims a {conversation: [{role, agent_type}]} object', () => {
    expect(agentConversationConnector.detect(sample)).toBe(true)
  })

  it('claims a truncated (unparseable) conversation file via the cheap sniff', () => {
    expect(JSON.parse.bind(JSON, truncatedSample)).toThrow()
    expect(agentConversationConnector.detect(truncatedSample)).toBe(true)
  })

  it('declines other formats and junk', () => {
    expect(
      agentConversationConnector.detect(JSON.stringify({ messages: [{ role: 'user' }] })),
    ).toBe(false)
    expect(
      agentConversationConnector.detect(
        JSON.stringify({ conversation: [{ role: 'user', content: 'no agent_type field' }] }),
      ),
    ).toBe(false)
    expect(agentConversationConnector.detect(JSON.stringify({ conversation: [] }))).toBe(false)
    expect(agentConversationConnector.detect('<|start|>user<|message|>hi<|end|>')).toBe(false)
    expect(agentConversationConnector.detect('nope')).toBe(false)
  })
})

describe('agentConversationConnector.parse', () => {
  it('maps roles, channels, agent metadata and unix timestamps', () => {
    const result = agentConversationConnector.parse(sample, ctx)
    expect(result.warnings).toEqual([])
    const trace = result.traces[0]
    expect(trace.warnings).toEqual([])
    expect(trace.messages.map((m) => [m.role, m.channel ?? null])).toEqual([
      ['user', null],
      ['assistant', 'commentary'],
      ['tool', null],
      ['assistant', 'commentary'],
      ['tool', null],
      ['assistant', 'final'],
      ['assistant', 'final'],
      ['user', null],
    ])
    // Unix float seconds → ISO 8601.
    expect(trace.messages[0].timestamp).toBe('2026-01-27T09:44:00.394Z')
    // agent_type and the higher-precision source timestamp are retained in metadata.
    expect(trace.messages[1].metadata).toEqual({
      agentType: 'beta',
      sourceTimestampSeconds: 1769507052.11002,
    })
    expect(trace.messages[6].metadata).toEqual({
      agentType: 'human',
      sourceTimestampSeconds: 1769507102.87345,
    })
    expect(trace.messages[0].metadata).toEqual({
      sourceTimestampSeconds: 1769507040.394264,
    })
  })

  it('serializes object arguments and passes them through as parsedArguments', () => {
    const trace = agentConversationConnector.parse(sample, ctx).traces[0]
    const call = trace.messages[1].toolCalls?.[0]
    expect(call).toMatchObject({
      id: 'call_example001',
      name: 'get_order_details',
      arguments: '{"order_id":"order_001"}',
      parsedArguments: { order_id: 'order_001' },
    })
  })

  it('links tool results to calls and flags "Error: ..." contents', () => {
    const trace = agentConversationConnector.parse(sample, ctx).traces[0]
    expect(trace.messages[2].toolResult).toEqual({
      toolCallId: 'call_example001',
      isError: false,
    })
    expect(trace.messages[2].metadata).toMatchObject({
      toolName: 'get_order_details',
      toolCallMatch: 'exact',
      sourceTimestampSeconds: 1769507052.110412,
    })
    expect(trace.messages[4].toolResult).toEqual({
      toolCallId: 'call_example002',
      isError: true,
    })
  })

  it('derives meta from the file: id from the name, component from the first agent', () => {
    const trace = agentConversationConnector.parse(sample, ctx).traces[0]
    expect(trace.meta).toMatchObject({
      traceId: '0054a6c4-4fdc-47c3-b885-f8ddb282aab1',
      instanceId: '0054a6c4-4fdc-47c3-b885-f8ddb282aab1',
      component: 'conversations/beta',
      status: 'unknown',
      timestamp: '2026-01-27T09:44:00.394Z',
      checkpointStep: 0,
      split: 'unknown',
      sourceFormat: 'agent-conversation',
      dataLocation: ctx.sourcePath,
      extra: {
        agents: ['beta', 'human'],
        escalated: true,
        lifecycle: { state: 'unknown', provenance: 'not_provided_by_source' },
        outcome: {
          state: 'unknown',
          provenance: 'not_provided_by_source',
          observations: ['tool_error'],
        },
        normalization: {
          status: 'source_missing',
          split: 'source_missing',
          checkpointStep: 'default',
        },
      },
    })
    expect(trace.meta.extra?.dataQuality).toEqual({
      timestampRegressions: 0,
      repairedToolResultLinks: 0,
      unmatchedToolResults: 0,
    })
    expect(trace.statsOverrides).toBeUndefined()
  })

  it('falls back to a content-hash trace id without a sourcePath', () => {
    const trace = agentConversationConnector.parse(sample, {}).traces[0]
    expect(trace.meta.traceId).toMatch(/^conv-[0-9a-f]{8}$/)
    expect(trace.meta.timestamp).toBe('2026-01-27T09:44:00.394Z')
  })

  it('salvages a truncated file: keeps complete messages, flags truncated, warns', () => {
    const result = agentConversationConnector.parse(truncatedSample, ctx)
    const trace = result.traces[0]
    // The cut is inside message 3 (the first tool result) — the two before survive.
    expect(trace.messages).toHaveLength(2)
    expect(trace.messages[1].toolCalls?.[0]?.name).toBe('get_order_details')
    expect(trace.statsOverrides).toEqual({ truncated: true, hasError: true })
    expect(trace.warnings.some((w) => w.includes('truncated'))).toBe(true)
  })

  it('repairs mismatched ids when raw tool_name identifies one unmatched call', () => {
    const input = JSON.stringify({
      conversation: [
        {
          role: 'assistant',
          agent_type: 'beta',
          tool_calls: [
            { id: 'call-search', name: 'search', arguments: {} },
            { id: 'call-bash', name: 'bash', arguments: {} },
          ],
        },
        {
          role: 'tool',
          agent_type: null,
          content: 'ok',
          tool_call_id: 'wrong-1',
          tool_name: 'bash',
        },
        {
          role: 'tool',
          agent_type: null,
          content: 'found',
          tool_call_id: 'wrong-2',
          tool_name: 'search',
        },
      ],
    })
    const trace = agentConversationConnector.parse(input, ctx).traces[0]
    expect(trace.messages[1].toolResult?.toolCallId).toBe('call-bash')
    expect(trace.messages[1].metadata).toMatchObject({
      toolName: 'bash',
      toolCallMatch: 'tool-name',
      sourceToolCallId: 'wrong-1',
    })
    expect(trace.messages[2].toolResult?.toolCallId).toBe('call-search')
    expect(trace.meta.extra?.dataQuality).toMatchObject({ repairedToolResultLinks: 2 })
  })

  it('does not invent a link when id and name cannot identify a call', () => {
    const input = JSON.stringify({
      conversation: [
        {
          role: 'assistant',
          agent_type: 'beta',
          tool_calls: [{ id: 'call-search', name: 'search', arguments: {} }],
        },
        {
          role: 'tool',
          agent_type: null,
          content: 'opaque output',
          tool_call_id: 'missing-call',
          tool_name: 'unseen_tool',
        },
      ],
    })
    const trace = agentConversationConnector.parse(input, ctx).traces[0]
    expect(trace.messages[1].toolResult?.toolCallId).toBe('')
    expect(trace.messages[1].metadata).toMatchObject({
      toolName: 'unseen_tool',
      toolCallMatch: 'unmatched',
      sourceToolCallId: 'missing-call',
    })
    expect(trace.meta.extra?.dataQuality).toMatchObject({ unmatchedToolResults: 1 })
    expect(trace.warnings.some((warning) => warning.includes('could not be safely linked'))).toBe(
      true,
    )
  })

  it('leaves a name-only result unlinked when multiple calls share that name', () => {
    const input = JSON.stringify({
      conversation: [
        {
          role: 'assistant',
          agent_type: 'beta',
          tool_calls: [
            { id: 'call-search-1', name: 'search', arguments: { q: 'one' } },
            { id: 'call-search-2', name: 'search', arguments: { q: 'two' } },
          ],
        },
        {
          role: 'tool',
          agent_type: null,
          content: 'ambiguous output',
          tool_call_id: 'missing-call',
          tool_name: 'search',
        },
      ],
    })
    const trace = agentConversationConnector.parse(input, ctx).traces[0]
    expect(trace.messages[1].toolResult?.toolCallId).toBe('')
    expect(trace.messages[1].metadata).toMatchObject({
      toolName: 'search',
      toolCallMatch: 'unmatched',
      sourceToolCallId: 'missing-call',
    })
    expect(trace.meta.extra?.dataQuality).toMatchObject({
      repairedToolResultLinks: 0,
      unmatchedToolResults: 1,
    })
  })

  it('recognizes an exact source id even when its call appears later in source order', () => {
    const input = JSON.stringify({
      conversation: [
        {
          role: 'tool',
          agent_type: null,
          content: 'early flush',
          tool_call_id: 'call-later',
          tool_name: 'search',
        },
        {
          role: 'assistant',
          agent_type: 'beta',
          tool_calls: [{ id: 'call-later', name: 'search', arguments: {} }],
        },
      ],
    })
    const trace = agentConversationConnector.parse(input, ctx).traces[0]
    expect(trace.messages[0].toolResult?.toolCallId).toBe('call-later')
    expect(trace.messages[0].metadata).toMatchObject({ toolCallMatch: 'exact' })
  })

  it('sorts for display while preserving raw indices and reports timestamp regressions', () => {
    const input = JSON.stringify({
      conversation: [
        { role: 'user', agent_type: 'user', content: 'first', timestamp: 20 },
        { role: 'assistant', agent_type: 'beta', content: 'second', timestamp: 10 },
      ],
    })
    const trace = agentConversationConnector.parse(input, ctx).traces[0]
    expect(trace.messages.map((message) => message.content)).toEqual(['second', 'first'])
    expect(trace.messages.map((message) => [message.rawIndex, message.chronologicalIndex])).toEqual(
      [
        [1, 0],
        [0, 1],
      ],
    )
    expect(trace.meta.extra?.dataQuality).toMatchObject({ timestampRegressions: 1 })
    expect(trace.warnings.some((warning) => warning.includes('timestamp regression'))).toBe(true)
  })

  it('degrades to warnings on unsalvageable and wrong-shape input', () => {
    expect(agentConversationConnector.parse('{"conversation": [', ctx).traces).toEqual([])
    expect(agentConversationConnector.parse('not json at all', ctx).traces).toEqual([])
    const wrongShape = agentConversationConnector.parse(JSON.stringify({ conversation: [] }), ctx)
    expect(wrongShape.traces).toEqual([])
    expect(wrongShape.warnings.length).toBeGreaterThan(0)
  })
})
