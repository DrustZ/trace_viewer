import type { Rng } from './rng'

export type FailureKind =
  | 'tool_timeout_retry'
  | 'malformed_tool_json'
  | 'truncation'
  | 'budget_exceeded'
  | 'cancelled'
  | 'wrong_answer'

export const FAILURE_KINDS: readonly FailureKind[] = [
  'tool_timeout_retry',
  'malformed_tool_json',
  'truncation',
  'budget_exceeded',
  'cancelled',
  'wrong_answer',
]

export const TIMEOUT_RESULT = 'TIMEOUT after 30000ms'
export const MALFORMED_RESULT = 'invalid tool call arguments'
export const CANCELLED_RESULT = 'CancelledError: SIGINT'

const APPLICABLE: Record<string, readonly FailureKind[]> = {
  deepscaler: ['truncation', 'wrong_answer'],
  nemotron: ['truncation', 'wrong_answer'],
  swebench: [
    'tool_timeout_retry',
    'malformed_tool_json',
    'truncation',
    'budget_exceeded',
    'cancelled',
    'wrong_answer',
  ],
  termbench: [
    'tool_timeout_retry',
    'malformed_tool_json',
    'truncation',
    'budget_exceeded',
    'cancelled',
    'wrong_answer',
  ],
  leetcode: ['truncation', 'cancelled', 'wrong_answer'],
  browsecomp: ['malformed_tool_json', 'truncation', 'cancelled', 'wrong_answer'],
}

export function pickFailure(rng: Rng, short: string): FailureKind {
  return rng.pick(APPLICABLE[short] ?? ['wrong_answer'])
}

/** Kinds that force score 0 regardless of the sampled success. */
export function forcesFailure(kind: FailureKind): boolean {
  return kind === 'truncation' || kind === 'budget_exceeded' || kind === 'wrong_answer'
}

export function truncateMidSentence(text: string, rng: Rng): string {
  const cut = Math.max(20, Math.floor(text.length * (0.35 + rng.next() * 0.35)))
  return text.slice(0, cut).trimEnd()
}

/** Produces invalid JSON: either a truncated tail or a trailing comma before the closing brace. */
export function corruptJson(json: string, rng: Rng): string {
  if (rng.bernoulli(0.5)) {
    return json.slice(0, json.length - rng.int(2, Math.min(10, json.length - 4)))
  }
  return `${json.slice(0, -1)},}`
}

/** The real engine parse error for the malformed arguments, mirrored into ToolCall.parseError. */
export function parseErrorFor(args: string): string {
  try {
    JSON.parse(args)
    return 'expected malformed JSON'
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
