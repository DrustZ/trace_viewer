import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages'
import type { Trace } from '../../shared/schema/types'

/**
 * Trace-scoped AI chat: packs the trace (meta + stats + messages) into a system
 * prompt and answers the client-supplied chat history with a single
 * non-streaming completion. Streaming is future work (time-boxed).
 */

const REQUEST_TIMEOUT_MS = 30_000
const MAX_TOKENS = 1200
const MAX_HISTORY = 20
/** Per-message content clamp inside the packed trace context. */
export const MESSAGE_CHAR_LIMIT = 1200
/** Total packed-context clamp (~24k chars ≈ a few thousand tokens). */
export const CONTEXT_CHAR_LIMIT = 24_000
const TRUNCATION_MARK = '[…truncated]'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Minimal client surface used here — a seam so tests can inject a fake. */
export interface TraceChatClient {
  messages: {
    create(
      params: MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<{ content: unknown }>
  }
}

/** Carries the HTTP status the route should answer with (503 no key, 502 upstream). */
export class TraceChatError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'TraceChatError'
  }
}

let singleton: TraceChatClient | null = null

function getClient(): TraceChatClient {
  if (!singleton) singleton = new Anthropic()
  return singleton
}

function clamp(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}${TRUNCATION_MARK}`
}

/**
 * Compact serialization of the trace for the system prompt: meta + stats +
 * reward/extra verdict data, then numbered messages (#N) with role/channel.
 * Each message content is clamped to MESSAGE_CHAR_LIMIT; the whole context is
 * clamped to ~CONTEXT_CHAR_LIMIT with an explicit truncation marker.
 */
export function buildTraceContext(trace: Trace): string {
  const { meta, stats } = trace
  const lines: string[] = [
    `Trace ${meta.traceId} — component ${meta.component} (${meta.split} split, checkpoint step ${meta.checkpointStep})`,
    `Status: ${meta.status} | instance: ${meta.instanceId} | source: ${meta.sourceFormat} | ${meta.timestamp}`,
    `Stats: score=${stats.score ?? 'ungraded'} turns=${stats.turns} toolUses=${stats.toolUses} ` +
      `tokens(in/out/thinking)=${stats.inputTokens}/${stats.outputTokens}/${stats.thinkingTokens} ` +
      `truncated=${stats.truncated} hasError=${stats.hasError}` +
      (stats.model ? ` model=${stats.model.name}` : ''),
  ]
  if (meta.rewardDetails && Object.keys(meta.rewardDetails).length > 0) {
    lines.push(`Reward details: ${JSON.stringify(meta.rewardDetails)}`)
  }
  if (meta.extra && Object.keys(meta.extra).length > 0) {
    lines.push(`Extra verdict data: ${clamp(JSON.stringify(meta.extra), MESSAGE_CHAR_LIMIT)}`)
  }
  if (trace.warnings?.length) {
    lines.push(`Warnings: ${clamp(trace.warnings.join('; '), MESSAGE_CHAR_LIMIT)}`)
  }
  lines.push('', 'Messages:')

  let out = lines.join('\n')
  for (let i = 0; i < trace.messages.length; i++) {
    const m = trace.messages[i]
    const channel = m.channel ? `/${m.channel}` : ''
    const tools = m.toolCalls?.length
      ? ` [tool calls: ${m.toolCalls.map((t) => t.name).join(', ')}]`
      : ''
    const toolResult = m.toolResult ? ` [tool result${m.toolResult.isError ? ' ERROR' : ''}]` : ''
    const line = `#${i + 1} ${m.role}${channel}${tools}${toolResult}: ${clamp(m.content, MESSAGE_CHAR_LIMIT)}`
    if (out.length + line.length + 1 > CONTEXT_CHAR_LIMIT) {
      out += `\n${TRUNCATION_MARK} (${trace.messages.length - i} more messages omitted)`
      break
    }
    out += `\n${line}`
  }
  return out
}

function buildSystemPrompt(trace: Trace): string {
  return `You are a trace-debugging assistant embedded in an RL training trace viewer. Answer questions about the trace below: diagnose failures, explain tool usage and scoring, and summarize model behavior. Be concise and concrete. When you reference specific messages, cite them by their number (e.g. #3) as listed in the context.

${buildTraceContext(trace)}`
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const rec = block as Record<string, unknown>
    if (rec.type === 'text' && typeof rec.text === 'string') parts.push(rec.text)
  }
  return parts.join('\n')
}

export async function traceChat(
  trace: Trace,
  history: ChatMessage[],
  client?: TraceChatClient,
): Promise<{ reply: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new TraceChatError(503, 'AI chat requires ANTHROPIC_API_KEY')
  }
  const messages = history.slice(-MAX_HISTORY)
  try {
    const response = await (client ?? getClient()).messages.create(
      {
        model: process.env.AI_CHAT_MODEL ?? 'claude-sonnet-5',
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(trace),
        messages,
      },
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    )
    const reply = extractText(response.content)
    if (reply === '') throw new Error('model returned an empty reply')
    return { reply }
  } catch (err) {
    if (err instanceof TraceChatError) throw err
    throw new TraceChatError(502, err instanceof Error ? err.message : 'AI chat failed')
  }
}
