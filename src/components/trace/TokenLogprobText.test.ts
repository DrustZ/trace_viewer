import { describe, expect, it } from 'vitest'
import { probsTitle, TOKEN_RENDER_CAP, tokensTitle, visualizeWhitespace } from './TokenLogprobText'

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
