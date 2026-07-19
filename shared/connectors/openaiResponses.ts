import type { Message, ToolCall, TraceMeta, TraceStats } from '../schema/types'
import type { Connector, ParseContext, ParseResult } from './types'

const EPOCH = '1970-01-01T00:00:00.000Z'
const KNOWN_TOP_LEVEL = new Set(['id', 'model', 'usage', 'created_at', 'output', 'input', 'object'])
const ITEM_TYPES = new Set(['message', 'function_call', 'function_call_output', 'reasoning'])

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

/** Join the `text` of output_text/input_text/text content parts. */
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

/** Reasoning items carry either a `summary` (string or [{text}]) and/or `text`. */
function reasoningToString(item: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof item.summary === 'string') parts.push(item.summary)
  else if (Array.isArray(item.summary)) parts.push(contentToString(item.summary))
  if (typeof item.text === 'string' && item.text !== '') parts.push(item.text)
  return parts.filter((p) => p !== '').join('\n')
}

function outputToString(output: unknown): string {
  if (typeof output === 'string') return output
  if (isRecord(output) || Array.isArray(output)) return contentToString(output)
  return output === undefined || output === null ? '' : String(output)
}

function isErrorOutput(output: unknown): boolean {
  return isRecord(output) && (Boolean(output.error) || output.is_error === true)
}

interface Ctr {
  seq: number
}

function processItem(
  item: unknown,
  index: number,
  messages: Message[],
  warnings: string[],
  ctr: Ctr,
): void {
  if (!isRecord(item)) {
    warnings.push(`item ${index + 1}: not an object, skipped`)
    return
  }
  const type = typeof item.type === 'string' ? item.type : undefined

  if (type === 'reasoning') {
    messages.push({
      id: '',
      role: 'assistant',
      channel: 'analysis',
      content: reasoningToString(item),
    })
    return
  }

  if (type === 'function_call') {
    ctr.seq += 1
    const args = typeof item.arguments === 'string' ? item.arguments : ''
    const call: ToolCall = {
      id: typeof item.call_id === 'string' && item.call_id !== '' ? item.call_id : `fc-${ctr.seq}`,
      name: typeof item.name === 'string' && item.name !== '' ? item.name : 'unknown',
      arguments: args,
      ...parseArguments(args),
    }
    messages.push({
      id: '',
      role: 'assistant',
      channel: 'commentary',
      content: '',
      toolCalls: [call],
    })
    return
  }

  if (type === 'function_call_output') {
    messages.push({
      id: '',
      role: 'tool',
      content: outputToString(item.output),
      toolResult: {
        toolCallId: typeof item.call_id === 'string' ? item.call_id : '',
        isError: isErrorOutput(item.output),
      },
    })
    return
  }

  // A message item: explicit type 'message', or a bare {role, content}.
  if (type === 'message' || typeof item.role === 'string') {
    const role = item.role
    const content = contentToString(item.content)
    if (role === 'assistant') {
      messages.push({ id: '', role: 'assistant', channel: 'final', content })
    } else if (role === 'system' || role === 'developer' || role === 'user') {
      messages.push({ id: '', role, content })
    } else {
      warnings.push(`item ${index + 1}: unknown role '${String(role)}', treated as user`)
      messages.push({ id: '', role: 'user', content })
    }
    return
  }

  warnings.push(`item ${index + 1}: unrecognized item type '${String(type)}', skipped`)
}

function parseOpenaiResponses(text: string, ctx: ParseContext): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (e) {
    return { traces: [], warnings: [`invalid JSON: ${errorMessage(e)}`] }
  }
  if (!isRecord(value)) {
    return { traces: [], warnings: ['expected a JSON object with an output array'] }
  }

  const warnings: string[] = []
  const messages: Message[] = []
  const ctr: Ctr = { seq: 0 }

  // Request side ('input'): a bare string prompt, or an array of items.
  if (typeof value.input === 'string' && value.input !== '') {
    messages.push({ id: '', role: 'user', content: value.input })
  } else if (Array.isArray(value.input)) {
    value.input.forEach((item, i) => {
      processItem(item, i, messages, warnings, ctr)
    })
  }

  if (Array.isArray(value.output)) {
    value.output.forEach((item, i) => {
      processItem(item, i, messages, warnings, ctr)
    })
  }

  if (messages.length === 0) {
    return { traces: [], warnings: [...warnings, 'no output/input items found'] }
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
      statsOverrides.totalTokens =
        typeof usage.total_tokens === 'number' ? usage.total_tokens : (input ?? 0) + (output ?? 0)
    }
  }

  const extra: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    if (!KNOWN_TOP_LEVEL.has(key)) extra[key] = val
  }

  const traceId =
    typeof value.id === 'string' && value.id !== '' ? value.id : `responses-${djb2Hex(text)}`
  const timestamp =
    typeof value.created_at === 'number' && Number.isFinite(value.created_at)
      ? new Date(value.created_at * 1000).toISOString()
      : (ctx.fallbackTimestamp ?? EPOCH)
  const meta: TraceMeta = {
    traceId,
    instanceId: traceId,
    component: 'imported/openai-responses',
    status: 'completed',
    timestamp,
    checkpointStep: 0,
    split: 'train',
    sourceFormat: 'openai-responses',
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

export const openaiResponsesConnector: Connector = {
  id: 'openai-responses',
  displayName: 'OpenAI Responses JSON',
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
    if (Array.isArray(value.choices)) return false
    if (!Array.isArray(value.output)) return false
    return value.output.some((item) => isRecord(item) && ITEM_TYPES.has(String(item.type)))
  },

  parse(text: string, ctx: ParseContext): ParseResult {
    try {
      return parseOpenaiResponses(text, ctx)
    } catch (e) {
      return { traces: [], warnings: [`openai-responses parse failed: ${errorMessage(e)}`] }
    }
  },
}
