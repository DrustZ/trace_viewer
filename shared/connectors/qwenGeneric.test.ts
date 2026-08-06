import { describe, expect, it } from 'vitest'
import { qwenGenericConnector } from './qwenGeneric'

const ctx = { sourcePath: '/data/qwen.json', fallbackTimestamp: '2026-01-02T03:04:05.000Z' }

const bareArray = [
  { role: 'system', content: 'be helpful' },
  { role: 'user', content: 'square 3' },
  { role: 'assistant', reasoning_content: '3*3=9', content: 'It is 9.' },
]

describe('qwenGenericConnector.detect', () => {
  it('claims a bare [{role, content}] array', () => {
    expect(qwenGenericConnector.detect(JSON.stringify(bareArray))).toBe(true)
  })

  it('defers object {messages:[...]} to openai-chat and other specific connectors', () => {
    // Plain object messages are claimed by openai-chat (earlier), so qwen defers.
    expect(
      qwenGenericConnector.detect(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })),
    ).toBe(false)
    // native / anthropic / responses shapes are declined too.
    expect(
      qwenGenericConnector.detect(JSON.stringify({ meta: { traceId: 't' }, messages: [] })),
    ).toBe(false)
    expect(
      qwenGenericConnector.detect(
        JSON.stringify({ system: 's', messages: [{ role: 'user', content: 'hi' }] }),
      ),
    ).toBe(false)
    expect(qwenGenericConnector.detect(JSON.stringify({ output: [{ type: 'message' }] }))).toBe(
      false,
    )
  })

  it('rejects harmony text, block-array content and junk', () => {
    expect(qwenGenericConnector.detect('<|start|>user<|message|>hi<|end|>')).toBe(false)
    expect(
      qwenGenericConnector.detect(JSON.stringify([{ role: 'user', content: [{ type: 'text' }] }])),
    ).toBe(false)
    expect(qwenGenericConnector.detect('nope')).toBe(false)
    expect(qwenGenericConnector.detect('[]')).toBe(false)
  })
})

describe('qwenGenericConnector.parse', () => {
  it('splits assistant reasoning_content into analysis + final', () => {
    const result = qwenGenericConnector.parse(JSON.stringify(bareArray), ctx)
    expect(result.warnings).toEqual([])
    const trace = result.traces[0]
    expect(trace.messages.map((m) => [m.role, m.channel ?? null])).toEqual([
      ['system', null],
      ['user', null],
      ['assistant', 'analysis'],
      ['assistant', 'final'],
    ])
    expect(trace.messages[2].content).toBe('3*3=9')
    expect(trace.messages[3].content).toBe('It is 9.')
    expect(trace.meta).toMatchObject({
      component: 'imported/qwen-generic',
      sourceFormat: 'qwen-generic',
      dataLocation: '/data/qwen.json',
    })
    expect(trace.meta.traceId).toMatch(/^qwen-[0-9a-f]{8}$/)
    expect(trace.meta.extra).toMatchObject({ normalization: { checkpointStep: 'default' } })
  })

  it('parses the object {messages} form (e.g. via a format hint) with tool roles and model', () => {
    const source = {
      model: 'qwen-max',
      messages: [
        { role: 'user', content: 'run ls' },
        { role: 'tool', tool_call_id: 'c1', content: 'a.txt' },
        { role: 'assistant', content: 'one file' },
      ],
    }
    const trace = qwenGenericConnector.parse(JSON.stringify(source), ctx).traces[0]
    expect(trace.messages[1].toolResult).toEqual({ toolCallId: 'c1', isError: false })
    expect(trace.statsOverrides).toEqual({ model: { name: 'qwen-max' } })
  })

  it('warns on unknown roles and treats them as user', () => {
    const trace = qwenGenericConnector.parse(
      JSON.stringify([{ role: 'critic', content: 'hm' }]),
      ctx,
    ).traces[0]
    expect(trace.messages[0].role).toBe('user')
    expect(trace.warnings.some((w) => w.includes('critic'))).toBe(true)
  })

  it('never throws on unusable input', () => {
    for (const bad of ['nope', '{"foo":1}', '[1,2,3]']) {
      const result = qwenGenericConnector.parse(bad, ctx)
      expect(result.traces).toEqual([])
      expect(result.warnings.length).toBeGreaterThan(0)
    }
  })
})
