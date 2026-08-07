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

interface IndexedToolCall {
  id: string
  name: string
  messageIndex: number
}

type ToolCallMatch = 'exact' | 'tool-name' | 'single-pending' | 'unmatched'

interface ResolvedToolResult {
  toolCallId: string
  match: ToolCallMatch
  sourceToolCallId?: string
}

/**
 * Index source-provided call ids up front. Some captured conversations place a
 * tool result before the assistant message that emitted the matching call, so
 * exact ids must be recognized independently of message order.
 */
function indexSourceToolCalls(rawMessages: unknown[]): Map<string, IndexedToolCall[]> {
  const indexed = new Map<string, IndexedToolCall[]>()
  rawMessages.forEach((raw, messageIndex) => {
    if (!isRecord(raw) || !Array.isArray(raw.tool_calls)) return
    for (const candidate of raw.tool_calls) {
      if (!isRecord(candidate) || typeof candidate.id !== 'string' || candidate.id === '') {
        continue
      }
      const call: IndexedToolCall = {
        id: candidate.id,
        name:
          typeof candidate.name === 'string' && candidate.name !== '' ? candidate.name : 'unknown',
        messageIndex,
      }
      const existing = indexed.get(call.id)
      if (existing) existing.push(call)
      else indexed.set(call.id, [call])
    }
  })
  return indexed
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
  let repairedToolResultLinks = 0
  let unmatchedToolResults = 0
  let toolErrors = 0
  let timestampRegressions = 0
  let previousTimestamp: number | undefined
  const indexedCalls = indexSourceToolCalls(rawMessages)
  const pendingCalls: IndexedToolCall[] = []
  const matchedCallIds = new Set<string>()

  const resolveToolResult = (
    rawId: unknown,
    rawName: unknown,
    messageIndex: number,
  ): ResolvedToolResult => {
    const sourceId = typeof rawId === 'string' && rawId !== '' ? rawId : undefined
    const sourceName = typeof rawName === 'string' && rawName !== '' ? rawName : undefined

    if (sourceId !== undefined) {
      const exact = indexedCalls.get(sourceId)
      const generatedExact = pendingCalls.filter((call) => call.id === sourceId)
      const candidates = exact ?? generatedExact
      if (
        candidates.length === 1 &&
        !matchedCallIds.has(sourceId) &&
        (sourceName === undefined || candidates[0].name === sourceName)
      ) {
        matchedCallIds.add(sourceId)
        return { toolCallId: sourceId, match: 'exact' }
      }

      // An explicit id that is duplicated, already consumed, or conflicts with
      // tool_name is not safe to redirect to a different call by name.
      if (candidates.length > 0) {
        return {
          toolCallId: '',
          match: 'unmatched',
          sourceToolCallId: sourceId,
        }
      }
    }

    if (sourceName !== undefined) {
      const sameName = pendingCalls.filter(
        (call) =>
          call.messageIndex < messageIndex &&
          call.name === sourceName &&
          !matchedCallIds.has(call.id),
      )
      // A name-only repair is safe only when it identifies exactly one prior
      // unmatched call. "Most recent" is deterministic but can silently swap
      // results when an assistant emits multiple calls to the same tool.
      if (sameName.length === 1) {
        matchedCallIds.add(sameName[0].id)
        return {
          toolCallId: sameName[0].id,
          match: 'tool-name',
          ...(sourceId !== undefined ? { sourceToolCallId: sourceId } : {}),
        }
      }
    } else if (sourceId === undefined) {
      const unmatched = pendingCalls.filter(
        (call) => call.messageIndex < messageIndex && !matchedCallIds.has(call.id),
      )
      if (unmatched.length === 1) {
        matchedCallIds.add(unmatched[0].id)
        return { toolCallId: unmatched[0].id, match: 'single-pending' }
      }
    }

    return {
      // An empty canonical id explicitly means "unlinked". Keeping an unknown
      // source id here could accidentally collide with a generated call id;
      // the raw id remains available in metadata for inspection.
      toolCallId: '',
      match: 'unmatched',
      ...(sourceId !== undefined ? { sourceToolCallId: sourceId } : {}),
    }
  }

  rawMessages.forEach((raw, index) => {
    if (!isRecord(raw)) {
      warnings.push(`message ${index + 1}: not an object, skipped`)
      return
    }
    const role = raw.role
    const content = typeof raw.content === 'string' ? raw.content : ''
    const timestamp = toIso(raw.timestamp)
    const sourceTimestampSeconds =
      typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)
        ? raw.timestamp
        : undefined
    if (sourceTimestampSeconds !== undefined) {
      if (previousTimestamp !== undefined && sourceTimestampSeconds < previousTimestamp) {
        timestampRegressions += 1
      }
      previousTimestamp = sourceTimestampSeconds
    }
    if (role === 'assistant') {
      const agentType = typeof raw.agent_type === 'string' ? raw.agent_type : undefined
      if (agentType !== undefined) {
        if (!agents.includes(agentType)) agents.push(agentType)
        if (agentType === 'human') escalated = true
      }
      const base: Message = {
        id: `m-${index}`,
        role: 'assistant',
        channel: 'final',
        content,
        rawIndex: index,
        ...(timestamp !== undefined ? { timestamp } : {}),
        ...(agentType !== undefined || sourceTimestampSeconds !== undefined
          ? {
              metadata: {
                ...(agentType !== undefined ? { agentType } : {}),
                ...(sourceTimestampSeconds !== undefined ? { sourceTimestampSeconds } : {}),
              },
            }
          : {}),
      }
      if (Array.isArray(raw.tool_calls) && raw.tool_calls.length > 0) {
        base.channel = 'commentary'
        base.toolCalls = raw.tool_calls.map((tc) => {
          toolCallSeq += 1
          const rec = isRecord(tc) ? tc : {}
          // Arguments arrive pre-parsed (an object), so serialize for the
          // canonical string field and pass the object through untouched.
          const args = rec.arguments
          const call = {
            id: typeof rec.id === 'string' && rec.id !== '' ? rec.id : `fc-${toolCallSeq}`,
            name: typeof rec.name === 'string' && rec.name !== '' ? rec.name : 'unknown',
            arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
            parsedArguments: args,
          }
          pendingCalls.push({ id: call.id, name: call.name, messageIndex: index })
          return call
        })
      }
      messages.push(base)
    } else if (role === 'tool') {
      const toolName =
        typeof raw.tool_name === 'string' && raw.tool_name !== '' ? raw.tool_name : undefined
      if (toolName === 'escalate_to_human') {
        escalated = true
      }
      const resolved = resolveToolResult(raw.tool_call_id, raw.tool_name, index)
      if (resolved.match === 'tool-name' || resolved.match === 'single-pending') {
        repairedToolResultLinks += 1
        warnings.push(
          `message ${index + 1}: linked tool result to '${resolved.toolCallId}' by ${
            resolved.match === 'tool-name' ? `tool_name '${toolName}'` : 'the only pending call'
          }`,
        )
      } else if (resolved.match === 'unmatched') {
        unmatchedToolResults += 1
        warnings.push(
          `message ${index + 1}: tool result could not be safely linked to an assistant call`,
        )
      }
      const isError = isErrorResult(content)
      if (isError) toolErrors += 1
      const metadata: Record<string, unknown> = { toolCallMatch: resolved.match }
      if (toolName !== undefined) metadata.toolName = toolName
      if (sourceTimestampSeconds !== undefined) {
        metadata.sourceTimestampSeconds = sourceTimestampSeconds
      }
      if (resolved.sourceToolCallId !== undefined) {
        metadata.sourceToolCallId = resolved.sourceToolCallId
      }
      messages.push({
        id: `m-${index}`,
        role: 'tool',
        content,
        rawIndex: index,
        toolResult: {
          toolCallId: resolved.toolCallId,
          isError,
        },
        metadata,
        ...(timestamp !== undefined ? { timestamp } : {}),
      })
    } else if (role === 'system' || role === 'developer' || role === 'user') {
      messages.push({
        id: `m-${index}`,
        role,
        content,
        rawIndex: index,
        ...(timestamp !== undefined ? { timestamp } : {}),
        ...(sourceTimestampSeconds !== undefined ? { metadata: { sourceTimestampSeconds } } : {}),
      })
    } else {
      warnings.push(`message ${index + 1}: unknown role '${String(role)}', treated as user`)
      messages.push({
        id: `m-${index}`,
        role: 'user',
        content,
        rawIndex: index,
        ...(timestamp !== undefined ? { timestamp } : {}),
        ...(sourceTimestampSeconds !== undefined ? { metadata: { sourceTimestampSeconds } } : {}),
      })
    }
  })

  if (messages.length === 0) {
    return { traces: [], warnings: [...warnings, 'no messages found'] }
  }

  // ACE records the producer position and timestamp independently.  Preserve
  // the former as rawIndex, but display a fully timestamped conversation in
  // chronological order.  A partially timestamped trace stays in source order
  // because guessing where unstamped messages belong would corrupt tool/turn
  // causality.
  if (messages.every((message) => message.timestamp !== undefined)) {
    messages.sort((a, b) => {
      const byTime = Date.parse(a.timestamp as string) - Date.parse(b.timestamp as string)
      return byTime !== 0 ? byTime : (a.rawIndex ?? 0) - (b.rawIndex ?? 0)
    })
  }
  messages.forEach((message, chronologicalIndex) => {
    message.chronologicalIndex = chronologicalIndex
  })

  if (timestampRegressions > 0) {
    warnings.push(
      `${timestampRegressions} timestamp regression(s) found in source order; chronological display order was applied`,
    )
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
    // This format records messages, not a lifecycle or task verdict. Do not
    // infer either from the presence of a final message or a tool error.
    status: 'unknown',
    timestamp: messages.find((m) => m.timestamp)?.timestamp ?? ctx.fallbackTimestamp ?? EPOCH,
    checkpointStep: 0,
    split: 'unknown',
    sourceFormat: 'agent-conversation',
    dataLocation: ctx.sourcePath,
    extra: {
      agents,
      escalated,
      lifecycle: { state: 'unknown', provenance: 'not_provided_by_source' },
      outcome: {
        state: 'unknown',
        provenance: 'not_provided_by_source',
        observations: [
          ...(toolErrors > 0 ? ['tool_error'] : []),
          ...(truncated ? ['truncated_source'] : []),
        ],
      },
      normalization: {
        status: 'source_missing',
        split: 'source_missing',
        checkpointStep: 'default',
      },
      dataQuality: {
        timestampRegressions,
        repairedToolResultLinks,
        unmatchedToolResults,
      },
    },
  }

  const statsOverrides: Partial<TraceStats> = truncated ? { truncated: true, hasError: true } : {}
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
