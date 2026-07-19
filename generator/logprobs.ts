import type { Message, TokenLogprob } from '../shared/schema/types'
import type { Rng } from './rng'
import type { FailureRegion } from './types'

export const MAX_TOKENS_PER_MESSAGE = 700

const SPLIT_RE = /\s+|(?=[^\w\s])/

export interface TokenSpan {
  token: string
  start: number
}

/**
 * Naive whitespace/punctuation tokenizer. The UI zips tokens back onto the
 * same text with this exact split, so token count must match it.
 */
export function tokenize(text: string): TokenSpan[] {
  const spans: TokenSpan[] = []
  let cursor = 0
  for (const part of text.split(SPLIT_RE)) {
    if (part.length === 0) continue
    const start = text.indexOf(part, cursor)
    spans.push({ token: part, start })
    cursor = start + part.length
    if (spans.length >= MAX_TOKENS_PER_MESSAGE) break
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
    return { token, logprob: sampleLogprob(rng, suspicious) }
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
