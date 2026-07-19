import { describe, expect, it } from 'vitest'
import { buildTokens, TOPK_LOGPROB_CEILING, tokenId } from './logprobs'
import { mulberry32 } from './rng'

const TEXT = 'We are given vectors a and b, so the projection follows the usual formula.'

describe('top-k synthesis', () => {
  it('attaches topk only to tokens below the high-confidence ceiling', () => {
    const tokens = buildTokens(TEXT, mulberry32(1))
    for (const t of tokens) {
      if (t.logprob < TOPK_LOGPROB_CEILING) expect(t.topk).toBeDefined()
      else expect(t.topk).toBeUndefined()
    }
  })

  it('puts the chosen token first and alternatives strictly below it', () => {
    // A region spanning the whole text makes every token low-confidence.
    const tokens = buildTokens(TEXT, mulberry32(7), { start: 0, end: TEXT.length })
    expect(tokens.length).toBeGreaterThan(0)
    for (const t of tokens) {
      const topk = t.topk
      expect(topk).toBeDefined()
      if (topk === undefined) continue
      expect(topk.length).toBeGreaterThanOrEqual(3)
      expect(topk.length).toBeLessThanOrEqual(4)
      expect(topk[0]).toEqual({ token: t.token, logprob: t.logprob, id: t.id })
      let mass = 0
      for (let k = 0; k < topk.length; k++) {
        mass += Math.exp(topk[k].logprob)
        if (k > 0) {
          expect(topk[k].logprob).toBeLessThan(topk[k - 1].logprob)
          expect(topk[k].token).not.toBe(t.token)
          expect(topk[k].id).toBe(tokenId(topk[k].token))
        }
      }
      expect(mass).toBeLessThanOrEqual(0.9901)
    }
  })

  it('is deterministic for the same seed', () => {
    const a = buildTokens(TEXT, mulberry32(42), { start: 0, end: 20 })
    const b = buildTokens(TEXT, mulberry32(42), { start: 0, end: 20 })
    expect(a).toEqual(b)
  })
})
