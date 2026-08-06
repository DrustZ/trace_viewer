import type { Message, TraceMeta, TraceStats } from '../schema/types'
import type { Connector, ParseContext, ParseResult } from './types'

const EPOCH = '1970-01-01T00:00:00.000Z'

/** Truncated-file salvage tries at most this many closing-brace cut points. */
const MAX_SALVAGE_ATTEMPTS = 500

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

/**
 * The shape this connector claims: `{conversation: [...]}` where every entry
 * carries a role and an agent_type field (tau-bench-style multi-agent support
 * transcripts: agent_type distinguishes e.g. 'alpha' / 'beta' AI agents from
 * 'human' escalation).
 */
function looksLikeAgentConversation(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.conversation) || value.conversation.length === 0) {
    return false
  }
  return value.conversation.every(
    (m) => isRecord(m) && typeof m.role === 'string' && 'agent_type' in m,
  )
}

/**
 * Recovers a file that was cut off mid-write: retries the parse closing the
 * conversation array at each trailing `}` (working backwards), so everything
 * before the cut is kept. Returns null when nothing parseable remains.
 */
function salvageTruncated(text: string): Record<string, unknown> | null {
  let idx = text.length
  for (let attempt = 0; attempt < MAX_SALVAGE_ATTEMPTS; attempt++) {
    idx = text.lastIndexOf('}', idx - 1)
    if (idx <= 0) return null
    try {
      const value: unknown = JSON.parse(`${text.slice(0, idx + 1)}]}`)
      if (looksLikeAgentConversation(value)) return value as Record<string, unknown>
    } catch {
      // Cut landed inside a string or nested object — keep working backwards.
    }
  }
  return null
}

/** Source timestamps are unix epoch seconds (float). */
function toIso(ts: unknown): string | undefined {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return undefined
  return new Date(ts * 1000).toISOString()
}

/** Tool results in this format signal failure as plain text: "Error: ...". */
function isErrorResult(content: string): boolean {
  return /^\s*error\b/i.test(content)
}

function parseAgentConversation(text: string, ctx: ParseContext): ParseResult {
  let value: unknown
  let truncated = false
  try {
    value = JSON.parse(text)
  } catch (e) {
    value = salvageTruncated(text)
    if (value === null) {
      return { traces: [], warnings: [`invalid JSON and not salvageable: ${errorMessage(e)}`] }
    }
    truncated = true
  }
  if (!looksLikeAgentConversation(value)) {
    return {
      traces: [],
      warnings: ['expected {conversation: [{role, agent_type, ...}]}'],
    }
  }
  const rawMessages = (value as Record<string, unknown>).conversation as unknown[]

  const warnings: string[] = truncated
    ? ['file ends mid-JSON — kept the messages before the cut and flagged the trace truncated']
    : []
  const messages: Message[] = []
  /** Distinct assistant agent_types in order of first appearance. */
  const agents: string[] = []
  let escalated = false
  let toolCallSeq = 0

  rawMessages.forEach((raw, index) => {
    if (!isRecord(raw)) {
      warnings.push(`message ${index + 1}: not an object, skipped`)
      return
    }
    const role = raw.role
    const content = typeof raw.content === 'string' ? raw.content : ''
    const timestamp = toIso(raw.timestamp)
    if (role === 'assistant') {
      const agentType = typeof raw.agent_type === 'string' ? raw.agent_type : undefined
      if (agentType !== undefined) {
        if (!agents.includes(agentType)) agents.push(agentType)
        if (agentType === 'human') escalated = true
      }
      const base: Message = {
        id: '',
        role: 'assistant',
        channel: 'final',
        content,
        ...(timestamp !== undefined ? { timestamp } : {}),
        ...(agentType !== undefined ? { metadata: { agentType } } : {}),
      }
      if (Array.isArray(raw.tool_calls) && raw.tool_calls.length > 0) {
        base.channel = 'commentary'
        base.toolCalls = raw.tool_calls.map((tc) => {
          toolCallSeq += 1
          const rec = isRecord(tc) ? tc : {}
          // Arguments arrive pre-parsed (an object), so serialize for the
          // canonical string field and pass the object through untouched.
          const args = rec.arguments
          return {
            id: typeof rec.id === 'string' && rec.id !== '' ? rec.id : `fc-${toolCallSeq}`,
            name: typeof rec.name === 'string' && rec.name !== '' ? rec.name : 'unknown',
            arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
            parsedArguments: args,
          }
        })
      }
      messages.push(base)
    } else if (role === 'tool') {
      if (typeof raw.tool_name === 'string' && raw.tool_name === 'escalate_to_human') {
        escalated = true
      }
      messages.push({
        id: '',
        role: 'tool',
        content,
        toolResult: {
          toolCallId: typeof raw.tool_call_id === 'string' ? raw.tool_call_id : '',
          isError: isErrorResult(content),
        },
        ...(timestamp !== undefined ? { timestamp } : {}),
      })
    } else if (role === 'system' || role === 'developer' || role === 'user') {
      messages.push({
        id: '',
        role,
        content,
        ...(timestamp !== undefined ? { timestamp } : {}),
      })
    } else {
      warnings.push(`message ${index + 1}: unknown role '${String(role)}', treated as user`)
      messages.push({ id: '', role: 'user', content })
    }
  })

  if (messages.length === 0) {
    return { traces: [], warnings: [...warnings, 'no messages found'] }
  }

  const fileStem = ctx.sourcePath
    ?.split('/')
    .pop()
    ?.replace(/\.[^.]+$/, '')
  const traceId = fileStem !== undefined && fileStem !== '' ? fileStem : `conv-${djb2Hex(text)}`
  const meta: TraceMeta = {
    traceId,
    instanceId: traceId,
    // Primary agent = who handled the conversation first; splits the
    // Categories & datasets tree into one dataset per agent variant.
    component: `conversations/${agents[0] ?? 'unknown'}`,
    status: 'completed',
    timestamp: messages.find((m) => m.timestamp)?.timestamp ?? ctx.fallbackTimestamp ?? EPOCH,
    checkpointStep: 0,
    split: 'train',
    sourceFormat: 'agent-conversation',
    dataLocation: ctx.sourcePath,
    extra: { agents, escalated },
  }

  const statsOverrides: Partial<TraceStats> = truncated ? { truncated: true } : {}
  return {
    traces: [
      {
        meta,
        messages,
        ...(truncated ? { statsOverrides } : {}),
        warnings,
      },
    ],
    warnings: [],
  }
}

export const agentConversationConnector: Connector = {
  id: 'agent-conversation',
  displayName: 'Agent conversation JSON',
  extensions: ['.json'],

  detect(text: string): boolean {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      // Truncated files can't parse; a cheap sniff lets salvage run in parse().
      return /^\s*\{\s*"conversation"\s*:\s*\[/.test(text) && text.includes('"agent_type"')
    }
    return looksLikeAgentConversation(value)
  },

  parse(text: string, ctx: ParseContext): ParseResult {
    try {
      return parseAgentConversation(text, ctx)
    } catch (e) {
      return { traces: [], warnings: [`agent-conversation parse failed: ${errorMessage(e)}`] }
    }
  },
}
