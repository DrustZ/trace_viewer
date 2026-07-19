import { describe, expect, it } from 'vitest'
import { connectors, detectFormat, parseAny } from './registry'

const fixtures = {
  native: JSON.stringify({
    meta: { traceId: 't-1' },
    messages: [{ id: '', role: 'user', content: 'hi' }],
  }),
  'openai-chat': JSON.stringify({
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'hi' }],
  }),
  harmony: '<|start|>user<|message|>hi<|end|><|start|>assistant<|message|>hey<|return|>',
}

describe('registry', () => {
  it('registers native, openai-chat, harmony in order', () => {
    expect(connectors.map((c) => c.id)).toEqual(['native', 'openai-chat', 'harmony'])
  })

  it('each fixture is detected by exactly one connector', () => {
    for (const [expected, text] of Object.entries(fixtures)) {
      const matches = connectors.filter((c) => c.detect(text)).map((c) => c.id)
      expect(matches).toEqual([expected])
    }
  })

  it('detectFormat picks the right connector and null for garbage', () => {
    expect(detectFormat(fixtures.native)?.id).toBe('native')
    expect(detectFormat(fixtures['openai-chat'])?.id).toBe('openai-chat')
    expect(detectFormat(fixtures.harmony)?.id).toBe('harmony')
    expect(detectFormat('complete gibberish')).toBeNull()
  })

  it('parseAny auto-detects when no hint is given', () => {
    const result = parseAny(fixtures.harmony, {})
    expect(result.traces).toHaveLength(1)
    expect(result.traces[0].meta.sourceFormat).toBe('harmony')
  })

  it('parseAny honors a valid formatHint', () => {
    const result = parseAny(fixtures.native, {}, 'native')
    expect(result.traces[0].meta.traceId).toBe('t-1')
  })

  it('parseAny with an unknown hint warns and falls back to auto-detect', () => {
    const result = parseAny(fixtures['openai-chat'], {}, 'bogus-format')
    expect(result.traces).toHaveLength(1)
    expect(result.traces[0].meta.sourceFormat).toBe('openai-chat')
    expect(result.warnings.some((w) => w.includes('bogus-format'))).toBe(true)
  })

  it('parseAny with a wrong-but-known hint still uses that connector without throwing', () => {
    const result = parseAny(fixtures.harmony, {}, 'native')
    expect(result.traces).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('parseAny reports unrecognized input without throwing', () => {
    const result = parseAny('complete gibberish', {})
    expect(result.traces).toEqual([])
    expect(result.warnings.some((w) => w.includes('unrecognized format'))).toBe(true)
  })
})
