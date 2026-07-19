import type { Message, ToolCall, TraceMeta, TraceStats } from '../schema/types'
import type { Connector, ParseContext, ParseResult } from './types'

const EPOCH = '1970-01-01T00:00:00.000Z'
const KNOWN_TOP_LEVEL = new Set(['id', 'model', 'usage', 'system', 'messages', 'role', 'type'])

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

/** Anthropic tool_result content is a string or an array of {type:'text',text} blocks. */
function blockContentToString(content: unknown): string {
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

/** True for a content array holding at least one block record with a `type` field. */
function hasBlockArray(messages: unknown[]): boolean {
  return messages.some(
    (m) =>
      isRecord(m) &&
      Array.isArray(m.content) &&
      m.content.some((b) => isRecord(b) && typeof b.type === 'string'),
  )
}

function mapMessage(
  raw: Record<string, unknown>,
  index: number,
  out: Message[],
  warnings: string[],
  ctr: { seq: number },
): void {
  const role = raw.role === 'assistant' ? 'assistant' : 'user'
  if (typeof raw.content === 'string') {
    if (role === 'assistant')
      out.push({ id: '', role: 'assistant', channel: 'final', content: raw.content })
    else out.push({ id: '', role: 'user', content: raw.content })
    return
  }
  if (!Array.isArray(raw.content)) {
    warnings.push(`message ${index + 1}: content is neither string nor array, skipped`)
    return
  }

  let text = ''
  const toolCalls: ToolCall[] = []
  const trailing: Message[] = []
  for (const block of raw.content) {
    if (!isRecord(block)) continue
    if (block.type === 'text') {
      if (typeof block.text === 'string') text += block.text
    } else if (block.type === 'tool_use') {
      ctr.seq += 1
      const args = JSON.stringify(block.input ?? {})
      toolCalls.push({
        id: typeof block.id === 'string' && block.id !== '' ? block.id : `tu-${ctr.seq}`,
        name: typeof block.name === 'string' && block.name !== '' ? block.name : 'unknown',
        arguments: args,
        ...parseArguments(args),
      })
    } else if (block.type === 'tool_result') {
      trailing.push({
        id: '',
        role: 'tool',
        content: blockContentToString(block.content),
        toolResult: {
          toolCallId: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
          isError: Boolean(block.is_error),
        },
      })
    } else {
      warnings.push(`message ${index + 1}: unknown block type '${String(block.type)}', skipped`)
    }
  }

  if (toolCalls.length > 0) {
    out.push({ id: '', role: 'assistant', channel: 'commentary', content: text, toolCalls })
  } else if (text !== '' || trailing.length === 0) {
    if (role === 'assistant')
      out.push({ id: '', role: 'assistant', channel: 'final', content: text })
    else out.push({ id: '', role: 'user', content: text })
  }
  out.push(...trailing)
}

function parseAnthropicMessages(text: string, ctx: ParseContext): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (e) {
    return { traces: [], warnings: [`invalid JSON: ${errorMessage(e)}`] }
  }
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    return { traces: [], warnings: ['expected a JSON object with a messages array'] }
  }

  const warnings: string[] = []
  const messages: Message[] = []
  const ctr = { seq: 0 }

  if (typeof value.system === 'string' && value.system !== '') {
    messages.push({ id: '', role: 'system', content: value.system })
  }
  value.messages.forEach((raw, i) => {
    if (!isRecord(raw)) {
      warnings.push(`message ${i + 1}: not an object, skipped`)
      return
    }
    mapMessage(raw, i, messages, warnings, ctr)
  })

  if (messages.length === 0) {
    return { traces: [], warnings: [...warnings, 'no messages found'] }
  }

  const statsOverrides: Partial<TraceStats> = {}
  if (typeof value.model === 'string' && value.model !== '') {
    statsOverrides.model = { name: value.model }
  }
  if (isRecord(value.usage)) {
    const usage = value.usage
    const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined
    const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined
    if (input !== undefined) statsOverrides.inputTokens = input
    if (output !== undefined) statsOverrides.outputTokens = output
    if (input !== undefined || output !== undefined) {
      statsOverrides.totalTokens = (input ?? 0) + (output ?? 0)
    }
  }

  const extra: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    if (!KNOWN_TOP_LEVEL.has(key)) extra[key] = val
  }

  const traceId =
    typeof value.id === 'string' && value.id !== '' ? value.id : `anthropic-${djb2Hex(text)}`
  const meta: TraceMeta = {
    traceId,
    instanceId: traceId,
    component: 'imported/anthropic-messages',
    status: 'completed',
    timestamp: ctx.fallbackTimestamp ?? EPOCH,
    checkpointStep: 0,
    split: 'train',
    sourceFormat: 'anthropic-messages',
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

export const anthropicMessagesConnector: Connector = {
  id: 'anthropic-messages',
  displayName: 'Anthropic Messages JSON',
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
    if (Array.isArray(value.choices) || Array.isArray(value.output)) return false
    if (!Array.isArray(value.messages) || value.messages.length === 0) return false
    const rolesOk = value.messages.every((m) => isRecord(m) && typeof m.role === 'string')
    if (!rolesOk) return false
    // Distinguish from plain string-only chat: require an Anthropic-specific
    // signal (content-block arrays, or a top-level system string).
    return hasBlockArray(value.messages) || typeof value.system === 'string'
  },

  parse(text: string, ctx: ParseContext): ParseResult {
    try {
      return parseAnthropicMessages(text, ctx)
    } catch (e) {
      return { traces: [], warnings: [`anthropic-messages parse failed: ${errorMessage(e)}`] }
    }
  },
}
