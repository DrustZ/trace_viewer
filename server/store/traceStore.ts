import type { ParsedTrace } from '../../shared/connectors/types'
import type { Trace, TraceSummary } from '../../shared/schema/types'
import { finalizeTrace } from '../../shared/stats/computeStats'

export interface StoredTrace {
  trace: Trace
  /** File the trace was loaded from; absent for in-memory traces (tests, ephemeral imports). */
  sourcePath?: string
  /** Original source text, kept in memory for ephemeral imports so the Raw view works without a file. */
  rawText?: string
}

/** In-memory trace collection — the single source of truth behind every route. */
export class TraceStore {
  private byId = new Map<string, StoredTrace>()
  private version = 0
  private cache: { version: number; summaries: TraceSummary[] } | null = null

  get size(): number {
    return this.byId.size
  }

  /** Increments on every mutation; the summary cache and search index key off it. */
  get dataVersion(): number {
    return this.version
  }

  /** Normalization happens here: every trace enters through finalizeTrace. */
  upsert(parsed: ParsedTrace, sourcePath?: string, rawText?: string): Trace {
    const trace = finalizeTrace(
      parsed.meta,
      parsed.messages,
      parsed.statsOverrides,
      parsed.warnings,
    )
    this.byId.set(trace.meta.traceId, {
      trace,
      ...(sourcePath !== undefined ? { sourcePath } : {}),
      ...(rawText !== undefined ? { rawText } : {}),
    })
    this.version += 1
    return trace
  }

  /** Removes every trace loaded from the given source file. Returns the removed count. */
  remove(bySourcePath: string): number {
    let removed = 0
    for (const [id, stored] of this.byId) {
      if (stored.sourcePath === bySourcePath) {
        this.byId.delete(id)
        removed += 1
      }
    }
    if (removed > 0) this.version += 1
    return removed
  }

  clear(): void {
    if (this.byId.size === 0) return
    this.byId.clear()
    this.version += 1
  }

  get(traceId: string): StoredTrace | undefined {
    return this.byId.get(traceId)
  }

  getFull(traceId: string): Trace | undefined {
    return this.byId.get(traceId)?.trace
  }

  /** Summaries in stable order (meta.timestamp asc, then traceId asc), cached per dataVersion. */
  list(): TraceSummary[] {
    if (this.cache?.version === this.version) return this.cache.summaries
    const summaries = [...this.byId.values()]
      .map(({ trace }) => ({ meta: trace.meta, stats: trace.stats }))
      .sort((a, b) => {
        if (a.meta.timestamp !== b.meta.timestamp) {
          return a.meta.timestamp < b.meta.timestamp ? -1 : 1
        }
        return a.meta.traceId < b.meta.traceId ? -1 : a.meta.traceId > b.meta.traceId ? 1 : 0
      })
    this.cache = { version: this.version, summaries }
    return summaries
  }
}
