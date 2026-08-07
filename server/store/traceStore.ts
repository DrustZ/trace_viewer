import { createHash } from 'node:crypto'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { ParsedTrace } from '../../shared/connectors/types'
import type {
  Trace,
  TraceEvaluation,
  TraceIdentity,
  TraceMeta,
  TraceSummary,
} from '../../shared/schema/types'
import { finalizeTrace } from '../../shared/stats/computeStats'

export interface StoredTrace {
  trace: Trace
  /** File the trace was loaded from; absent for in-memory traces (tests, ephemeral imports). */
  sourcePath?: string
  /** Original source text, kept in memory for ephemeral imports so the Raw view works without a file. */
  rawText?: string
}

export interface TraceStoreEvent {
  type: 'trace.upserted' | 'trace.removed' | 'store.reset' | 'batch.updated'
  traceUid?: string
  runId?: string
  dataVersion: number
}

export type TraceLookup =
  | { kind: 'found'; traceUid: string; stored: StoredTrace; via: 'traceUid' | 'sourceTraceId' }
  | { kind: 'ambiguous'; sourceTraceId: string; candidates: string[] }
  | { kind: 'missing' }

type StoreListener = (event: TraceStoreEvent) => void

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function stableUid(identity: Omit<TraceIdentity, 'traceUid'>, sourceKey: string): string {
  const digest = createHash('sha256')
    .update(identity.corpusId)
    .update('\0')
    .update(identity.runId)
    .update('\0')
    .update(identity.sourceTraceId)
    .update('\0')
    .update(sourceKey)
    .digest('hex')
    .slice(0, 24)
  return `trace_${digest}`
}

/**
 * Parsed/native payloads intentionally need not know viewer identity.  This is
 * the single normalization point that makes the optional migration fields on
 * TraceMeta concrete for every stored/API trace.
 */
function withIdentity(meta: TraceMeta, sourcePath?: string): TraceMeta {
  const sourceTraceId = textField(meta.sourceTraceId) ?? meta.traceId
  const runId =
    textField(meta.runId) ?? textField(meta.extra?.run) ?? textField(meta.extra?.run_id) ?? 'run-a'
  const corpusId =
    textField(meta.corpusId) ??
    textField(meta.extra?.corpusId) ??
    textField(meta.extra?.corpus_id) ??
    'imported'
  const instanceId = textField(meta.instanceId) ?? sourceTraceId
  const pairKey = textField(meta.pairKey) ?? textField(meta.extra?.pairKey)
  const sourceKey =
    textField(meta.extra?.sourceKey) ??
    textField(meta.extra?.source_key) ??
    sourcePath ??
    meta.dataLocation ??
    sourceTraceId
  const withoutUid = { sourceTraceId, corpusId, runId, instanceId, pairKey }
  return {
    ...meta,
    // traceId remains the display/legacy alias, never the global map key.
    traceId: sourceTraceId,
    traceUid: stableUid(withoutUid, sourceKey),
    sourceTraceId,
    corpusId,
    runId,
    instanceId,
    pairKey,
    extra: {
      ...meta.extra,
      // Useful for exported native traces and diagnostics; absolute paths are
      // not copied here when scan.ts supplied a corpus-relative source key.
      sourceKey: textField(meta.extra?.sourceKey) ?? path.basename(sourceKey),
    },
  }
}

/** In-memory trace collection — the single source of truth behind every route. */
export class TraceStore {
  private byUid = new Map<string, StoredTrace>()
  private uidsBySourceTraceId = new Map<string, Set<string>>()
  private listeners = new Set<StoreListener>()
  private version = 0
  private cache: { version: number; summaries: TraceSummary[] } | null = null

  get size(): number {
    return this.byUid.size
  }

  /** Increments on every committed mutation; caches and SSE key off it. */
  get dataVersion(): number {
    return this.version
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Publishes a validated durable batch-manifest update to SSE subscribers. */
  notifyBatchUpdated(runId: string): void {
    this.version += 1
    this.publish({ type: 'batch.updated', runId })
  }

  private publish(event: Omit<TraceStoreEvent, 'dataVersion'>): void {
    const published = { ...event, dataVersion: this.version }
    for (const listener of this.listeners) {
      try {
        listener(published)
      } catch (error) {
        // A telemetry/SSE subscriber must never roll back an already committed
        // in-memory mutation.
        queueMicrotask(() => console.warn('[trace-store subscriber]', error))
      }
    }
  }

  private materialize(parsed: ParsedTrace, sourcePath?: string): Trace {
    const meta = withIdentity(parsed.meta, sourcePath)
    return finalizeTrace(
      meta,
      parsed.messages,
      parsed.statsOverrides,
      parsed.warnings,
      parsed.evaluation,
    )
  }

  private deindex(traceUid: string, stored: StoredTrace): void {
    const sourceTraceId = stored.trace.meta.sourceTraceId ?? stored.trace.meta.traceId
    const indexed = this.uidsBySourceTraceId.get(sourceTraceId)
    indexed?.delete(traceUid)
    if (indexed?.size === 0) this.uidsBySourceTraceId.delete(sourceTraceId)
  }

  private set(trace: Trace, sourcePath?: string, rawText?: string): void {
    const traceUid = trace.meta.traceUid as string
    const previous = this.byUid.get(traceUid)
    if (previous) this.deindex(traceUid, previous)
    this.byUid.set(traceUid, {
      trace,
      ...(sourcePath !== undefined ? { sourcePath } : {}),
      ...(rawText !== undefined ? { rawText } : {}),
    })
    const sourceTraceId = trace.meta.sourceTraceId ?? trace.meta.traceId
    const indexed = this.uidsBySourceTraceId.get(sourceTraceId) ?? new Set<string>()
    indexed.add(traceUid)
    this.uidsBySourceTraceId.set(sourceTraceId, indexed)
  }

  /** Normalization happens here: every trace enters through finalizeTrace. */
  upsert(parsed: ParsedTrace, sourcePath?: string, rawText?: string): Trace {
    const trace = this.materialize(parsed, sourcePath)
    this.set(trace, sourcePath, rawText)
    this.version += 1
    this.publish({
      type: 'trace.upserted',
      traceUid: trace.meta.traceUid,
      runId: trace.meta.runId,
    })
    return trace
  }

  /**
   * Atomically publishes one successfully parsed source. Old traces from that
   * file remain visible until every replacement has normalized successfully.
   */
  replaceSource(parsed: ParsedTrace[], sourcePath: string): Trace[] {
    const traces = parsed.map((entry) => this.materialize(entry, sourcePath))
    // A batch heartbeat can ask the scanner to revisit sibling episode files.
    // Keep the existing objects/version when normalization produced no semantic change.
    const current = [...this.byUid.values()].filter((stored) => stored.sourcePath === sourcePath)
    const nextUids = new Set(traces.map((trace) => trace.meta.traceUid as string))
    // Compare uid SETS, not lengths: duplicate rows collapsing onto one uid can
    // make lengths match while a previously stored uid was actually removed.
    if (
      current.length === nextUids.size &&
      current.every((stored) => nextUids.has(stored.trace.meta.traceUid as string)) &&
      traces.every((trace) => {
        const traceUid = trace.meta.traceUid as string
        const stored = this.byUid.get(traceUid)
        return stored?.sourcePath === sourcePath && isDeepStrictEqual(stored.trace, trace)
      })
    ) {
      return traces
    }
    const removed: { traceUid: string; runId?: string }[] = []
    for (const [traceUid, stored] of this.byUid) {
      if (stored.sourcePath !== sourcePath || nextUids.has(traceUid)) continue
      this.byUid.delete(traceUid)
      this.deindex(traceUid, stored)
      removed.push({ traceUid, runId: stored.trace.meta.runId })
    }
    for (const trace of traces) this.set(trace, sourcePath)
    if (removed.length === 0 && traces.length === 0) return traces
    this.version += 1
    for (const item of removed) this.publish({ type: 'trace.removed', ...item })
    for (const trace of traces) {
      this.publish({
        type: 'trace.upserted',
        traceUid: trace.meta.traceUid,
        runId: trace.meta.runId,
      })
    }
    return traces
  }

  /**
   * Immutable post-scan enrichment hook for canonical detector bundles. The
   * transcript, raw source handle, identity, and file ownership stay intact.
   */
  updateEvaluation(
    traceUid: string,
    evaluation: TraceEvaluation,
    metaExtraPatch?: Record<string, unknown>,
  ): Trace | undefined {
    const stored = this.byUid.get(traceUid)
    if (!stored) return undefined
    const refreshMessageAnchors =
      evaluation.failures.some(
        (failure) =>
          failure.messageId !== undefined ||
          failure.rawIndex !== undefined ||
          failure.chronologicalIndex !== undefined,
      ) || stored.trace.messages.some((message) => message.metadata?.aceFailures !== undefined)
    const messages = refreshMessageAnchors
      ? stored.trace.messages.map((message, index) => {
          const anchored = evaluation.failures.filter(
            (failure) =>
              (failure.messageId !== undefined && failure.messageId === message.id) ||
              (failure.indexSpace === 'raw' && failure.rawIndex === (message.rawIndex ?? index)) ||
              (failure.indexSpace === 'chronological' &&
                failure.chronologicalIndex === (message.chronologicalIndex ?? index)),
          )
          const metadata = { ...message.metadata }
          if (anchored.length > 0) {
            metadata.aceFailures = anchored.map((failure) => ({
              id: [
                failure.origin,
                failure.code,
                failure.rawIndex ?? failure.chronologicalIndex ?? index,
              ].join(':'),
              code: failure.code,
              severity: failure.severity,
              origin: failure.origin,
              evidence: failure.evidence,
            }))
          } else {
            delete metadata.aceFailures
          }
          const { metadata: _previousMetadata, ...messageWithoutMetadata } = message
          return Object.keys(metadata).length > 0
            ? { ...messageWithoutMetadata, metadata }
            : messageWithoutMetadata
        })
      : stored.trace.messages
    const trace: Trace = {
      ...stored.trace,
      messages,
      meta:
        metaExtraPatch === undefined
          ? stored.trace.meta
          : {
              ...stored.trace.meta,
              extra: { ...stored.trace.meta.extra, ...metaExtraPatch },
            },
      evaluation,
    }
    this.byUid.set(traceUid, { ...stored, trace })
    this.version += 1
    this.publish({ type: 'trace.upserted', traceUid, runId: trace.meta.runId })
    return trace
  }

  /** Removes every trace loaded from the given source file. Returns the removed count. */
  remove(bySourcePath: string): number {
    const removed: { traceUid: string; runId?: string }[] = []
    for (const [traceUid, stored] of this.byUid) {
      if (stored.sourcePath !== bySourcePath) continue
      this.byUid.delete(traceUid)
      this.deindex(traceUid, stored)
      removed.push({ traceUid, runId: stored.trace.meta.runId })
    }
    if (removed.length === 0) return 0
    this.version += 1
    for (const item of removed) this.publish({ type: 'trace.removed', ...item })
    return removed.length
  }

  clear(): void {
    if (this.byUid.size === 0) return
    this.byUid.clear()
    this.uidsBySourceTraceId.clear()
    this.version += 1
    this.publish({ type: 'store.reset' })
  }

  /** Exact uid first; a legacy source id resolves only when globally unique. */
  lookup(id: string): TraceLookup {
    const exact = this.byUid.get(id)
    if (exact) return { kind: 'found', traceUid: id, stored: exact, via: 'traceUid' }
    const candidates = [...(this.uidsBySourceTraceId.get(id) ?? [])].sort()
    if (candidates.length === 0) return { kind: 'missing' }
    if (candidates.length > 1) return { kind: 'ambiguous', sourceTraceId: id, candidates }
    const stored = this.byUid.get(candidates[0])
    return stored
      ? { kind: 'found', traceUid: candidates[0], stored, via: 'sourceTraceId' }
      : { kind: 'missing' }
  }

  /** Candidate uids for an ambiguous legacy source id (empty for a missing id). */
  candidates(sourceTraceId: string): string[] {
    return [...(this.uidsBySourceTraceId.get(sourceTraceId) ?? [])].sort()
  }

  get(id: string): StoredTrace | undefined {
    const lookup = this.lookup(id)
    return lookup.kind === 'found' ? lookup.stored : undefined
  }

  getFull(id: string): Trace | undefined {
    return this.get(id)?.trace
  }

  traceUidsForSource(sourcePath: string): string[] {
    return [...this.byUid.entries()]
      .filter(([, stored]) => stored.sourcePath === sourcePath)
      .map(([traceUid]) => traceUid)
      .sort()
  }

  /** Summaries in stable order (timestamp, display id, then uid), cached per dataVersion. */
  list(): TraceSummary[] {
    if (this.cache?.version === this.version) return this.cache.summaries
    const summaries = [...this.byUid.values()]
      .map(({ trace }) => ({
        meta: trace.meta,
        stats: trace.stats,
        ...(trace.evaluation ? { evaluation: trace.evaluation } : {}),
      }))
      .sort((a, b) => {
        if (a.meta.timestamp !== b.meta.timestamp) {
          return a.meta.timestamp < b.meta.timestamp ? -1 : 1
        }
        const aSourceId = a.meta.sourceTraceId ?? a.meta.traceId
        const bSourceId = b.meta.sourceTraceId ?? b.meta.traceId
        if (aSourceId !== bSourceId) return aSourceId < bSourceId ? -1 : 1
        const aUid = a.meta.traceUid ?? aSourceId
        const bUid = b.meta.traceUid ?? bSourceId
        return aUid < bUid ? -1 : aUid > bUid ? 1 : 0
      })
    this.cache = { version: this.version, summaries }
    return summaries
  }
}
