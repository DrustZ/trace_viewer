import { withDefaultCheckpointProvenance } from '../schema/provenance'
import type { Message, TraceEvaluation, TraceMeta, TraceStats, TraceStatus } from '../schema/types'
import type { Connector, ParseContext, ParsedTrace, ParseResult } from './types'

const EPOCH = '1970-01-01T00:00:00.000Z'
const KNOWN_TOP_LEVEL = new Set(['meta', 'messages', 'stats', 'evaluation', 'warnings'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asStatus(value: unknown): TraceStatus | undefined {
  return value === 'completed' || value === 'failed' || value === 'executing' || value === 'unknown'
    ? value
    : undefined
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isNativeEntry(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    isRecord(value.meta) &&
    typeof value.meta.traceId === 'string' &&
    Array.isArray(value.messages)
  )
}

function buildTrace(entry: Record<string, unknown>, ctx: ParseContext): ParsedTrace {
  const sourceMeta = entry.meta as Record<string, unknown>
  const traceId = sourceMeta.traceId as string
  const extra: Record<string, unknown> = isRecord(sourceMeta.extra) ? { ...sourceMeta.extra } : {}
  for (const [key, value] of Object.entries(entry)) {
    if (!KNOWN_TOP_LEVEL.has(key)) extra[key] = value
  }
  const hasSourceCheckpoint = typeof sourceMeta.checkpointStep === 'number'
  const normalizedExtra = hasSourceCheckpoint ? extra : withDefaultCheckpointProvenance(extra)
  const meta: TraceMeta = {
    ...(sourceMeta as Partial<TraceMeta>),
    traceId,
    instanceId: asString(sourceMeta.instanceId) ?? traceId,
    component: asString(sourceMeta.component) ?? 'imported/native',
    status: asStatus(sourceMeta.status) ?? 'completed',
    timestamp: asString(sourceMeta.timestamp) ?? ctx.fallbackTimestamp ?? EPOCH,
    checkpointStep: hasSourceCheckpoint ? (sourceMeta.checkpointStep as number) : 0,
    split:
      sourceMeta.split === 'test' || sourceMeta.split === 'unknown' ? sourceMeta.split : 'train',
    sourceFormat: asString(sourceMeta.sourceFormat) ?? 'native',
    dataLocation: asString(sourceMeta.dataLocation) ?? ctx.sourcePath,
  }
  if (Object.keys(normalizedExtra).length > 0) meta.extra = normalizedExtra
  const warnings = Array.isArray(entry.warnings)
    ? entry.warnings.filter((w): w is string => typeof w === 'string')
    : []
  return {
    meta,
    messages: entry.messages as Message[],
    ...(isRecord(entry.evaluation)
      ? { evaluation: entry.evaluation as unknown as TraceEvaluation }
      : {}),
    ...(isRecord(entry.stats) ? { statsOverrides: entry.stats as Partial<TraceStats> } : {}),
    warnings,
  }
}

function collectEntries(
  text: string,
  warnings: string[],
): Array<{ value: unknown; label: string }> {
  const entries: Array<{ value: unknown; label: string }> = []
  let whole: unknown
  let wholeParsed = false
  try {
    whole = JSON.parse(text)
    wholeParsed = true
  } catch {
    // fall through to JSONL
  }
  if (wholeParsed) {
    if (Array.isArray(whole)) {
      whole.forEach((value, i) => {
        entries.push({ value, label: `entry ${i + 1}` })
      })
    } else {
      entries.push({ value: whole, label: 'document' })
    }
    return entries
  }
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return
    try {
      entries.push({ value: JSON.parse(line), label: `line ${i + 1}` })
    } catch (e) {
      warnings.push(`line ${i + 1}: invalid JSON (${errorMessage(e)})`)
    }
  })
  return entries
}

export const nativeConnector: Connector = {
  id: 'native',
  displayName: 'Native JSON',
  extensions: ['.json', '.jsonl'],

  detect(text: string): boolean {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      const firstLine = text.split('\n').find((line) => line.trim() !== '')
      if (firstLine === undefined) return false
      try {
        value = JSON.parse(firstLine)
      } catch {
        return false
      }
    }
    return isNativeEntry(Array.isArray(value) ? value[0] : value)
  },

  parse(text: string, ctx: ParseContext): ParseResult {
    try {
      const warnings: string[] = []
      const traces: ParsedTrace[] = []
      for (const { value, label } of collectEntries(text, warnings)) {
        if (!isNativeEntry(value)) {
          warnings.push(`${label}: not a native trace (expected meta.traceId and messages[])`)
          continue
        }
        traces.push(buildTrace(value, ctx))
      }
      if (traces.length === 0 && warnings.length === 0) warnings.push('no traces found')
      return { traces, warnings }
    } catch (e) {
      return { traces: [], warnings: [`native parse failed: ${errorMessage(e)}`] }
    }
  },
}
