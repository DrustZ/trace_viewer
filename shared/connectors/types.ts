import type { Message, TraceMeta, TraceStats } from '../schema/types'

/**
 * What a connector extracts from raw text. Stats are always recomputed
 * centrally (shared/stats/computeStats.ts) so every format shares one metrics
 * definition; a connector may pass through source-provided values as
 * `statsOverrides` (e.g. an exact token count) and they win over estimates.
 */
export interface ParsedTrace {
  meta: TraceMeta
  messages: Message[]
  statsOverrides?: Partial<TraceStats>
  warnings: string[]
}

export interface ParseContext {
  /** Path or URL of the source, recorded into meta.dataLocation. */
  sourcePath?: string
  /** Fallback timestamp (file mtime / import time) when the source has none. */
  fallbackTimestamp?: string
}

export interface ParseResult {
  traces: ParsedTrace[]
  /** File-level issues (on top of per-trace warnings). */
  warnings: string[]
}

/**
 * A trace format adapter. Adding a format = one file implementing this
 * interface + one registry entry.
 *
 * Contract: `parse` NEVER throws. Unparseable input degrades to
 * `{ traces: [], warnings: [reason] }`; partially parseable input returns
 * whatever was salvageable plus warnings.
 */
export interface Connector {
  id: string
  displayName: string
  /** File extensions this connector may claim during directory scans (lowercase, with dot). */
  extensions: string[]
  /** Cheap content sniff — must be mutually exclusive across registered connectors. */
  detect(text: string): boolean
  parse(text: string, ctx: ParseContext): ParseResult
}
