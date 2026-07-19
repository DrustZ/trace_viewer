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

/** Tokens at or above this logprob (p ≥ 0.9) are logged without top-k, like real inference. */
export const TOPK_LOGPROB_CEILING = Math.log(0.9)

/** Plausible-looking word fragments used as synthesized top-k alternatives. */
const ALT_FRAGMENTS: readonly string[] = [
  ' the',
  ' a',
  ' and',
  ' to',
  ' of',
  ' is',
  ' in',
  ' that',
  ' it',
  ' we',
  ' not',
  ' also',
  'ing',
  'ed',
  's',
  'ly',
  ',',
  '.',
  ' (',
  ' =',
]

/**
 * Synthesize an inference top-k list for the token at `index`: the chosen
 * token first at its own logprob, then 2-3 rng-picked alternatives (neighbor
 * tokens + word fragments) with strictly descending probabilities below the
 * chosen one, keeping total mass under ~0.99.
 */
function buildTopk(tokens: TokenLogprob[], index: number, rng: Rng): TokenLogprob['topk'] {
  const chosen = tokens[index]
  const pChosen = Math.exp(chosen.logprob)
  const pool: string[] = []
  const prev = tokens[index - 1]
  const next = tokens[index + 1]
  if (prev !== undefined) pool.push(prev.token)
  if (next !== undefined) pool.push(next.token)
  pool.push(...ALT_FRAGMENTS)

  const topk: NonNullable<TokenLogprob['topk']> = [
    { token: chosen.token, logprob: chosen.logprob, id: chosen.id },
  ]
  const used = new Set([chosen.token])
  let budget = Math.min(0.99 - pChosen, pChosen)
  let ceiling = pChosen
  const altCount = rng.int(2, 3)
  for (let k = 0; k < altCount; k++) {
    let alt: string | undefined
    for (let tries = 0; tries < 8 && alt === undefined; tries++) {
      const candidate = rng.pick(pool)
      if (!used.has(candidate)) alt = candidate
    }
    if (alt === undefined) break
    used.add(alt)
    const cap = Math.min(ceiling * 0.9, budget)
    if (cap <= 1e-9) break
    const p = cap * (0.3 + 0.65 * rng.next())
    budget -= p
    ceiling = p
    topk.push({ token: alt, logprob: Math.round(Math.log(p) * 10000) / 10000, id: tokenId(alt) })
  }
  return topk
}

/** Tokens above this logprob (p ≈ 1) count toward a zero-logprob span. */
export const ZERO_LOGPROB_THRESHOLD = -0.0005

/** Consecutive near-zero tokens needed to flag a zero-logprob span. */
export const ZERO_LOGPROB_RUN = 3

export function buildTokens(
  text: string,
  rng: Rng,
  region?: { start: number; end: number },
): TokenLogprob[] {
  const spans = tokenize(text)
  const suspicious = spans.map(({ token, start }) =>
    region ? start < region.end && start + token.length > region.start : false,
  )
  const tokens: TokenLogprob[] = spans.map(({ token }, i) => ({
    token,
    logprob: sampleLogprob(rng, suspicious[i]),
    id: tokenId(token),
  }))
  // Occasionally a confident span: consecutive near-zero logprobs, like a model
  // copying boilerplate verbatim. Powers meta.extra.zero_logprob_span downstream.
  // Suspicious (failure-region) tokens are never overwritten.
  if (tokens.length >= ZERO_LOGPROB_RUN && rng.bernoulli(0.3)) {
    const len = Math.min(tokens.length, rng.int(ZERO_LOGPROB_RUN, 6))
    const start = rng.int(0, tokens.length - len)
    for (let i = start; i < start + len; i++) {
      if (!suspicious[i]) {
        tokens[i].logprob = -Math.round((0.0001 + rng.next() * 0.0003) * 10000) / 10000
      }
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].logprob < TOPK_LOGPROB_CEILING) tokens[i].topk = buildTopk(tokens, i, rng)
  }
  return tokens
}

/**
 * True when any message's attached tokens contain >= ZERO_LOGPROB_RUN
 * consecutive tokens with logprob above ZERO_LOGPROB_THRESHOLD.
 */
export function hasZeroLogprobSpan(messages: readonly Message[]): boolean {
  for (const m of messages) {
    if (!m.tokens) continue
    let run = 0
    for (const t of m.tokens) {
      run = t.logprob > ZERO_LOGPROB_THRESHOLD ? run + 1 : 0
      if (run >= ZERO_LOGPROB_RUN) return true
    }
  }
  return false
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
