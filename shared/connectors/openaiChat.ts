import type { Message, TokenLogprob, ToolCall, TraceMeta, TraceStats } from '../schema/types'
import type { Connector, ParseContext, ParseResult } from './types'

const EPOCH = '1970-01-01T00:00:00.000Z'
const KNOWN_TOP_LEVEL = new Set(['id', 'model', 'usage', 'created', 'messages', 'choices'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function djb2Hex(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8)
}

function parseArguments(args: string): { parsedArguments?: unknown; parseError?: string } {
  try {
    return { parsedArguments: JSON.parse(args) }
  } catch (e) {
    return { parseError: errorMessage(e) }
  }
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (isRecord(part) && typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }
  return ''
}

function extractLogprobs(choice: Record<string, unknown>): TokenLogprob[] | undefined {
  const logprobs = choice.logprobs
  if (!isRecord(logprobs) || !Array.isArray(logprobs.content)) return undefined
  const tokens = logprobs.content.filter(
    (t): t is { token: string; logprob: number } =>
      isRecord(t) && typeof t.token === 'string' && typeof t.logprob === 'number',
  )
  return tokens.map(({ token, logprob }) => ({ token, logprob }))
}

function parseOpenaiChat(text: string, ctx: ParseContext): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (e) {
    return { traces: [], warnings: [`invalid JSON: ${errorMessage(e)}`] }
  }
  if (!isRecord(value)) {
    return { traces: [], warnings: ['expected a JSON object with messages and/or choices'] }
  }

  const warnings: string[] = []
  const rawMessages: unknown[] = []
  if (Array.isArray(value.messages)) rawMessages.push(...value.messages)
  let choiceMessageIndex = -1
  let choiceTokens: TokenLogprob[] | undefined
  if (Array.isArray(value.choices) && value.choices.length > 0) {
    const choice = value.choices[0]
    if (isRecord(choice)) {
      if (isRecord(choice.message)) {
        choiceMessageIndex = rawMessages.length
        rawMessages.push(choice.message)
      }
      choiceTokens = extractLogprobs(choice)
    }
  }
  if (rawMessages.length === 0) {
    return { traces: [], warnings: [...warnings, 'no messages found'] }
  }

  let toolCallSeq = 0
  const mapToolCall = (tc: unknown): ToolCall => {
    toolCallSeq += 1
    const rec = isRecord(tc) ? tc : {}
    const fn = isRecord(rec.function) ? rec.function : {}
    const args = typeof fn.arguments === 'string' ? fn.arguments : ''
    return {
      id: typeof rec.id === 'string' && rec.id !== '' ? rec.id : `fc-${toolCallSeq}`,
      name: typeof fn.name === 'string' && fn.name !== '' ? fn.name : 'unknown',
      arguments: args,
      ...parseArguments(args),
    }
  }

  const messages: Message[] = []
  rawMessages.forEach((raw, index) => {
    if (!isRecord(raw)) {
      warnings.push(`message ${index + 1}: not an object, skipped`)
      return
    }
    const role = raw.role
    const content = contentToString(raw.content)
    const produced: Message[] = []
    if (role === 'assistant') {
      if (typeof raw.reasoning_content === 'string') {
        produced.push({
          id: '',
          role: 'assistant',
          channel: 'analysis',
          content: raw.reasoning_content,
        })
      }
      if (Array.isArray(raw.tool_calls) && raw.tool_calls.length > 0) {
        produced.push({
          id: '',
          role: 'assistant',
          channel: 'commentary',
          content,
          toolCalls: raw.tool_calls.map(mapToolCall),
        })
      } else {
        produced.push({ id: '', role: 'assistant', channel: 'final', content })
      }
    } else if (role === 'tool') {
      produced.push({
        id: '',
        role: 'tool',
        content,
        toolResult: {
          toolCallId: typeof raw.tool_call_id === 'string' ? raw.tool_call_id : '',
          isError: false,
        },
      })
    } else if (role === 'system' || role === 'developer' || role === 'user') {
      produced.push({ id: '', role, content })
    } else {
      warnings.push(`message ${index + 1}: unknown role '${String(role)}', treated as user`)
      produced.push({ id: '', role: 'user', content })
    }
    if (index === choiceMessageIndex && choiceTokens && produced.length > 0) {
      const last = produced[produced.length - 1]
      if (last.role === 'assistant') last.tokens = choiceTokens
    }
    messages.push(...produced)
  })

  const statsOverrides: Partial<TraceStats> = {}
  if (typeof value.model === 'string' && value.model !== '') {
    statsOverrides.model = { name: value.model }
  }
  if (isRecord(value.usage)) {
    const usage = value.usage
    const prompt = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined
    const completion =
      typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined
    if (prompt !== undefined) statsOverrides.inputTokens = prompt
    if (completion !== undefined) statsOverrides.outputTokens = completion
    if (prompt !== undefined || completion !== undefined) {
      statsOverrides.totalTokens =
        typeof usage.total_tokens === 'number'
          ? usage.total_tokens
          : (prompt ?? 0) + (completion ?? 0)
    }
  }

  const extra: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    if (!KNOWN_TOP_LEVEL.has(key)) extra[key] = val
  }

  const traceId =
    typeof value.id === 'string' && value.id !== '' ? value.id : `openai-${djb2Hex(text)}`
  const timestamp =
    typeof value.created === 'number' && Number.isFinite(value.created)
      ? new Date(value.created * 1000).toISOString()
      : (ctx.fallbackTimestamp ?? EPOCH)
  const meta: TraceMeta = {
    traceId,
    instanceId: traceId,
    component: 'imported/openai-chat',
    status: 'completed',
    timestamp,
    checkpointStep: 0,
    split: 'train',
    sourceFormat: 'openai-chat',
    dataLocation: ctx.sourcePath,
  }
  if (Object.keys(extra).length > 0) meta.extra = extra

  return {
    traces: [
      {
        meta,
        messages,
        ...(Object.keys(statsOverrides).length > 0 ? { statsOverrides } : {}),
        warnings,
      },
    ],
    warnings: [],
  }
}

export const openaiChatConnector: Connector = {
  id: 'openai-chat',
  displayName: 'OpenAI chat JSON',
  extensions: ['.json'],

  detect(text: string): boolean {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return false
    }
    if (!isRecord(value)) return false
    if (isRecord(value.meta) && value.meta.traceId) return false
    const messagesOk =
      Array.isArray(value.messages) &&
      value.messages.length > 0 &&
      value.messages.every((m) => isRecord(m) && typeof m.role === 'string')
    return messagesOk || Array.isArray(value.choices)
  },

  parse(text: string, ctx: ParseContext): ParseResult {
    try {
      return parseOpenaiChat(text, ctx)
    } catch (e) {
      return { traces: [], warnings: [`openai-chat parse failed: ${errorMessage(e)}`] }
    }
  },
}
