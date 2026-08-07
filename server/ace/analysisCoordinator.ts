import { setTimeout as delay } from 'node:timers/promises'
import { getScanProgress } from '../store/scan'
import type { TraceStore } from '../store/traceStore'
import { type AppliedAnalysisBundle, applyAceAnalysisBundleDetailed } from './analysisBundle'
import { productionAnalysisSourceFingerprint } from './analysisSource'

const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000

export interface AceAnalysisBridge {
  call<T>(command: 'analyze', params: Record<string, unknown>, timeoutMs?: number): Promise<T>
}

export type AceTraceAnalysisStatus =
  | { status: 'available' }
  | {
      status: 'unavailable'
      reason: 'not_loaded_for_current_source' | 'trace_not_covered'
    }

export interface AceAnalysisLoader {
  load(force?: boolean): Promise<AppliedAnalysisBundle>
  statusForTrace(traceUid: string): AceTraceAnalysisStatus
}

interface SuccessfulAnalysis {
  sourceFingerprint: string
  bundle: AppliedAnalysisBundle
  appliedTraceUids: ReadonlySet<string>
}

interface InFlightAnalysis {
  sourceFingerprint: string
  promise: Promise<AppliedAnalysisBundle>
}

/**
 * One canonical detector pipeline shared by every production-trace projection.
 * Failed snapshots are never cached, and changed-source callers cannot apply an
 * older bridge response over a newer transcript.
 */
export class AceAnalysisCoordinator implements AceAnalysisLoader {
  private successful: SuccessfulAnalysis | undefined
  private inFlight: InFlightAnalysis | undefined
  private fingerprintCache: { dataVersion: number; sourceFingerprint: string } | undefined

  constructor(
    private readonly store: TraceStore,
    private readonly bridge: AceAnalysisBridge,
  ) {}

  private async waitForStableScan(): Promise<void> {
    while (getScanProgress().scanning) await delay(50)
  }

  private currentSourceFingerprint(): string {
    if (this.fingerprintCache?.dataVersion === this.store.dataVersion) {
      return this.fingerprintCache.sourceFingerprint
    }
    const sourceFingerprint = productionAnalysisSourceFingerprint(this.store)
    this.fingerprintCache = { dataVersion: this.store.dataVersion, sourceFingerprint }
    return sourceFingerprint
  }

  private async analyzeUntilStable(sourceFingerprint: string): Promise<AppliedAnalysisBundle> {
    let expectedFingerprint = sourceFingerprint
    while (true) {
      const response = await this.bridge.call<{ bundle: unknown }>(
        'analyze',
        { corpusPath: '.', output: 'stdout' },
        ANALYSIS_TIMEOUT_MS,
      )
      await this.waitForStableScan()
      const currentFingerprint = this.currentSourceFingerprint()
      if (currentFingerprint !== expectedFingerprint) {
        expectedFingerprint = currentFingerprint
        continue
      }

      // applyAceAnalysisBundleDetailed is synchronous. Once the post-bridge
      // fingerprint matches, no source mutation can interleave before apply.
      const applied = applyAceAnalysisBundleDetailed(this.store, response.bundle)
      // Detector overlays increment dataVersion but are deliberately excluded
      // from the source fingerprint. Preserve that verified fingerprint cheaply.
      this.fingerprintCache = {
        dataVersion: this.store.dataVersion,
        sourceFingerprint: expectedFingerprint,
      }
      this.successful = {
        sourceFingerprint: expectedFingerprint,
        bundle: applied.summary,
        appliedTraceUids: applied.appliedTraceUids,
      }
      return applied.summary
    }
  }

  async load(force = false): Promise<AppliedAnalysisBundle> {
    await this.waitForStableScan()
    const sourceFingerprint = this.currentSourceFingerprint()
    if (!force && this.successful?.sourceFingerprint === sourceFingerprint) {
      return this.successful.bundle
    }

    const existing = this.inFlight
    if (existing) {
      // `force` bypasses only a completed cache. Concurrent refreshes of the
      // same immutable source snapshot still share one expensive Python pass.
      if (existing.sourceFingerprint === sourceFingerprint) return existing.promise
      try {
        await existing.promise
      } catch {
        // A changed-source or forced caller starts its own current snapshot below.
      }
      return this.load(force)
    }

    const promise = this.analyzeUntilStable(sourceFingerprint)
    const entry = { sourceFingerprint, promise }
    this.inFlight = entry
    void promise.then(
      () => {
        if (this.inFlight === entry) this.inFlight = undefined
      },
      () => {
        if (this.inFlight === entry) this.inFlight = undefined
      },
    )
    return promise
  }

  statusForTrace(traceUid: string): AceTraceAnalysisStatus {
    const currentFingerprint = this.currentSourceFingerprint()
    if (!this.successful || this.successful.sourceFingerprint !== currentFingerprint) {
      return { status: 'unavailable', reason: 'not_loaded_for_current_source' }
    }
    return this.successful.appliedTraceUids.has(traceUid)
      ? { status: 'available' }
      : { status: 'unavailable', reason: 'trace_not_covered' }
  }
}
