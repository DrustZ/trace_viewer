import { describe, expect, it } from 'vitest'
import {
  chipParts,
  confidence80,
  probsTitle,
  TOKEN_RENDER_CAP,
  tokensTitle,
  visualizeWhitespace,
} from './TokenLogprobText'

describe('confidence80', () => {
  it('buckets by p ≥ 0.8 high, p ≥ 0.5 med, else low', () => {
    expect(confidence80(Math.log(0.95))).toBe('high')
    expect(confidence80(Math.log(0.8))).toBe('high')
    expect(confidence80(Math.log(0.79))).toBe('med')
    expect(confidence80(Math.log(0.5))).toBe('med')
    expect(confidence80(Math.log(0.49))).toBe('low')
    expect(confidence80(Math.log(0.01))).toBe('low')
  })

  it('maps a missing logprob (synthetic BPE tokens) to na', () => {
    expect(confidence80(undefined)).toBe('na')
  })
})

describe('chipParts', () => {
  it('trims leading spaces but keeps interior spaces as-is', () => {
    expect(chipParts(' given')).toEqual({ body: 'given', newlines: 0 })
    expect(chipParts('  a b')).toEqual({ body: 'a b', newlines: 0 })
  })

  it('splits trailing newlines into a separate na chip count', () => {
    expect(chipParts(':\n')).toEqual({ body: ':', newlines: 1 })
    expect(chipParts('end\n\n')).toEqual({ body: 'end', newlines: 2 })
  })

  it('renders a pure-newline token as only the ↵ chip', () => {
    expect(chipParts('\n')).toEqual({ body: '', newlines: 1 })
  })

  it('visualizes tabs as arrows', () => {
    expect(chipParts('\tfoo')).toEqual({ body: '→foo', newlines: 0 })
  })

  it('falls back to visible middots for space-only tokens', () => {
    expect(chipParts('  ')).toEqual({ body: '··', newlines: 0 })
  })
})

describe('visualizeWhitespace', () => {
  it('maps spaces, newlines and tabs to visible glyphs', () => {
    expect(visualizeWhitespace(' the\nend\t!')).toBe('·the⏎end→!')
  })

  it('leaves text without whitespace untouched', () => {
    expect(visualizeWhitespace('sum,')).toBe('sum,')
  })
})

describe('token tooltips', () => {
  it('tokens mode includes the id when present and omits it when undefined', () => {
    expect(tokensTitle({ token: ' the', logprob: -0.01, id: 42 })).toBe(' the · id 42')
    expect(tokensTitle({ token: ' the', logprob: -0.01 })).toBe(' the')
  })

  it('probs mode quotes the token and shows logprob plus probability', () => {
    expect(probsTitle({ token: 'sum', logprob: Math.log(0.5) })).toBe('"sum" · -0.693 · 50.0%')
  })
})

describe('TOKEN_RENDER_CAP', () => {
  it('caps the span-per-token rendering at 1500', () => {
    expect(TOKEN_RENDER_CAP).toBe(1500)
  })
})
