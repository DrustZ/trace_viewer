import type { Message, TokenLogprob } from '../shared/schema/types'
import { hashSeed, type Rng } from './rng'
import type { FailureRegion } from './types'

export const MAX_TOKENS_PER_MESSAGE = 700

/** Synthetic vocabulary size for token ids. */
export const TOKEN_ID_VOCAB = 200000

/** Stable vocabulary id: FNV-1a of the token string folded into [0, TOKEN_ID_VOCAB). */
export function tokenId(token: string): number {
  return hashSeed(token) % TOKEN_ID_VOCAB
}

/** A word or a single punctuation mark, carrying any whitespace that precedes it. */
const TOKEN_RE = /\s*(?:\w+|[^\w\s])/g

export interface TokenSpan {
  token: string
  start: number
}

/**
 * Naive BPE-style tokenizer: words and single punctuation marks, each carrying
 * its leading whitespace, so the concatenated tokens reproduce the source text
 * exactly (up to the token cap) and the UI can render gap-free token blocks.
 */
export function tokenize(text: string): TokenSpan[] {
  const spans: TokenSpan[] = []
  let cursor = 0
  for (const m of text.matchAll(TOKEN_RE)) {
    if (spans.length >= MAX_TOKENS_PER_MESSAGE) return spans
    spans.push({ token: m[0], start: m.index })
    cursor = m.index + m[0].length
  }
  if (cursor < text.length) {
    // Whitespace-only tail (or wholly-whitespace text) still belongs to a token.
    const last = spans[spans.length - 1]
    if (last !== undefined) last.token += text.slice(cursor)
    else if (text.length > 0) spans.push({ token: text, start: 0 })
  }
  return spans
}

/** The model-generated text a message's tokens correspond to: content, or the tool-call arguments. */
export function logprobText(m: Message): string {
  if (m.content.length > 0) return m.content
  return m.toolCalls?.[0]?.arguments ?? ''
}

function sampleLogprob(rng: Rng, suspicious: boolean): number {
  const u = (a: number, b: number) => a + rng.next() * (b - a)
  let lp: number
  if (suspicious) {
    lp = u(-7, -2.5)
  } else {
    const r = rng.next()
    lp = r < 0.85 ? u(-0.05, -0.001) : r < 0.97 ? u(-1.5, -0.3) : u(-6, -2)
  }
  return Math.min(-0.0001, Math.round(lp * 10000) / 10000)
}

export function buildTokens(
  text: string,
  rng: Rng,
  region?: { start: number; end: number },
): TokenLogprob[] {
  return tokenize(text).map(({ token, start }) => {
    const suspicious = region ? start < region.end && start + token.length > region.start : false
    return { token, logprob: sampleLogprob(rng, suspicious), id: tokenId(token) }
  })
}

/**
 * Attaches tokens to the final assistant message and (if present) one
 * commentary message — preferring a commentary that carries a failure region.
 * Returns true when any tokens were attached.
 */
export function attachLogprobs(
  messages: Message[],
  rng: Rng,
  regions: readonly FailureRegion[] = [],
): boolean {
  const targets: number[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.channel === 'final') {
      targets.push(i)
      break
    }
  }
  const commentaryIdxs: number[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) commentaryIdxs.push(i)
  }
  if (commentaryIdxs.length > 0) {
    const flagged = commentaryIdxs.find((i) => regions.some((r) => r.messageIndex === i))
    targets.push(flagged ?? rng.pick(commentaryIdxs))
  }

  let attached = false
  for (const idx of targets.sort((a, b) => a - b)) {
    const m = messages[idx]
    const text = logprobText(m)
    if (text.length === 0) continue
    let region: { start: number; end: number } | undefined
    for (const r of regions) {
      if (r.messageIndex !== idx) continue
      const start = text.indexOf(r.text)
      if (start >= 0) region = { start, end: start + r.text.length }
    }
    m.tokens = buildTokens(text, rng, region)
    attached = attached || m.tokens.length > 0
  }
  return attached
}
