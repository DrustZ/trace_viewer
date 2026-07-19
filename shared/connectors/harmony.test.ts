import { describe, expect, it } from 'vitest'
import { harmonyConnector } from './harmony'

const ctx = { sourcePath: '/data/t.txt', fallbackTimestamp: '2026-01-02T03:04:05.000Z' }

const happy = [
  '<|start|>system<|message|>You are helpful.<|end|>',
  '<|start|>user<|message|>List files<|end|>',
  '<|start|>assistant<|channel|>analysis<|message|>I should run ls.<|end|>',
  '<|start|>assistant<|channel|>commentary to=functions.bash<|message|>{"cmd":"ls"}<|end|>',
  '<|start|>functions.bash to=assistant<|channel|>commentary<|message|>{"ok":true}<|end|>',
  '<|start|>assistant<|channel|>final<|message|>Done.<|return|>',
].join('\n')

describe('harmonyConnector.detect', () => {
  it('accepts harmony text and rejects others', () => {
    expect(harmonyConnector.detect(happy)).toBe(true)
    expect(harmonyConnector.detect('{"messages":[{"role":"user","content":"x"}]}')).toBe(false)
    expect(harmonyConnector.detect('<|start|>no message marker')).toBe(false)
    expect(harmonyConnector.detect('plain text')).toBe(false)
  })
})

describe('harmonyConnector.parse', () => {
  it('parses the canonical grammar into one trace', () => {
    const result = harmonyConnector.parse(happy, ctx)
    expect(result.warnings).toEqual([])
    expect(result.traces).toHaveLength(1)
    const trace = result.traces[0]
    expect(trace.warnings).toEqual([])
    expect(trace.messages.map((m) => [m.role, m.channel ?? null])).toEqual([
      ['system', null],
      ['user', null],
      ['assistant', 'analysis'],
      ['assistant', 'commentary'],
      ['tool', null],
      ['assistant', 'final'],
    ])
    const call = trace.messages[3]
    expect(call.content).toBe('')
    expect(call.toolCalls).toEqual([
      { id: 'fc-1', name: 'bash', arguments: '{"cmd":"ls"}', parsedArguments: { cmd: 'ls' } },
    ])
    const toolMsg = trace.messages[4]
    expect(toolMsg.content).toBe('{"ok":true}')
    expect(toolMsg.toolResult).toEqual({ toolCallId: 'fc-1', isError: false })
    expect(trace.messages[5].content).toBe('Done.')
  })

  it('produces deterministic harmony-<hash> ids and default meta', () => {
    const a = harmonyConnector.parse(happy, ctx).traces[0]
    const b = harmonyConnector.parse(happy, {}).traces[0]
    expect(a.meta.traceId).toMatch(/^harmony-[0-9a-f]{8}$/)
    expect(a.meta.traceId).toBe(b.meta.traceId)
    const other = harmonyConnector.parse('<|start|>user<|message|>hi<|end|>', ctx).traces[0]
    expect(other.meta.traceId).not.toBe(a.meta.traceId)
    expect(a.meta).toMatchObject({
      instanceId: a.meta.traceId,
      component: 'imported/harmony',
      status: 'completed',
      timestamp: '2026-01-02T03:04:05.000Z',
      checkpointStep: 0,
      split: 'train',
      sourceFormat: 'harmony',
      dataLocation: '/data/t.txt',
    })
    expect(b.meta.timestamp).toBe('1970-01-01T00:00:00.000Z')
  })

  it('keeps malformed tool-call arguments raw with a parseError', () => {
    const text =
      '<|start|>assistant<|channel|>commentary to=functions.bash<|message|>{not json<|end|>'
    const call = harmonyConnector.parse(text, ctx).traces[0].messages[0].toolCalls?.[0]
    expect(call?.arguments).toBe('{not json')
    expect(call?.parsedArguments).toBeUndefined()
    expect(call?.parseError).toBeTruthy()
  })

  it('synthesizes fc-unmatched ids for orphan tool results and warns', () => {
    const text = '<|start|>functions.bash to=assistant<|channel|>commentary<|message|>out<|end|>'
    const result = harmonyConnector.parse(text, ctx)
    const trace = result.traces[0]
    expect(trace.messages[0].toolResult?.toolCallId).toBe('fc-unmatched-1')
    expect(trace.warnings.some((w) => w.includes('no matching tool call'))).toBe(true)
  })

  it('matches the latest yet-unmatched call with the same name', () => {
    const text = [
      '<|start|>assistant<|channel|>commentary to=functions.bash<|message|>{"n":1}<|end|>',
      '<|start|>assistant<|channel|>commentary to=functions.bash<|message|>{"n":2}<|end|>',
      '<|start|>functions.bash to=assistant<|channel|>commentary<|message|>r2<|end|>',
      '<|start|>functions.bash to=assistant<|channel|>commentary<|message|>r1<|end|>',
    ].join('')
    const trace = harmonyConnector.parse(text, ctx).traces[0]
    expect(trace.messages[2].toolResult?.toolCallId).toBe('fc-2')
    expect(trace.messages[3].toolResult?.toolCallId).toBe('fc-1')
  })

  it('flags error tool results via ERROR prefix or JSON .error', () => {
    const text = [
      '<|start|>functions.bash to=assistant<|channel|>commentary<|message|>ERROR: boom<|end|>',
      '<|start|>functions.bash to=assistant<|channel|>commentary<|message|>{"error":"bad"}<|end|>',
      '<|start|>functions.bash to=assistant<|channel|>commentary<|message|>{"error":null}<|end|>',
    ].join('')
    const trace = harmonyConnector.parse(text, ctx).traces[0]
    expect(trace.messages.map((m) => m.toolResult?.isError)).toEqual([true, true, false])
  })

  it('appends an unterminated trailing block as assistant final with a warning', () => {
    const text = `${'<|start|>user<|message|>hi<|end|>'}<|start|>assistant<|message|>partial answ`
    const trace = harmonyConnector.parse(text, ctx).traces[0]
    expect(trace.messages).toHaveLength(2)
    expect(trace.messages[1]).toMatchObject({
      role: 'assistant',
      channel: 'final',
      content: 'partial answ',
    })
    expect(trace.warnings.some((w) => w.includes('unterminated block'))).toBe(true)
  })

  it('maps unknown headers to user messages with a warning', () => {
    const text = '<|start|>narrator<|message|>meanwhile...<|end|>'
    const trace = harmonyConnector.parse(text, ctx).traces[0]
    expect(trace.messages[0]).toMatchObject({ role: 'user', content: 'meanwhile...' })
    expect(trace.warnings.some((w) => w.includes('narrator'))).toBe(true)
  })

  it('treats a bare assistant header as channel final', () => {
    const trace = harmonyConnector.parse('<|start|>assistant<|message|>hey<|end|>', ctx).traces[0]
    expect(trace.messages[0]).toMatchObject({ role: 'assistant', channel: 'final', content: 'hey' })
  })

  it('never throws on degenerate input', () => {
    for (const bad of ['', '<|start|>', '<|start|>user', '<|message|>orphan<|end|>']) {
      const result = harmonyConnector.parse(bad, ctx)
      expect(result.traces).toEqual([])
      expect(result.warnings.length).toBeGreaterThan(0)
    }
  })
})
