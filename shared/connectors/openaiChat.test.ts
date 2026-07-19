import { describe, expect, it } from 'vitest'
import { openaiChatConnector } from './openaiChat'

const ctx = { sourcePath: '/data/chat.json', fallbackTimestamp: '2026-01-02T03:04:05.000Z' }

const requestStyle = {
  model: 'gpt-test',
  messages: [
    { role: 'system', content: 'be terse' },
    { role: 'user', content: 'list files' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls"}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'a.txt b.txt' },
    { role: 'assistant', content: 'Two files.' },
  ],
}

const responseStyle = {
  id: 'chatcmpl-42',
  object: 'chat.completion',
  created: 1767322800,
  model: 'gpt-test',
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hi!', reasoning_content: 'greeting back' },
      logprobs: {
        content: [
          { token: 'Hi', logprob: -0.1 },
          { token: '!', logprob: -0.5 },
        ],
      },
      finish_reason: 'stop',
    },
  ],
}

describe('openaiChatConnector.detect', () => {
  it('accepts request-style and response-style exports', () => {
    expect(openaiChatConnector.detect(JSON.stringify(requestStyle))).toBe(true)
    expect(openaiChatConnector.detect(JSON.stringify(responseStyle))).toBe(true)
  })

  it('rejects native traces even when they carry a messages array', () => {
    const native = { meta: { traceId: 't-1' }, messages: [{ role: 'user', content: 'x' }] }
    expect(openaiChatConnector.detect(JSON.stringify(native))).toBe(false)
  })

  it('rejects harmony text, non-objects and garbage', () => {
    expect(openaiChatConnector.detect('<|start|>user<|message|>hi<|end|>')).toBe(false)
    expect(openaiChatConnector.detect('[{"role":"user"}]')).toBe(false)
    expect(openaiChatConnector.detect('nope')).toBe(false)
  })
})

describe('openaiChatConnector.parse', () => {
  it('maps request-style messages, tool calls and tool results', () => {
    const result = openaiChatConnector.parse(JSON.stringify(requestStyle), ctx)
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
    expect(trace.messages[2].toolCalls).toEqual([
      { id: 'call_1', name: 'bash', arguments: '{"cmd":"ls"}', parsedArguments: { cmd: 'ls' } },
    ])
    expect(trace.messages[3].toolResult).toEqual({ toolCallId: 'call_1', isError: false })
    expect(trace.statsOverrides).toEqual({ model: { name: 'gpt-test' } })
    expect(trace.meta).toMatchObject({
      instanceId: trace.meta.traceId,
      component: 'imported/openai-chat',
      status: 'completed',
      timestamp: '2026-01-02T03:04:05.000Z',
      checkpointStep: 0,
      split: 'train',
      sourceFormat: 'openai-chat',
      dataLocation: '/data/chat.json',
    })
    expect(trace.meta.traceId).toMatch(/^openai-[0-9a-f]{8}$/)
  })

  it('maps response-style with reasoning_content, logprobs, usage and created', () => {
    const trace = openaiChatConnector.parse(JSON.stringify(responseStyle), ctx).traces[0]
    expect(trace.meta.traceId).toBe('chatcmpl-42')
    expect(trace.meta.timestamp).toBe(new Date(1767322800 * 1000).toISOString())
    expect(trace.messages.map((m) => [m.role, m.channel])).toEqual([
      ['assistant', 'analysis'],
      ['assistant', 'final'],
    ])
    expect(trace.messages[0].content).toBe('greeting back')
    expect(trace.messages[0].tokens).toBeUndefined()
    expect(trace.messages[1].tokens).toEqual([
      { token: 'Hi', logprob: -0.1 },
      { token: '!', logprob: -0.5 },
    ])
    expect(trace.statsOverrides).toEqual({
      model: { name: 'gpt-test' },
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    })
    expect(trace.meta.extra).toEqual({ object: 'chat.completion' })
  })

  it('merges request messages before choices[0].message', () => {
    const merged = {
      messages: [{ role: 'user', content: 'q' }],
      choices: [{ message: { role: 'assistant', content: 'a' } }],
    }
    const trace = openaiChatConnector.parse(JSON.stringify(merged), ctx).traces[0]
    expect(trace.messages.map((m) => m.content)).toEqual(['q', 'a'])
  })

  it('keeps malformed tool-call arguments raw with parseError and synthesizes ids', () => {
    const source = {
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'bash', arguments: '{broken' } }, { function: {} }],
        },
      ],
    }
    const calls = openaiChatConnector.parse(JSON.stringify(source), ctx).traces[0].messages[0]
      .toolCalls
    expect(calls?.[0]).toMatchObject({ id: 'fc-1', name: 'bash', arguments: '{broken' })
    expect(calls?.[0].parseError).toBeTruthy()
    expect(calls?.[0].parsedArguments).toBeUndefined()
    expect(calls?.[1]).toMatchObject({ id: 'fc-2', name: 'unknown', arguments: '' })
  })

  it('concatenates array-of-parts content', () => {
    const source = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'part one ' }, { type: 'image_url' }, 'part two'],
        },
      ],
    }
    const trace = openaiChatConnector.parse(JSON.stringify(source), ctx).traces[0]
    expect(trace.messages[0].content).toBe('part one part two')
  })

  it('warns on unknown roles and treats them as user', () => {
    const source = { messages: [{ role: 'critic', content: 'hm' }] }
    const trace = openaiChatConnector.parse(JSON.stringify(source), ctx).traces[0]
    expect(trace.messages[0].role).toBe('user')
    expect(trace.warnings.some((w) => w.includes('critic'))).toBe(true)
  })

  it('never throws on unusable input', () => {
    for (const bad of ['nope', '[]', '{"foo":1}', '{"choices":[]}']) {
      const result = openaiChatConnector.parse(bad, ctx)
      expect(result.traces).toEqual([])
      expect(result.warnings.length).toBeGreaterThan(0)
    }
  })
})
