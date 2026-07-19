import type { Message, Trace } from '@shared/schema/types'

/**
 * ProfSpan contract — profiling spans live in meta.extra.spans (shared/schema
 * stays untouched). When a trace does not carry spans, buildSpanTree derives a
 * usable timeline from the conversation messages.
 */
export type SpanKind = 'trace' | 'io' | 'model' | 'sandbox' | 'grader'
export type SpanStatus = 'ok' | 'error'

export interface ProfSpan {
  /** 'sp-<n>', stable within the trace. */
  id: string
  /** null only for the single root. */
  parentId: string | null
  /** root: traceId; turns: 'turn_<stepIndex>'; leaves: 'assistant.analysis' | '<tool>.exec' | … */
  name: string
  kind: SpanKind
  /** Relative to trace start (meta.timestamp). */
  startMs: number
  durationMs: number
  status: SpanStatus
  /** Links leaf spans to the conversation message ('m-<idx>'). */
  messageId?: string
  detail?: Record<string, unknown>
}

export interface SpanTree {
  spans: ProfSpan[]
  /** true when the spans were derived from messages (no meta.extra.spans). */
  derived: boolean
}

export interface SpanRow {
  span: ProfSpan
  depth: number
  hasChildren: boolean
}

const KINDS: ReadonlySet<string> = new Set(['trace', 'io', 'model', 'sandbox', 'grader'])
const GRADER_TOOLS: ReadonlySet<string> = new Set([
  'math_verify',
  'llm_judge',
  'test_runner',
  'checker',
])

/** Lenient single-span validator — returns null for malformed entries. */
function parseSpan(value: unknown): ProfSpan | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id === '') return null
  if (o.parentId !== null && typeof o.parentId !== 'string') return null
  if (typeof o.name !== 'string' || o.name === '') return null
  if (typeof o.kind !== 'string' || !KINDS.has(o.kind)) return null
  if (typeof o.startMs !== 'number' || !Number.isFinite(o.startMs)) return null
  if (typeof o.durationMs !== 'number' || !Number.isFinite(o.durationMs) || o.durationMs < 0) {
    return null
  }
  if (o.status !== 'ok' && o.status !== 'error') return null
  const span: ProfSpan = {
    id: o.id,
    parentId: o.parentId as string | null,
    name: o.name,
    kind: o.kind as SpanKind,
    startMs: o.startMs,
    durationMs: o.durationMs,
    status: o.status,
  }
  if (typeof o.messageId === 'string') span.messageId = o.messageId
  if (typeof o.detail === 'object' && o.detail !== null && !Array.isArray(o.detail)) {
    span.detail = o.detail as Record<string, unknown>
  }
  return span
}

/** Validate meta.extra.spans leniently; returns null when no usable root survives. */
function validateSpans(raw: unknown[]): ProfSpan[] | null {
  const byId = new Map<string, ProfSpan>()
  for (const entry of raw) {
    const span = parseSpan(entry)
    if (span && !byId.has(span.id)) byId.set(span.id, span)
  }
  const roots = [...byId.values()].filter((s) => s.parentId === null)
  if (roots.length === 0) return null
  // Keep only spans reachable from roots (drops orphans and cycles), children by startMs.
  const children = childrenOf([...byId.values()])
  const ordered: ProfSpan[] = []
  const visit = (span: ProfSpan) => {
    ordered.push(span)
    for (const child of children.get(span.id) ?? []) visit(child)
  }
  for (const root of roots.sort((a, b) => a.startMs - b.startMs)) visit(root)
  return ordered
}

function childrenOf(spans: ProfSpan[]): Map<string, ProfSpan[]> {
  const map = new Map<string, ProfSpan[]>()
  for (const span of spans) {
    if (span.parentId === null || span.parentId === span.id) continue
    const list = map.get(span.parentId)
    if (list) list.push(span)
    else map.set(span.parentId, [span])
  }
  for (const list of map.values()) list.sort((a, b) => a.startMs - b.startMs)
  return map
}

function leafName(
  message: Message,
  toolNames: Map<string, string>,
): { name: string; kind: SpanKind } {
  switch (message.role) {
    case 'assistant': {
      const channel = message.channel ?? 'final'
      return { name: `assistant.${channel}`, kind: 'model' }
    }
    case 'tool': {
      const tool = toolNames.get(message.toolResult?.toolCallId ?? '') ?? 'tool'
      if (GRADER_TOOLS.has(tool)) return { name: tool, kind: 'grader' }
      return { name: `${tool}.exec`, kind: 'sandbox' }
    }
    case 'user':
      return { name: 'user.message', kind: 'io' }
    default:
      // system + developer both carry instructions-in.
      return { name: 'system.message', kind: 'io' }
  }
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n')
  return (nl === -1 ? text : text.slice(0, nl)).slice(0, 300)
}

/** Derive a span tree from messages: root → one turn per stepIndex → leaf per message. */
function deriveSpans(trace: Trace): ProfSpan[] {
  const { meta, stats, messages } = trace
  const rootStatus: SpanStatus = stats.hasError || meta.status === 'failed' ? 'error' : 'ok'
  let n = 0
  const nextId = () => `sp-${n++}`
  const root: ProfSpan = {
    id: nextId(),
    parentId: null,
    name: meta.traceId,
    kind: 'trace',
    startMs: 0,
    durationMs: Math.max(stats.durationMs ?? 0, 1),
    status: rootStatus,
  }
  if (messages.length === 0) return [root]

  // Timing: message timestamps relative to trace start; index-spaced 1s ticks otherwise.
  const times = messages.map((m) => (m.timestamp ? Date.parse(m.timestamp) : Number.NaN))
  const hasTimestamps = times.every((t) => Number.isFinite(t))
  const metaTs = Date.parse(meta.timestamp)
  const base = hasTimestamps ? Math.min(times[0], Number.isFinite(metaTs) ? metaTs : times[0]) : 0
  const startOf = (i: number) => (hasTimestamps ? Math.max(times[i] - base, 0) : i * 1000)
  const durationOf = (i: number) => {
    const explicit = messages[i].durationMs
    if (explicit !== undefined && Number.isFinite(explicit)) return Math.max(explicit, 1)
    if (hasTimestamps && i + 1 < messages.length) return Math.max(times[i + 1] - times[i], 1)
    return 1000
  }

  // Tool-call id → tool name, for '<tool>.exec' leaf names.
  const toolNames = new Map<string, string>()
  for (const m of messages) {
    for (const call of m.toolCalls ?? []) toolNames.set(call.id, call.name)
  }

  const spans: ProfSpan[] = [root]
  const turns = new Map<number, ProfSpan>()
  for (const [i, message] of messages.entries()) {
    let parent = root
    if (message.stepIndex !== undefined) {
      let turn = turns.get(message.stepIndex)
      if (!turn) {
        turn = {
          id: nextId(),
          parentId: root.id,
          name: `turn_${message.stepIndex}`,
          kind: 'trace',
          startMs: startOf(i),
          durationMs: 0,
          status: 'ok',
        }
        turns.set(message.stepIndex, turn)
        spans.push(turn)
      }
      parent = turn
    }
    const { name, kind } = leafName(message, toolNames)
    const isError = message.toolResult?.isError === true
    const leaf: ProfSpan = {
      id: nextId(),
      parentId: parent.id,
      name,
      kind,
      startMs: startOf(i),
      durationMs: durationOf(i),
      status: isError ? 'error' : 'ok',
      messageId: message.id,
    }
    const detail: Record<string, unknown> = {}
    if (message.tokens) detail.tokens_out = message.tokens.length
    if (message.score !== undefined) detail.score = message.score
    if (isError && message.content) detail.exception = firstLine(message.content)
    if (Object.keys(detail).length > 0) leaf.detail = detail
    spans.push(leaf)
  }

  // Stretch turns over their children, then root over everything (incl. any tail).
  const bounds = new Map<string, { start: number; end: number }>()
  for (const span of spans) {
    if (span.parentId === null) continue
    const end = span.startMs + span.durationMs
    const b = bounds.get(span.parentId)
    if (b) {
      b.start = Math.min(b.start, span.startMs)
      b.end = Math.max(b.end, end)
    } else bounds.set(span.parentId, { start: span.startMs, end })
  }
  for (const turn of turns.values()) {
    const b = bounds.get(turn.id)
    if (!b) continue
    turn.startMs = b.start
    turn.durationMs = Math.max(b.end - b.start, 1)
  }
  root.startMs = 0
  root.durationMs = Math.max(
    root.durationMs,
    ...spans.filter((s) => s.parentId === root.id).map((s) => s.startMs + s.durationMs),
  )
  return spans
}

/**
 * Read meta.extra.spans when present (lenient validation), otherwise derive a
 * timeline from the conversation messages so imported traces stay usable.
 */
export function buildSpanTree(trace: Trace): SpanTree {
  const raw = trace.meta.extra?.spans
  if (Array.isArray(raw)) {
    const spans = validateSpans(raw)
    if (spans) return { spans, derived: false }
  }
  return { spans: deriveSpans(trace), derived: true }
}

/** DFS over the tree in startMs order, skipping children of collapsed spans. */
export function flattenVisible(spans: ProfSpan[], collapsedIds: ReadonlySet<string>): SpanRow[] {
  const ids = new Set(spans.map((s) => s.id))
  const children = childrenOf(spans)
  const roots = spans
    .filter((s) => s.parentId === null || !ids.has(s.parentId))
    .sort((a, b) => a.startMs - b.startMs)
  const rows: SpanRow[] = []
  const visit = (span: ProfSpan, depth: number) => {
    const kids = children.get(span.id) ?? []
    rows.push({ span, depth, hasChildren: kids.length > 0 })
    if (collapsedIds.has(span.id)) return
    for (const kid of kids) visit(kid, depth + 1)
  }
  for (const root of roots) visit(root, 0)
  return rows
}
