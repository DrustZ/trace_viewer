import type { Message } from '@shared/schema/types'

/**
 * One agent response: all contiguous assistant messages sharing a stepIndex
 * (analysis + commentary + final). Renders as a single StepCard.
 */
export interface StepUnit {
  kind: 'step'
  /** First message id — stable key for the expand/reasoning state maps. */
  id: string
  /** 1-based assistant step; undefined when the source lacks step attribution. */
  stepIndex?: number
  /** Every message in the step, in trace order. */
  messages: Message[]
  /** channel === 'analysis' messages — the nested reasoning widget. */
  analysis: Message[]
  /** Non-analysis messages: commentary (tool calls) and/or the final text. */
  responses: Message[]
}

/** Any non-assistant message (user/system/developer/tool) renders standalone. */
export interface SingleUnit {
  kind: 'single'
  id: string
  message: Message
}

export type RenderUnit = StepUnit | SingleUnit

/**
 * Partition messages into render units. Contiguous assistant messages with the
 * same stepIndex (including both-undefined) fold into one StepUnit; anything
 * else — a role change or a stepIndex change — starts a new unit. Tool results
 * stay standalone: they carry the stepIndex of the step that invoked them but
 * are never nested inside it.
 */
export function buildUnits(messages: Message[]): RenderUnit[] {
  const units: RenderUnit[] = []
  let step: StepUnit | null = null
  for (const message of messages) {
    if (message.role !== 'assistant') {
      step = null
      units.push({ kind: 'single', id: message.id, message })
      continue
    }
    if (step === null || step.stepIndex !== message.stepIndex) {
      step = {
        kind: 'step',
        id: message.id,
        stepIndex: message.stepIndex,
        messages: [],
        analysis: [],
        responses: [],
      }
      units.push(step)
    }
    step.messages.push(message)
    if ((message.channel ?? 'final') === 'analysis') step.analysis.push(message)
    else step.responses.push(message)
  }
  return units
}

/**
 * Duration a unit's rail bar spans: for a step, the sum of its assistant
 * messages' durationMs; for a single message, its own. Undefined when nothing
 * in the unit carries a duration.
 */
export function unitDurationMs(unit: RenderUnit): number | undefined {
  if (unit.kind === 'single') return unit.message.durationMs
  let sum = 0
  let seen = false
  for (const m of unit.messages) {
    if (m.durationMs !== undefined) {
      sum += m.durationMs
      seen = true
    }
  }
  return seen ? sum : undefined
}

/** Per-step score chip: the last defined per-message score (graders score the final piece). */
export function stepScore(unit: StepUnit): number | undefined {
  for (let i = unit.messages.length - 1; i >= 0; i--) {
    const s = unit.messages[i].score
    if (s !== undefined) return s
  }
  return undefined
}

/** Rail/summary classification: a step is a tool-call step when any response invokes tools. */
export function stepHasToolCalls(unit: StepUnit): boolean {
  return unit.responses.some((m) => m.toolCalls !== undefined && m.toolCalls.length > 0)
}
