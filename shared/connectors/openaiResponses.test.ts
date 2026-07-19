import { describe, expect, it } from 'vitest'
import { openaiResponsesConnector } from './openaiResponses'

const ctx = { sourcePath: '/data/resp.json', fallbackTimestamp: '2026-01-02T03:04:05.000Z' }

const sample = {
  id: 'resp_1',
  model: 'gpt-5.1',
  input: 'why does test_x fail?',
  output: [
    { type: 'reasoning', summary: [{ type: 'summary_text', text: 'run it' }], text: 'then read' },
    { type: 'function_call', call_id: 'fc_1', name: 'run_tests', arguments: '{"path":"t.py"}' },
    { type: 'function_call_output', call_id: 'fc_1', output: '1 failed: boom' },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'It fails on divide-by-zero.' }],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
}

describe('openaiResponsesConnector.detect', () => {
  it('accepts an object with an output array of typed items', () => {
    expect(openaiResponsesConnector.detect(JSON.stringify(sample))).toBe(true)
  })

  it('rejects native, chat-completions (choices), anthropic, harmony and junk', () => {
    expect(
      openaiResponsesConnector.detect(
        JSON.stringify({ meta: { traceId: 't' }, messages: [], output: [{ type: 'message' }] }),
      ),
    ).toBe(false)
    expect(openaiResponsesConnector.detect(JSON.stringify({ choices: [], output: [] }))).toBe(false)
    expect(
      openaiResponsesConnector.detect(
        JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
      ),
    ).toBe(false)
    expect(openaiResponsesConnector.detect(JSON.stringify({ output: [] }))).toBe(false)
    expect(openaiResponsesConnector.detect('<|start|>user<|message|>hi<|end|>')).toBe(false)
    expect(openaiResponsesConnector.detect('[{"role":"user","content":"x"}]')).toBe(false)
    expect(openaiResponsesConnector.detect('nope')).toBe(false)
  })
})

describe('openaiResponsesConnector.parse', () => {
  it('maps input, reasoning, function_call/output and output_text', () => {
    const result = openaiResponsesConnector.parse(JSON.stringify(sample), ctx)
    expect(result.warnings).toEqual([])
    const trace = result.traces[0]
    expect(trace.warnings).toEqual([])
    expect(trace.messages.map((m) => [m.role, m.channel ?? null])).toEqual([
      ['user', null],
      ['assistant', 'analysis'],
      ['assistant', 'commentary'],
      ['tool', null],
      ['assistant', 'final'],
    ])
    expect(trace.messages[1].content).toBe('run it\nthen read')
    expect(trace.messages[2].toolCalls).toEqual([
      {
        id: 'fc_1',
        name: 'run_tests',
        arguments: '{"path":"t.py"}',
        parsedArguments: { path: 't.py' },
      },
    ])
    expect(trace.messages[3].toolResult).toEqual({ toolCallId: 'fc_1', isError: false })
    expect(trace.messages[4].content).toBe('It fails on divide-by-zero.')
    expect(trace.statsOverrides).toEqual({
      model: { name: 'gpt-5.1' },
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    })
    expect(trace.meta).toMatchObject({
      traceId: 'resp_1',
      component: 'imported/openai-responses',
      sourceFormat: 'openai-responses',
      dataLocation: '/data/resp.json',
    })
  })

  it('flags error output and keeps malformed arguments raw with a parseError', () => {
    const source = {
      output: [
        { type: 'function_call', call_id: 'c', name: 'bash', arguments: '{broken' },
        { type: 'function_call_output', call_id: 'c', output: { error: 'nope' } },
      ],
    }
    const trace = openaiResponsesConnector.parse(JSON.stringify(source), ctx).traces[0]
    expect(trace.messages[0].toolCalls?.[0].parseError).toBeTruthy()
    expect(trace.messages[0].toolCalls?.[0].parsedArguments).toBeUndefined()
    expect(trace.messages[1].toolResult?.isError).toBe(true)
  })

  it('synthesizes a trace id and honors input arrays', () => {
    const source = {
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hey' }] }],
      output: [],
    }
    const trace = openaiResponsesConnector.parse(JSON.stringify(source), ctx).traces[0]
    expect(trace.messages[0]).toMatchObject({ role: 'user', content: 'hey' })
    expect(trace.meta.traceId).toMatch(/^responses-[0-9a-f]{8}$/)
  })

  it('never throws on unusable input', () => {
    for (const bad of ['nope', '[]', '{"foo":1}', '{"output":[]}']) {
      const result = openaiResponsesConnector.parse(bad, ctx)
      expect(result.traces).toEqual([])
      expect(result.warnings.length).toBeGreaterThan(0)
    }
  })
})
