import Anthropic from '@anthropic-ai/sdk'
import type {
  MessageCreateParamsNonStreaming,
  MessageParam,
} from '@anthropic-ai/sdk/resources/messages'
import { z } from 'zod'
import { FILTER_KEYS } from '../../shared/filter/keys'
import { recordedCheckpoint } from '../../shared/schema/provenance'
import type { Trace, TraceSummary } from '../../shared/schema/types'
import { runOf } from '../../shared/stats/evolution'
import { firstParam, type RouteCtx } from '../routes/context'
import { appliedSummaries } from '../routes/listParams'

/**
 * AI analysis agent: a claude tool-use loop over the trace store. The model
 * plans, gathers evidence via read-only tools (direct store calls, no HTTP),
 * then emits a structured report through a final `emit_report` tool.
 */

const MAX_TURNS = 8
const TOTAL_TIMEOUT_MS = 90_000
const MAX_TOKENS = 2000
const LIST_DEFAULT_LIMIT = 20
const LIST_MAX_LIMIT = 50
const SEARCH_MAX_LIMIT = 20
const GET_TRACE_DEFAULT_CHARS = 6000
const GET_TRACE_MAX_CHARS = 24_000
const MESSAGE_CLAMP = 600
/** Upper bound for a serialized tool result fed back into the context. */
const TOOL_RESULT_CLAMP = 16_000
const TRUNCATION_MARK = '[…truncated]'

export interface AnalysisFinding {
  traceId: string
  note: string
}

export interface AnalysisReport {
  summary: string
  findings: AnalysisFinding[]
  suggestedFilter?: string
  confidence?: string
}

export interface AnalysisStep {
  tool: string
  input: unknown
  tookMs: number
}

export interface AnalysisResponse {
  report: AnalysisReport
  steps: AnalysisStep[]
}

/** Minimal client surface used here — a seam so tests can inject a fake. */
export interface AnalystClient {
  messages: {
    create(
      params: MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<{ content: unknown }>
  }
}

/** Carries the HTTP status the route should answer with (503 no key, 502 upstream). */
export class AnalysisError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AnalysisError'
  }
}

let singleton: AnalystClient | null = null

function getClient(): AnalystClient {
  if (!singleton) singleton = new Anthropic()
  return singleton
}

function clamp(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}${TRUNCATION_MARK}`
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const EMIT_REPORT = 'emit_report'

const TOOLS: MessageCreateParamsNonStreaming['tools'] = [
  {
    name: 'list_traces',
    description:
      'List condensed trace summaries, optionally filtered/sorted. Use the filter DSL for precise slices.',
    input_schema: {
      type: 'object',
      properties: {
        filters: {
          type: 'string',
          description:
            "Filter DSL: 'key.op.value' segments joined by ';' (e.g. 'status.eq.failed;turns.gt.20')",
        },
        component: { type: 'string', description: 'Exact component name' },
        split: { type: 'string', enum: ['train', 'test', 'unknown'] },
        status: { type: 'string', enum: ['completed', 'failed', 'executing', 'unknown'] },
        sort: { type: 'string', description: "'time' (default) or any filter key id" },
        order: { type: 'string', enum: ['asc', 'desc'] },
        limit: {
          type: 'number',
          description: `Max ${LIST_MAX_LIMIT}, default ${LIST_DEFAULT_LIMIT}`,
        },
      },
    },
  },
  {
    name: 'aggregate',
    description: 'Compact aggregate rows (count, status mix, avg score/turns) grouped by one key.',
    input_schema: {
      type: 'object',
      properties: {
        groupBy: { type: 'string', enum: ['component', 'step', 'status'] },
      },
      required: ['groupBy'],
    },
  },
  {
    name: 'aggregate_instances',
    description:
      'Group rollouts by instance (task) and compute per-group score stats. THE tool for group/instance-level average-reward questions — the per-trace filter DSL cannot express group averages.',
    input_schema: {
      type: 'object',
      properties: {
        step: { type: 'number', description: 'Restrict to one checkpoint step' },
        component: { type: 'string', description: 'Exact component name' },
        run: { type: 'string', description: 'Restrict to one run id' },
        avgBelow: { type: 'number', description: 'Keep groups with avgScore < this' },
        avgAtLeast: { type: 'number', description: 'Keep groups with avgScore >= this' },
        limit: { type: 'number', description: `Max ${LIST_MAX_LIMIT}, default ${LIST_MAX_LIMIT}` },
      },
    },
  },
  {
    name: 'get_trace',
    description: 'Fetch one trace in full: meta + stats + numbered messages (content clamped).',
    input_schema: {
      type: 'object',
      properties: {
        traceId: { type: 'string' },
        maxChars: {
          type: 'number',
          description: `Total character budget for messages, default ${GET_TRACE_DEFAULT_CHARS}`,
        },
      },
      required: ['traceId'],
    },
  },
  {
    name: 'search_traces',
    description: 'Full-text search over message contents. Returns trace ids with snippets.',
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        limit: { type: 'number', description: `Max ${SEARCH_MAX_LIMIT}` },
      },
      required: ['q'],
    },
  },
  {
    name: EMIT_REPORT,
    description:
      'REQUIRED final step: emit your conclusions. Call this exactly once when you are done gathering evidence.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Markdown answer to the user question' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              traceId: { type: 'string', description: 'A trace id you actually observed' },
              note: { type: 'string', description: 'Why this trace is evidence' },
            },
            required: ['traceId', 'note'],
          },
        },
        suggestedFilter: {
          type: 'string',
          description: 'Optional filter DSL string that isolates the relevant traces',
        },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['summary', 'findings'],
    },
  },
]

function buildSystemPrompt(): string {
  const keyLines = FILTER_KEYS.map((k) => `- ${k.id} (${k.type}): ${k.description}`).join('\n')
  return `You are an AI analysis agent embedded in an RL training trace viewer. The store holds rollout traces, each with meta (traceId, component, dataset split, checkpoint step, status) and stats (score, turns, toolUses, tokens, truncated, hasError). Split, status, and checkpoint may be unknown; a null checkpoint means the source did not record one and must not be interpreted as step 0.

Tools: list_traces (filtered summaries), aggregate (grouped stats), aggregate_instances (per-instance group score averages), get_trace (one trace with messages), search_traces (full-text), and emit_report (your final answer — always call it exactly once at the end).

The filter DSL is strictly per-trace: 'score.lt.0.5' matches individual rollouts, NOT groups by average — on 0/1-scored data it returns only zero-score rollouts. For questions about instances/groups by average reward, use aggregate_instances. Example: 'groups at step 125 with avg reward < 0.5' -> aggregate_instances {"step":125,"avgBelow":0.5}.

Filter DSL (for list_traces filters and suggestedFilter): 'key.op.value' segments joined by ';'. Ops: eq, neq, lt, lte, gt, gte, contains, in ('in' values joined by '|'). Keys:
${keyLines}

Plan briefly, gather evidence with a few tool calls, then answer by calling emit_report with: a concise markdown summary, findings citing traceIds you actually observed, and (when a filter would help the user see the evidence) a suggested filter DSL string.`
}

// ---------------------------------------------------------------------------
// Tool execution — direct store calls, not HTTP
// ---------------------------------------------------------------------------

function toNumber(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}

/** Summary condensed to the fields the model needs (plus kl/end_reason extras). */
function condenseSummary(s: TraceSummary): Record<string, unknown> {
  const step = recordedCheckpoint(s.meta)
  const row: Record<string, unknown> = {
    traceId: s.meta.traceId,
    component: s.meta.component,
    step,
    checkpointRecorded: step !== null,
    split: s.meta.split,
    status: s.meta.status,
    score: s.stats.score,
    turns: s.stats.turns,
    toolUses: s.stats.toolUses,
    durationMs: s.stats.durationMs ?? null,
    hasError: s.stats.hasError,
    truncated: s.stats.truncated,
  }
  if (s.meta.extra?.kl !== undefined) row.kl = s.meta.extra.kl
  if (s.meta.extra?.end_reason !== undefined) row.end_reason = s.meta.extra.end_reason
  return row
}

function listTraces(ctx: RouteCtx, input: Record<string, unknown>): unknown {
  const query: Record<string, unknown> = {}
  for (const key of ['filters', 'component', 'split', 'status', 'sort', 'order'] as const) {
    const value = firstParam(input[key])
    if (value) query[key] = value
  }
  const items = appliedSummaries(ctx, query)
  const limit = toNumber(input.limit, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT)
  return { total: items.length, items: items.slice(0, limit).map(condenseSummary) }
}

function aggregate(ctx: RouteCtx, input: Record<string, unknown>): unknown {
  const groupBy = input.groupBy
  if (groupBy !== 'component' && groupBy !== 'step' && groupBy !== 'status') {
    return { error: "groupBy must be 'component', 'step' or 'status'" }
  }
  const keyOf = (s: TraceSummary): string =>
    groupBy === 'component'
      ? s.meta.component
      : groupBy === 'step'
        ? String(recordedCheckpoint(s.meta) ?? 'unknown')
        : s.meta.status
  const groups = new Map<string, TraceSummary[]>()
  for (const s of ctx.store.list()) {
    const key = keyOf(s)
    const at = groups.get(key)
    if (at) at.push(s)
    else groups.set(key, [s])
  }
  const rows = [...groups.entries()].map(([key, items]) => {
    const scores = items.map((s) => s.stats.score).filter((v): v is number => v !== null)
    return {
      [groupBy]: key,
      count: items.length,
      completed: items.filter((s) => s.meta.status === 'completed').length,
      failed: items.filter((s) => s.meta.status === 'failed').length,
      executing: items.filter((s) => s.meta.status === 'executing').length,
      unknown: items.filter((s) => s.meta.status === 'unknown').length,
      avgScore: scores.length > 0 ? scores.reduce((acc, v) => acc + v, 0) / scores.length : null,
      avgTurns: items.reduce((acc, s) => acc + s.stats.turns, 0) / items.length,
      truncated: items.filter((s) => s.stats.truncated).length,
      hasError: items.filter((s) => s.stats.hasError).length,
    }
  })
  return { rows }
}

/**
 * Per-instance group aggregation with optional avgScore bounds — group-average
 * semantics the per-trace filter DSL cannot express. Groups with a null
 * avgScore are excluded by either bound.
 */
function aggregateInstances(ctx: RouteCtx, input: Record<string, unknown>): unknown {
  let items = ctx.store.list()
  const step =
    typeof input.step === 'number' ? input.step : Number(firstParam(input.step) ?? Number.NaN)
  if (Number.isFinite(step)) items = items.filter((s) => recordedCheckpoint(s.meta) === step)
  const component = firstParam(input.component)
  if (component) items = items.filter((s) => s.meta.component === component)
  const run = firstParam(input.run)
  if (run) items = items.filter((s) => runOf(s) === run)

  const groups = new Map<string, TraceSummary[]>()
  for (const s of items) {
    const at = groups.get(s.meta.instanceId)
    if (at) at.push(s)
    else groups.set(s.meta.instanceId, [s])
  }
  let rows = [...groups.entries()].map(([instanceId, group]) => {
    const scores = group.map((s) => s.stats.score).filter((v): v is number => v !== null)
    const knownSteps = group.flatMap((s) => {
      const recorded = recordedCheckpoint(s.meta)
      return recorded === null ? [] : [recorded]
    })
    return {
      instanceId,
      component: group[0].meta.component,
      steps: [...new Set(knownSteps)].sort((a, b) => a - b),
      checkpointUnavailable: knownSteps.length !== group.length,
      rollouts: group.length,
      avgScore: scores.length > 0 ? scores.reduce((acc, v) => acc + v, 0) / scores.length : null,
      minScore: scores.length > 0 ? Math.min(...scores) : null,
      maxScore: scores.length > 0 ? Math.max(...scores) : null,
    }
  })
  const avgBelow = typeof input.avgBelow === 'number' ? input.avgBelow : undefined
  if (avgBelow !== undefined)
    rows = rows.filter((r) => r.avgScore !== null && r.avgScore < avgBelow)
  const avgAtLeast = typeof input.avgAtLeast === 'number' ? input.avgAtLeast : undefined
  if (avgAtLeast !== undefined) {
    rows = rows.filter((r) => r.avgScore !== null && r.avgScore >= avgAtLeast)
  }
  rows.sort((a, b) => {
    if (a.avgScore !== b.avgScore) {
      if (a.avgScore === null) return 1
      if (b.avgScore === null) return -1
      return a.avgScore - b.avgScore
    }
    return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0
  })
  const limit = toNumber(input.limit, LIST_MAX_LIMIT, LIST_MAX_LIMIT)
  return { total: rows.length, rows: rows.slice(0, limit) }
}

/** Meta + stats + numbered messages, clamped to a total character budget. */
export function condenseTrace(trace: Trace, maxChars: number): unknown {
  const messages: string[] = []
  let used = 0
  for (let i = 0; i < trace.messages.length; i++) {
    const m = trace.messages[i]
    const channel = m.channel ? `/${m.channel}` : ''
    const tools = m.toolCalls?.length
      ? ` [tool calls: ${m.toolCalls.map((t) => t.name).join(', ')}]`
      : ''
    const toolResult = m.toolResult ? ` [tool result${m.toolResult.isError ? ' ERROR' : ''}]` : ''
    const line = `#${i + 1} ${m.role}${channel}${tools}${toolResult}: ${clamp(m.content, MESSAGE_CLAMP)}`
    if (used + line.length > maxChars) {
      messages.push(`${TRUNCATION_MARK} (${trace.messages.length - i} more messages omitted)`)
      break
    }
    used += line.length
    messages.push(line)
  }
  const extraJson = trace.meta.extra ? JSON.stringify(trace.meta.extra) : ''
  return {
    ...condenseSummary({ meta: trace.meta, stats: trace.stats }),
    instanceId: trace.meta.instanceId,
    ...(trace.meta.rewardDetails ? { rewardDetails: trace.meta.rewardDetails } : {}),
    ...(extraJson !== '' ? { extra: clamp(extraJson, 2000) } : {}),
    ...(trace.warnings?.length ? { warnings: trace.warnings } : {}),
    tokens: {
      input: trace.stats.inputTokens,
      output: trace.stats.outputTokens,
      thinking: trace.stats.thinkingTokens,
    },
    messages,
  }
}

function getTrace(ctx: RouteCtx, input: Record<string, unknown>): unknown {
  const trace = ctx.store.getFull(String(input.traceId ?? ''))
  if (!trace) return { error: `trace not found: ${String(input.traceId ?? '')}` }
  const maxChars = toNumber(input.maxChars, GET_TRACE_DEFAULT_CHARS, GET_TRACE_MAX_CHARS)
  return condenseTrace(trace, maxChars)
}

function searchTraces(ctx: RouteCtx, input: Record<string, unknown>): unknown {
  const q = typeof input.q === 'string' ? input.q.trim() : ''
  if (q.length < 2) return { error: 'q must be at least 2 characters' }
  const limit = toNumber(input.limit, SEARCH_MAX_LIMIT, SEARCH_MAX_LIMIT)
  return { hits: ctx.searchIndex.search(q, limit) }
}

/** Dispatches one tool call against the store. Never throws — errors become result payloads. */
export function executeTool(ctx: RouteCtx, name: string, rawInput: unknown): unknown {
  const input: Record<string, unknown> =
    typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  try {
    switch (name) {
      case 'list_traces':
        return listTraces(ctx, input)
      case 'aggregate':
        return aggregate(ctx, input)
      case 'aggregate_instances':
        return aggregateInstances(ctx, input)
      case 'get_trace':
        return getTrace(ctx, input)
      case 'search_traces':
        return searchTraces(ctx, input)
      default:
        return { error: `unknown tool: ${name}` }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'tool execution failed' }
  }
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

function isToolUse(block: unknown): block is ToolUseBlock {
  if (typeof block !== 'object' || block === null) return false
  const rec = block as Record<string, unknown>
  return rec.type === 'tool_use' && typeof rec.id === 'string' && typeof rec.name === 'string'
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

const reportSchema = z.object({
  summary: z.string(),
  findings: z.array(z.object({ traceId: z.string(), note: z.string() })).default([]),
  suggestedFilter: z.string().optional(),
  confidence: z.string().optional(),
})

function parseReport(input: unknown, fallbackSummary: string): AnalysisReport {
  const parsed = reportSchema.safeParse(input)
  if (!parsed.success) {
    return {
      summary: fallbackSummary || 'The analysis agent did not produce a valid report.',
      findings: [],
    }
  }
  return {
    summary: parsed.data.summary,
    findings: parsed.data.findings,
    ...(parsed.data.suggestedFilter ? { suggestedFilter: parsed.data.suggestedFilter } : {}),
    ...(parsed.data.confidence ? { confidence: parsed.data.confidence } : {}),
  }
}

export async function runAnalysis(
  ctx: RouteCtx,
  query: string,
  client?: AnalystClient,
): Promise<AnalysisResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AnalysisError(503, 'AI analysis requires ANTHROPIC_API_KEY')
  }
  const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS)
  const steps: AnalysisStep[] = []
  const messages: MessageParam[] = [{ role: 'user', content: query }]
  let lastText = ''

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await (client ?? getClient()).messages.create(
        {
          model: process.env.AI_ANALYSIS_MODEL ?? 'claude-sonnet-5',
          max_tokens: MAX_TOKENS,
          system: buildSystemPrompt(),
          messages,
          tools: TOOLS,
          tool_choice: { type: 'auto' },
        },
        { signal },
      )

      const text = extractText(response.content)
      if (text !== '') lastText = text

      const toolUses = Array.isArray(response.content) ? response.content.filter(isToolUse) : []
      const reportCall = toolUses.find((t) => t.name === EMIT_REPORT)
      if (reportCall) {
        steps.push({ tool: EMIT_REPORT, input: reportCall.input, tookMs: 0 })
        return { report: parseReport(reportCall.input, lastText), steps }
      }
      // No tool call → the model answered in plain text; wrap it as the summary.
      if (toolUses.length === 0) break

      // Echo the assistant content back verbatim (preserves thinking blocks etc.).
      messages.push({ role: 'assistant', content: response.content as MessageParam['content'] })
      const results: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
      for (const call of toolUses) {
        const started = Date.now()
        const output = executeTool(ctx, call.name, call.input)
        steps.push({ tool: call.name, input: call.input, tookMs: Date.now() - started })
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: clamp(JSON.stringify(output), TOOL_RESULT_CLAMP),
        })
      }
      messages.push({ role: 'user', content: results })
    }
    return {
      report: {
        summary: lastText || 'The analysis agent returned no answer.',
        findings: [],
      },
      steps,
    }
  } catch (err) {
    if (err instanceof AnalysisError) throw err
    throw new AnalysisError(502, err instanceof Error ? err.message : 'AI analysis failed')
  }
}
