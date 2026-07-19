import { describe, expect, it } from 'vitest'
import { BPE_CHAR_CAP, bpeTokens } from './tokenize'

const MIXED =
  'Hello 世界! émoji 🎉 → naïve\ttabs\nnew line · 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 čeština teste\n  indented code(x=1)\n'

describe('bpeTokens', () => {
  it('round-trip: concatenated tokens reproduce the source exactly', () => {
    const tokens = bpeTokens(MIXED)
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.map((t) => t.token).join('')).toBe(MIXED)
  })

  it('assigns stable vocabulary ids and a placeholder logprob of 0', () => {
    const a = bpeTokens(MIXED)
    const b = bpeTokens(MIXED)
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id))
    expect(a.every((t) => typeof t.id === 'number')).toBe(true)
    expect(a.every((t) => t.logprob === 0)).toBe(true)
  })

  it('returns [] for empty text and for text over the cap', () => {
    expect(bpeTokens('')).toEqual([])
    expect(bpeTokens('x'.repeat(BPE_CHAR_CAP + 1))).toEqual([])
  })
})
