import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages'
import type { Trace } from '../../shared/schema/types'

/**
 * Checkpoint playground: replay a recorded trace prefix against a stand-in
 * model ("simulated checkpoint"). The prefix is the trace's system/developer
 * messages plus the conversation up to a chosen cut point, optionally with the
 * last user message overridden.
 */

const REQUEST_TIMEOUT_MS = 45_000
const MAX_TOKENS = 1500
/** Total prefix clamp (system context + conversation contents). */
export const PREFIX_CHAR_LIMIT = 20_000
const TRUNCATION_MARK = '[…truncated]'

export interface PlaygroundParams {
  /** Include messages up to and including this id. Default: everything before the first assistant step. */
  uptoMessageId?: string
  /** Replaces the last user message in the prefix (appended if the prefix has none). */
  userOverride?: string
  /** Checkpoint step named in the simulation preamble. Default: the trace's step. */
  checkpointStep?: number
}

export interface PlaygroundResult {
  reply: string
  promptChars: number
  model: string
}

export interface ReplayPrefix {
  /** Joined system/developer message contents (without the simulation preamble). */
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

/** Minimal client surface used here — a seam so tests can inject a fake. */
export interface PlaygroundClient {
  messages: {
    create(
      params: MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<{ content: unknown }>
  }
}

/** Carries the HTTP status the route should answer with (400 bad cut, 503 no key, 502 upstream). */
export class PlaygroundError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'PlaygroundError'
  }
}

let singleton: PlaygroundClient | null = null

function getClient(): PlaygroundClient {
  if (!singleton) singleton = new Anthropic()
  return singleton
}

/** Renders one trace message as replay text (tool calls/results become bracketed notes). */
function renderContent(m: Trace['messages'][number]): string {
  const parts: string[] = []
  if (m.content.trim() !== '') parts.push(m.content)
  for (const call of m.toolCalls ?? []) {
    parts.push(`[tool call ${call.name}: ${call.arguments}]`)
  }
  return parts.join('\n') || '(empty message)'
}

/**
 * Builds the replay prefix: system/developer contents joined as system context,
 * the remaining messages up to (and including) `uptoMessageId` as an
 * alternating user/assistant conversation (tool → user), with `userOverride`
 * swapped in for the last user message. Clamped to ~PREFIX_CHAR_LIMIT chars
 * (oldest conversation content truncated first, then the system context).
 */
export function buildReplayPrefix(trace: Trace, params: PlaygroundParams): ReplayPrefix {
  let cut: number
  if (params.uptoMessageId !== undefined) {
    cut = trace.messages.findIndex((m) => m.id === params.uptoMessageId)
    if (cut === -1) {
      throw new PlaygroundError(400, `message '${params.uptoMessageId}' not found in trace`)
    }
  } else {
    const firstAssistant = trace.messages.findIndex((m) => m.role === 'assistant')
    cut = (firstAssistant === -1 ? trace.messages.length : firstAssistant) - 1
  }

  const systemParts: string[] = []
  const conversation: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (let i = 0; i < trace.messages.length; i++) {
    const m = trace.messages[i]
    // System/developer messages are always part of the replay setup.
    if (m.role === 'system' || m.role === 'developer') {
      systemParts.push(m.content)
      continue
    }
    if (i > cut) break
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    const content =
      m.role === 'tool'
        ? `[tool result${m.toolResult?.isError ? ' ERROR' : ''}] ${renderContent(m)}`
        : renderContent(m)
    const prev = conversation[conversation.length - 1]
    // The Messages API wants alternating roles — merge adjacent same-role turns.
    if (prev && prev.role === role) prev.content += `\n\n${content}`
    else conversation.push({ role, content })
  }

  if (params.userOverride !== undefined && params.userOverride.trim() !== '') {
    let replaced = false
    for (let i = conversation.length - 1; i >= 0; i--) {
      if (conversation[i].role === 'user') {
        conversation[i] = { role: 'user', content: params.userOverride }
        replaced = true
        break
      }
    }
    if (!replaced) conversation.push({ role: 'user', content: params.userOverride })
  }

  if (conversation.length === 0) {
    throw new PlaygroundError(400, 'replay prefix contains no user messages')
  }
  if (conversation[0].role === 'assistant') {
    conversation.unshift({ role: 'user', content: '(replaying from mid-trace)' })
  }

  let system = systemParts.join('\n\n')
  // Clamp: truncate oldest conversation content first, then the system context.
  let total = system.length + conversation.reduce((sum, m) => sum + m.content.length, 0)
  for (const m of conversation) {
    if (total <= PREFIX_CHAR_LIMIT) break
    const keep = Math.max(0, m.content.length - (total - PREFIX_CHAR_LIMIT))
    total -= m.content.length - keep
    m.content = keep === 0 ? TRUNCATION_MARK : `${m.content.slice(0, keep)}${TRUNCATION_MARK}`
  }
  if (total > PREFIX_CHAR_LIMIT) {
    system = `${system.slice(0, Math.max(0, system.length - (total - PREFIX_CHAR_LIMIT)))}${TRUNCATION_MARK}`
  }

  return { system, messages: conversation }
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

export async function runPlayground(
  trace: Trace,
  params: PlaygroundParams,
  client?: PlaygroundClient,
): Promise<PlaygroundResult> {
  const prefix = buildReplayPrefix(trace, params)
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new PlaygroundError(503, 'Playground replay requires ANTHROPIC_API_KEY')
  }
  const model = process.env.AI_PLAYGROUND_MODEL ?? 'claude-sonnet-5'
  const step = params.checkpointStep ?? trace.meta.checkpointStep
  const preamble = `You are simulating policy checkpoint step ${step} for an RL debugging playground. Answer as the task agent would.`
  const system = prefix.system === '' ? preamble : `${preamble}\n\n${prefix.system}`
  const promptChars = system.length + prefix.messages.reduce((sum, m) => sum + m.content.length, 0)
  try {
    const response = await (client ?? getClient()).messages.create(
      { model, max_tokens: MAX_TOKENS, system, messages: prefix.messages },
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    )
    const reply = extractText(response.content)
    if (reply === '') throw new Error('model returned an empty reply')
    return { reply, promptChars, model }
  } catch (err) {
    if (err instanceof PlaygroundError) throw err
    throw new PlaygroundError(502, err instanceof Error ? err.message : 'playground replay failed')
  }
}
