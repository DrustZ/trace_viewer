import type { Message, TraceMeta } from '../shared/schema/types'
import { messageTokens } from '../shared/stats/computeStats'
import { CANCELLED_RESULT, MALFORMED_RESULT, TIMEOUT_RESULT } from './failures'
import type { Rng } from './rng'

/**
 * ProfSpan — the observability-span contract carried in meta.extra.spans.
 * The shared schema stays untouched; both the generator and the viewer
 * follow exactly this shape.
 */
export interface ProfSpan {
  /** 'sp-<n>' stable within trace. */
  id: string
  /** null only for the single root. */
  parentId: string | null
  /** root: the traceId; turns: 'turn_<stepIndex>'; leaves: e.g. 'assistant.analysis'. */
  name: string
  kind: 'trace' | 'io' | 'model' | 'sandbox' | 'grader'
  /** Relative to trace start (meta.timestamp). */
  startMs: number
  durationMs: number
  status: 'ok' | 'error'
  /** Links leaf spans to the conversation message ('m-<idx>'). */
  messageId?: string
  detail?: Record<string, unknown>
}

/** The slice of TraceStats that span building needs; TraceStats satisfies it structurally. */
export interface SpanStatsish {
  score: number | null
  hasError: boolean
}

/** Above this projected span count, leaf message spans are dropped (turns stay). */
const LEAF_SPAN_CAP = 2000

type GraderName = 'math_verify' | 'llm_judge' | 'test_runner' | 'checker' | 'answer_match'

const GRADER_BY_COMPONENT_TOKEN: ReadonlyArray<readonly [string, GraderName]> = [
  ['deepscaler', 'math_verify'],
  ['nemotron', 'llm_judge'],
  ['swebench', 'test_runner'],
  ['leetcode', 'test_runner'],
  ['terminal', 'checker'],
  ['browsecomp', 'answer_match'],
]

/** Observability noise: the grader hit a transient failure and retried successfully. */
const GRADER_EXCEPTION: Record<GraderName, string> = {
  math_verify: 'VerifierTimeout: retrying (1/3)',
  llm_judge: 'JudgeTimeout: retrying (1/3)',
  test_runner: 'RunnerTimeout: retrying (1/3)',
  checker: 'CheckerTimeout: retrying (1/3)',
  answer_match: 'MatcherTimeout: retrying (1/3)',
}

function graderNameFor(component: string): GraderName | null {
  for (const [token, name] of GRADER_BY_COMPONENT_TOKEN) {
    if (component.includes(token)) return name
  }
  return null
}

function exceptionFor(content: string): string {
  if (content === TIMEOUT_RESULT) return 'TimeoutError: command exceeded 30000ms'
  if (content === MALFORMED_RESULT) return `ArgumentParseError: ${MALFORMED_RESULT}`
  if (content === CANCELLED_RESULT) return CANCELLED_RESULT
  return `ToolError: ${content.split('\n')[0].slice(0, 120)}`
}

interface Window {
  start: number
  dur: number
}

function leafFor(
  m: Message,
  w: Window,
  parentId: string,
  toolNames: ReadonlyMap<string, string>,
  rng: Rng,
): Omit<ProfSpan, 'id'> {
  if (m.role === 'assistant') {
    return {
      parentId,
      name: `assistant.${m.channel ?? 'final'}`,
      kind: 'model',
      startMs: w.start,
      durationMs: w.dur,
      status: 'ok',
      messageId: m.id,
      detail: { tokens_out: messageTokens(m) },
    }
  }
  if (m.role === 'tool' && m.toolResult) {
    const tool = toolNames.get(m.toolResult.toolCallId) ?? 'tool'
    const isSearch = tool === 'search'
    const isError = m.toolResult.isError
    return {
      parentId,
      name: isSearch ? 'search.query' : `${tool}.exec`,
      kind: isSearch ? 'io' : 'sandbox',
      startMs: w.start,
      durationMs: w.dur,
      status: isError ? 'error' : 'ok',
      messageId: m.id,
      ...(isError ? { detail: { exception: exceptionFor(m.content) } } : {}),
    }
  }
  return {
    parentId,
    name: `${m.role}.message`,
    kind: 'io',
    startMs: w.start,
    durationMs: w.dur > 0 ? w.dur : rng.int(3, 9),
    status: 'ok',
    messageId: m.id,
  }
}

function graderBaseDuration(
  name: GraderName,
  messages: readonly Message[],
  windows: readonly Window[],
  rng: Rng,
): number {
  switch (name) {
    case 'math_verify':
      return rng.int(2, 20)
    case 'llm_judge':
      return rng.int(800, 3000)
    case 'test_runner': {
      // Mirror the final test-suite execution: the last tool result is the run.
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].toolResult && windows[i].dur > 0) return windows[i].dur
      }
      return rng.int(500, 5000)
    }
    case 'checker':
      return rng.int(20, 200)
    case 'answer_match':
      return rng.int(1, 10)
  }
}

function graderDetail(
  name: GraderName,
  meta: TraceMeta,
  statsish: SpanStatsish,
): ProfSpan['detail'] {
  if (name === 'test_runner') return { ...(meta.rewardDetails ?? {}) }
  const verdict = statsish.score !== null && statsish.score > 0 ? 'correct' : 'incorrect'
  return { verdict }
}

/**
 * Builds the meta.extra.spans profile for a finalized trace: one root, one
 * 'turn_<stepIndex>' container per assistant step, one leaf per message, plus a
 * component-specific grader tail. Pure — all randomness comes from `rng`, so
 * the same trace + seed yields identical spans. Expects annotated messages
 * (ids 'm-<idx>' and stepIndex assigned by finalizeTrace).
 */
export function buildProfSpans(
  messages: readonly Message[],
  meta: TraceMeta,
  statsish: SpanStatsish,
  rng: Rng,
): ProfSpan[] {
  const traceStart = Date.parse(meta.timestamp)
  let cursor = 0
  const windows: Window[] = messages.map((m) => {
    const start = m.timestamp ? Date.parse(m.timestamp) - traceStart : cursor
    const dur = m.durationMs ?? m.toolResult?.durationMs ?? 0
    cursor = start + dur
    return { start, dur }
  })
  const messageEnd = windows.reduce((acc, w) => Math.max(acc, w.start + w.dur), 0)

  // Turn containers: one per assistant step, spanning that step's messages.
  const stepFirstIdx = new Map<number, number>()
  const stepBounds = new Map<number, Window>()
  messages.forEach((m, i) => {
    if (m.stepIndex === undefined) return
    const w = windows[i]
    if (!stepFirstIdx.has(m.stepIndex)) stepFirstIdx.set(m.stepIndex, i)
    const b = stepBounds.get(m.stepIndex)
    if (b) {
      b.start = Math.min(b.start, w.start)
      b.dur = Math.max(b.dur, w.start + w.dur - b.start)
    } else {
      stepBounds.set(m.stepIndex, { start: w.start, dur: w.dur })
    }
  })

  // Grader tail only when the grader actually ran: executing rollouts have no
  // tail, and failed/cancelled rollouts are ungraded (score null) by contract.
  const graderName = meta.status === 'completed' ? graderNameFor(meta.component) : null
  const graderSpanCount = graderName === 'llm_judge' ? 2 : graderName === null ? 0 : 1
  const projected = 1 + stepBounds.size + messages.length + graderSpanCount
  const includeLeaves = projected <= LEAF_SPAN_CAP

  const rootId = 'sp-1'
  const children: ProfSpan[] = []
  let seq = 1
  const push = (span: Omit<ProfSpan, 'id'>): ProfSpan => {
    seq += 1
    const full: ProfSpan = { id: `sp-${seq}`, ...span }
    children.push(full)
    return full
  }

  const toolNames = new Map<string, string>()
  const turnIds = new Map<number, string>()
  messages.forEach((m, i) => {
    for (const call of m.toolCalls ?? []) toolNames.set(call.id, call.name)
    const step = m.stepIndex
    if (step !== undefined && stepFirstIdx.get(step) === i) {
      const b = stepBounds.get(step) as Window
      const turn = push({
        parentId: rootId,
        name: `turn_${step}`,
        kind: 'io',
        startMs: b.start,
        durationMs: b.dur,
        status: 'ok',
      })
      turnIds.set(step, turn.id)
    }
    if (!includeLeaves) return
    const parentId = step !== undefined ? (turnIds.get(step) as string) : rootId
    push(leafFor(m, windows[i], parentId, toolNames, rng))
  })

  if (graderName !== null) {
    const start = messageEnd + rng.int(15, 120)
    const retried = rng.bernoulli(0.04)
    let duration = graderBaseDuration(graderName, messages, windows, rng)
    if (retried) duration *= rng.int(3, 6)
    const detail = { ...graderDetail(graderName, meta, statsish) }
    if (retried) detail.exception = GRADER_EXCEPTION[graderName]
    const grader = push({
      parentId: rootId,
      name: graderName,
      kind: 'grader',
      startMs: start,
      durationMs: duration,
      status: retried ? 'error' : 'ok',
      detail,
    })
    if (graderName === 'llm_judge') {
      push({
        parentId: grader.id,
        name: 'judge.completion',
        kind: 'model',
        startMs: start + Math.round(duration * 0.05),
        durationMs: Math.round(duration * 0.9),
        status: 'ok',
        detail: { tokens_out: rng.int(60, 240) },
      })
    }
  }

  const rootEnd = children.reduce((acc, s) => Math.max(acc, s.startMs + s.durationMs), messageEnd)
  const root: ProfSpan = {
    id: rootId,
    parentId: null,
    name: meta.traceId,
    kind: 'trace',
    startMs: 0,
    durationMs: rootEnd,
    status: statsish.hasError || meta.status === 'failed' ? 'error' : 'ok',
    ...(includeLeaves ? {} : { detail: { leaf_spans_omitted: true } }),
  }
  return [root, ...children]
}
