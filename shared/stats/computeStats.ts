import type { Message, Trace, TraceMeta, TraceStats } from '../schema/types'

/**
 * Tool names whose results count as sandbox executions. Exported so the
 * generator and the UI agree with the metrics definition.
 */
export const SANDBOX_TOOLS = new Set([
  'bash',
  'terminal',
  'python',
  'execute_code',
  'run_tests',
  'pytest',
])

/**
 * Deterministic token estimate used when a message carries no token array.
 * ~4 chars per token is a stable, documented approximation for synthetic and
 * imported traces alike; exact counts (when a source provides them) arrive
 * via statsOverrides and win.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / 4)
}

export function messageTokens(m: Message): number {
  return m.tokens ? m.tokens.length : estimateTokens(m.content)
}

function isAssistant(m: Message): boolean {
  return m.role === 'assistant'
}

/**
 * Assigns message ids ("m-<idx>") and 1-based assistant stepIndex (a step is
 * a maximal contiguous block of assistant messages plus the tool results that
 * immediately follow it). Returns new message objects; input is not mutated.
 */
function annotateMessages(messages: Message[]): Message[] {
  let step = 0
  let inAssistantBlock = false
  return messages.map((m, idx) => {
    let stepIndex: number | undefined
    if (isAssistant(m)) {
      if (!inAssistantBlock) {
        step += 1
        inAssistantBlock = true
      }
      stepIndex = step
    } else if (m.role === 'tool' && step > 0) {
      // Tool results belong to the step that invoked them.
      inAssistantBlock = false
      stepIndex = step
    } else {
      inAssistantBlock = false
    }
    return { ...m, id: m.id || `m-${idx}`, stepIndex }
  })
}

export function computeStats(
  meta: TraceMeta,
  messages: Message[],
  overrides?: Partial<TraceStats>,
): TraceStats {
  let inputTokens = 0
  let outputTokens = 0
  let thinkingTokens = 0
  let toolUses = 0
  let sandboxExecutions = 0
  let toolErrors = 0
  let turns = 0
  let inAssistantBlock = false

  const toolNameByCallId = new Map<string, string>()
  // Build this independently of result order: asynchronous capture pipelines
  // can flush a result before the assistant call record that identifies it.
  for (const m of messages) {
    for (const call of m.toolCalls ?? []) toolNameByCallId.set(call.id, call.name)
  }

  for (const m of messages) {
    const tokens = messageTokens(m)
    if (isAssistant(m)) {
      outputTokens += tokens
      if (m.channel === 'analysis') thinkingTokens += tokens
      if (!inAssistantBlock) {
        turns += 1
        inAssistantBlock = true
      }
    } else {
      inputTokens += tokens
      inAssistantBlock = false
    }
    if (m.toolCalls) {
      toolUses += m.toolCalls.length
    }
    if (m.toolResult) {
      if (m.toolResult.isError) toolErrors += 1
      const carriedName = m.metadata?.toolName
      const match = m.metadata?.toolCallMatch
      const safeCarriedName =
        typeof carriedName === 'string' &&
        carriedName !== '' &&
        (match === 'exact' ||
          match === 'tool-name' ||
          match === 'single-pending' ||
          match === 'unmatched')
          ? carriedName
          : undefined
      const name = toolNameByCallId.get(m.toolResult.toolCallId) ?? safeCarriedName
      if (name && SANDBOX_TOOLS.has(name)) sandboxExecutions += 1
    }
  }

  const durationMs = computeDuration(messages)
  const stats: TraceStats = {
    score: null,
    hasError: toolErrors > 0 || meta.status === 'failed',
    truncated: false,
    inputTokens,
    outputTokens,
    thinkingTokens,
    totalTokens: inputTokens + outputTokens,
    turns,
    toolUses,
    sandboxExecutions,
    thinkingPortion: thinkingPortionOf(thinkingTokens, outputTokens),
    durationMs,
    ...overrides,
  }
  // thinkingPortion follows token overrides unless explicitly overridden itself.
  if (overrides && !('thinkingPortion' in overrides)) {
    stats.thinkingPortion = thinkingPortionOf(stats.thinkingTokens, stats.outputTokens)
  }
  return stats
}

/**
 * Share of output tokens spent thinking, clamped to [0, 1] — estimated
 * thinking tokens (chars/4) can exceed an exact outputTokens override from a
 * source's usage block, and a portion above 100% is never meaningful.
 */
function thinkingPortionOf(thinkingTokens: number, outputTokens: number): number {
  if (outputTokens <= 0) return 0
  return Math.min(1, thinkingTokens / outputTokens)
}

function computeDuration(messages: Message[]): number | undefined {
  const stamped = messages.flatMap((m) => {
    if (!m.timestamp) return []
    const start = Date.parse(m.timestamp)
    if (!Number.isFinite(start)) return []
    const duration =
      typeof m.durationMs === 'number' && Number.isFinite(m.durationMs)
        ? Math.max(m.durationMs, 0)
        : 0
    return [{ start, end: start + duration }]
  })
  if (stamped.length >= 2) {
    const first = Math.min(...stamped.map((entry) => entry.start))
    const end = Math.max(...stamped.map((entry) => entry.end))
    return Math.max(end - first, 0)
  }
  const summed = messages.reduce(
    (acc, m) =>
      acc +
      (typeof m.durationMs === 'number' && Number.isFinite(m.durationMs)
        ? Math.max(m.durationMs, 0)
        : 0),
    0,
  )
  return summed > 0 ? summed : undefined
}

/**
 * The single normalization point: connector/generator output in, `Trace` out.
 * Ids and stepIndex are assigned, stats are computed under one definition.
 */
export function finalizeTrace(
  meta: TraceMeta,
  messages: Message[],
  overrides?: Partial<TraceStats>,
  warnings?: string[],
): Trace {
  const annotated = annotateMessages(messages)
  return {
    meta,
    stats: computeStats(meta, annotated, overrides),
    messages: annotated,
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
  }
}
