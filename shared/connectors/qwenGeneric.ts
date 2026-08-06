import { withDefaultCheckpointProvenance } from '../schema/provenance'
import type { Message, TraceMeta, TraceStats } from '../schema/types'
import { anthropicMessagesConnector } from './anthropicMessages'
import { nativeConnector } from './native'
import { openaiChatConnector } from './openaiChat'
import { openaiResponsesConnector } from './openaiResponses'
import type { Connector, ParseContext, ParseResult } from './types'

const EPOCH = '1970-01-01T00:00:00.000Z'
const ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool'])

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

/** A plain {role, string content} entry — the shape this fallback accepts. */
function isPlainEntry(m: unknown): m is Record<string, unknown> {
  return isRecord(m) && typeof m.role === 'string' && typeof m.content === 'string'
}

/** Pull the messages array out of a bare [] or a {messages:[]} wrapper. */
function extractMessages(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.messages)) return value.messages
  return null
}

function looksPlain(value: unknown): boolean {
  const msgs = extractMessages(value)
  return msgs !== null && msgs.length > 0 && msgs.every(isPlainEntry)
}

function parseQwenGeneric(text: string, ctx: ParseContext): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (e) {
    return { traces: [], warnings: [`invalid JSON: ${errorMessage(e)}`] }
  }
  const rawMessages = extractMessages(value)
  if (rawMessages === null) {
    return { traces: [], warnings: ['expected an array or object with a messages array'] }
  }

  const warnings: string[] = []
  const messages: Message[] = []
  rawMessages.forEach((raw, index) => {
    if (!isRecord(raw)) {
      warnings.push(`message ${index + 1}: not an object, skipped`)
      return
    }
    const role = raw.role
    const content = typeof raw.content === 'string' ? raw.content : ''
    if (role === 'assistant') {
      if (typeof raw.reasoning_content === 'string' && raw.reasoning_content !== '') {
        messages.push({
          id: '',
          role: 'assistant',
          channel: 'analysis',
          content: raw.reasoning_content,
        })
      }
      messages.push({ id: '', role: 'assistant', channel: 'final', content })
    } else if (role === 'tool') {
      messages.push({
        id: '',
        role: 'tool',
        content,
        toolResult: {
          toolCallId: typeof raw.tool_call_id === 'string' ? raw.tool_call_id : '',
          isError: false,
        },
      })
    } else if (role === 'system' || role === 'developer' || role === 'user') {
      messages.push({ id: '', role, content })
    } else {
      warnings.push(`message ${index + 1}: unknown role '${String(role)}', treated as user`)
      messages.push({ id: '', role: 'user', content })
    }
  })

  if (messages.length === 0) {
    return { traces: [], warnings: [...warnings, 'no messages found'] }
  }

  const statsOverrides: Partial<TraceStats> = {}
  if (isRecord(value) && typeof value.model === 'string' && value.model !== '') {
    statsOverrides.model = { name: value.model }
  }

  const traceId = `qwen-${djb2Hex(text)}`
  const meta: TraceMeta = {
    traceId,
    instanceId: traceId,
    component: 'imported/qwen-generic',
    status: 'completed',
    timestamp: ctx.fallbackTimestamp ?? EPOCH,
    checkpointStep: 0,
    split: 'train',
    sourceFormat: 'qwen-generic',
    dataLocation: ctx.sourcePath,
    extra: withDefaultCheckpointProvenance(),
  }

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

export const qwenGenericConnector: Connector = {
  id: 'qwen-generic',
  displayName: 'Qwen / generic messages',
  extensions: ['.json'],

  detect(text: string): boolean {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return false
    }
    // Lowest priority: only claim shapes the specific connectors declined.
    if (
      nativeConnector.detect(text) ||
      openaiChatConnector.detect(text) ||
      openaiResponsesConnector.detect(text) ||
      anthropicMessagesConnector.detect(text)
    ) {
      return false
    }
    if (!looksPlain(value)) return false
    const msgs = extractMessages(value) ?? []
    return msgs.every((m) => isRecord(m) && ROLES.has(String(m.role)))
  },

  parse(text: string, ctx: ParseContext): ParseResult {
    try {
      return parseQwenGeneric(text, ctx)
    } catch (e) {
      return { traces: [], warnings: [`qwen-generic parse failed: ${errorMessage(e)}`] }
    }
  },
}
