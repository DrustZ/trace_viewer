import { describe, expect, it } from 'vitest'
import { anthropicMessagesConnector } from './anthropicMessages'

const ctx = { sourcePath: '/data/anthropic.json', fallbackTimestamp: '2026-01-02T03:04:05.000Z' }

const sample = {
  model: 'claude-opus-4-8',
  system: 'be careful',
  messages: [
    { role: 'user', content: 'add a null check to getUser' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'reading the file' },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'user.ts' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'function getUser(id){}' }],
    },
    { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
  ],
  usage: { input_tokens: 20, output_tokens: 8 },
}

describe('anthropicMessagesConnector.detect', () => {
  it('accepts block-array content and top-level system', () => {
    expect(anthropicMessagesConnector.detect(JSON.stringify(sample))).toBe(true)
    expect(
      anthropicMessagesConnector.detect(
        JSON.stringify({ system: 's', messages: [{ role: 'user', content: 'hi' }] }),
      ),
    ).toBe(true)
  })

  it('declines plain string chat (no blocks, no system) so openai/qwen can claim it', () => {
    expect(
      anthropicMessagesConnector.detect(
        JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
      ),
    ).toBe(false)
  })

  it('rejects native, chat-completions, responses, harmony, bare array and junk', () => {
    expect(
      anthropicMessagesConnector.detect(
        JSON.stringify({ meta: { traceId: 't' }, messages: [{ role: 'user', content: [] }] }),
      ),
    ).toBe(false)
    expect(
      anthropicMessagesConnector.detect(
        JSON.stringify({ choices: [], messages: [{ role: 'user', content: [{ type: 'text' }] }] }),
      ),
    ).toBe(false)
    expect(
      anthropicMessagesConnector.detect(
        JSON.stringify({ output: [], messages: [{ role: 'user', content: [{ type: 'text' }] }] }),
      ),
    ).toBe(false)
    expect(anthropicMessagesConnector.detect('<|start|>user<|message|>hi<|end|>')).toBe(false)
    expect(anthropicMessagesConnector.detect('[{"role":"user","content":"x"}]')).toBe(false)
    expect(anthropicMessagesConnector.detect('nope')).toBe(false)
  })
})

describe('anthropicMessagesConnector.parse', () => {
  it('maps system, text, tool_use and tool_result blocks', () => {
    const result = anthropicMessagesConnector.parse(JSON.stringify(sample), ctx)
    expect(result.warnings).toEqual([])
    const trace = result.traces[0]
    expect(trace.warnings).toEqual([])
    expect(trace.messages.map((m) => [m.role, m.channel ?? null])).toEqual([
      ['system', null],
      ['user', null],
      ['assistant', 'commentary'],
      ['tool', null],
      ['assistant', 'final'],
    ])
    expect(trace.messages[2].content).toBe('reading the file')
    expect(trace.messages[2].toolCalls).toEqual([
      {
        id: 'toolu_1',
        name: 'read_file',
        arguments: '{"path":"user.ts"}',
        parsedArguments: { path: 'user.ts' },
      },
    ])
    expect(trace.messages[3].toolResult).toEqual({ toolCallId: 'toolu_1', isError: false })
    expect(trace.messages[3].content).toBe('function getUser(id){}')
    expect(trace.messages[4].content).toBe('done')
    expect(trace.statsOverrides).toEqual({
      model: { name: 'claude-opus-4-8' },
      inputTokens: 20,
      outputTokens: 8,
      totalTokens: 28,
    })
    expect(trace.meta).toMatchObject({
      component: 'imported/anthropic-messages',
      sourceFormat: 'anthropic-messages',
      dataLocation: '/data/anthropic.json',
    })
    expect(trace.meta.traceId).toMatch(/^anthropic-[0-9a-f]{8}$/)
  })

  it('honors is_error on tool_result and handles string content', () => {
    const source = {
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't9', content: 'boom', is_error: true }],
        },
      ],
      system: 'x',
    }
    const trace = anthropicMessagesConnector.parse(JSON.stringify(source), ctx).traces[0]
    const toolMsg = trace.messages.find((m) => m.role === 'tool')
    expect(toolMsg?.toolResult).toEqual({ toolCallId: 't9', isError: true })
  })

  it('never throws on unusable input', () => {
    for (const bad of ['nope', '[]', '{"foo":1}', '{"messages":"x"}']) {
      const result = anthropicMessagesConnector.parse(bad, ctx)
      expect(result.traces).toEqual([])
      expect(result.warnings.length).toBeGreaterThan(0)
    }
  })
})
