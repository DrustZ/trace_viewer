import { describe, expect, it } from 'vitest'
import { segmentTokens } from './TokenLogprobText'

const hi = -0.001 // bucket 0
const lo = -3 // bucket 4

describe('segmentTokens', () => {
  it('concatenates token text when no source text is given', () => {
    const segs = segmentTokens([
      { token: 'a', logprob: hi },
      { token: 'b', logprob: hi },
    ])
    expect(segs.map((s) => s.text).join('')).toBe('ab')
  })

  it('restores whitespace gaps from the source text', () => {
    const segs = segmentTokens(
      [
        { token: 'Working', logprob: lo },
        { token: 'through', logprob: hi },
        { token: 'the', logprob: hi },
        { token: 'sum', logprob: hi },
        { token: ',', logprob: hi },
      ],
      'Working through the sum, done.',
    )
    expect(segs.map((s) => s.text).join('')).toBe('Working through the sum, done.')
  })

  it('renders the untokenized tail as an untinted segment', () => {
    const segs = segmentTokens([{ token: 'x', logprob: lo }], 'x tail')
    const last = segs[segs.length - 1]
    expect(last.bucket).toBe(0)
    expect(last.text).toBe(' tail')
    expect(last.minToken).toBeNull()
  })

  it('merges consecutive same-bucket tokens into one segment', () => {
    const segs = segmentTokens(
      [
        { token: 'a', logprob: hi },
        { token: 'b', logprob: hi },
        { token: 'c', logprob: lo },
      ],
      'a b c',
    )
    expect(segs).toHaveLength(2)
    expect(segs[0].text).toBe('a b ')
    expect(segs[1].text).toBe('c')
    expect(segs[1].minToken?.token).toBe('c')
  })
})
