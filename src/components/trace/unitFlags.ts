import type { Trace } from '@shared/schema/types'
import type { RenderUnit, StepUnit } from './unitize'

/** Tool-result content longer than this flags 'output too long'. */
export const OUTPUT_TOO_LONG_CHARS = 4000

/** Resolve a tool call id to the tool name via the calls recorded in the trace. */
function toolCallName(trace: Trace, callId: string): string | undefined {
  for (const m of trace.messages) {
    const call = m.toolCalls?.find((c) => c.id === callId)
    if (call) return call.name
  }
  return undefined
}

/** True when the step re-issues the tool whose result immediately before it failed. */
function isRetry(unit: StepUnit, trace: Trace): boolean {
  const names = new Set<string>()
  for (const m of unit.responses) {
    for (const c of m.toolCalls ?? []) names.add(c.name)
  }
  if (names.size === 0) return false
  const firstId = unit.messages[0]?.id
  const index = trace.messages.findIndex((m) => m.id === firstId)
  if (index <= 0) return false
  const prev = trace.messages[index - 1]
  if (prev.role !== 'tool' || prev.toolResult?.isError !== true) return false
  const failedName = toolCallName(trace, prev.toolResult.toolCallId)
  return failedName !== undefined && names.has(failedName)
}

/** True when the unit contains the trace's last assistant message. */
function isLastAssistantUnit(unit: StepUnit, trace: Trace): boolean {
  for (let i = trace.messages.length - 1; i >= 0; i--) {
    const m = trace.messages[i]
    if (m.role === 'assistant') return unit.messages.some((own) => own.id === m.id)
  }
  return false
}

/**
 * Warning badges for a compact-rail cell:
 * - 'output too long' — tool result content > OUTPUT_TOO_LONG_CHARS
 * - 'timeout' — tool result content contains TIMEOUT
 * - 'malformed JSON' — any tool call in the unit carries a parseError
 * - 'retry' — a step whose tool call repeats the immediately-previous failed call
 * - 'truncated' — trace.stats.truncated, shown on the last assistant unit
 */
export function unitFlags(unit: RenderUnit, trace: Trace): string[] {
  const flags: string[] = []
  if (unit.kind === 'single') {
    const m = unit.message
    if (m.toolCalls?.some((c) => c.parseError !== undefined)) flags.push('malformed JSON')
    if (m.role === 'tool') {
      if (m.content.length > OUTPUT_TOO_LONG_CHARS) flags.push('output too long')
      if (m.content.includes('TIMEOUT')) flags.push('timeout')
    }
    return flags
  }
  if (unit.messages.some((m) => m.toolCalls?.some((c) => c.parseError !== undefined))) {
    flags.push('malformed JSON')
  }
  if (isRetry(unit, trace)) flags.push('retry')
  if (trace.stats.truncated && isLastAssistantUnit(unit, trace)) flags.push('truncated')
  return flags
}
