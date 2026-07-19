/**
 * Client-side BPE fallback for traces imported without per-token data: 'tokens'
 * view mode segments the text with gpt-tokenizer (o200k vocabulary). Synthetic
 * tokens carry logprob 0 as a placeholder — tokens mode never displays it, and
 * callers must not wire these into 'probs' mode.
 */
import type { TokenLogprob } from '@shared/schema/types'
import { decode, encode } from 'gpt-tokenizer'

/** Above this many characters the fallback is skipped (encode gets slow). */
export const BPE_CHAR_CAP = 20_000

/**
 * Tokenize `text` into per-token segments with vocabulary ids. The library's
 * streaming decoder buffers multi-byte UTF-8 sequences split across tokens, so
 * such tokens decode to '' until the byte that completes the character —
 * concatenating all `token` strings always reproduces `text` exactly.
 * Returns [] for empty text or text over BPE_CHAR_CAP.
 */
export function bpeTokens(text: string): TokenLogprob[] {
  if (text.length === 0 || text.length > BPE_CHAR_CAP) return []
  return encode(text).map((id) => ({ token: decode([id]), logprob: 0, id }))
}
