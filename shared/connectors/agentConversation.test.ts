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
    // agent_type lands in message metadata on assistant messages.
    expect(trace.messages[1].metadata).toEqual({ agentType: 'beta' })
    expect(trace.messages[6].metadata).toEqual({ agentType: 'human' })
    expect(trace.messages[0].metadata).toBeUndefined()
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
      status: 'completed',
      timestamp: '2026-01-27T09:44:00.394Z',
      sourceFormat: 'agent-conversation',
      dataLocation: ctx.sourcePath,
      extra: { agents: ['beta', 'human'], escalated: true },
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
    expect(trace.statsOverrides).toEqual({ truncated: true })
    expect(trace.warnings.some((w) => w.includes('truncated'))).toBe(true)
  })

  it('degrades to warnings on unsalvageable and wrong-shape input', () => {
    expect(agentConversationConnector.parse('{"conversation": [', ctx).traces).toEqual([])
    expect(agentConversationConnector.parse('not json at all', ctx).traces).toEqual([])
    const wrongShape = agentConversationConnector.parse(JSON.stringify({ conversation: [] }), ctx)
    expect(wrongShape.traces).toEqual([])
    expect(wrongShape.warnings.length).toBeGreaterThan(0)
  })
})
