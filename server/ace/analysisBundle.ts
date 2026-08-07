import type {
  DetectorFlag,
  FailureSeverity,
  FailureV1,
  TraceEvaluation,
} from '../../shared/schema/types'
import type { TraceStore } from '../store/traceStore'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function severity(value: unknown): FailureSeverity {
  return value === 'critical' || value === 'major' || value === 'minor' || value === 'info'
    ? value
    : 'minor'
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : []
}

export interface AppliedAnalysisBundle {
  schemaVersion: number
  source: Record<string, unknown>
  aggregates: Record<string, unknown>
  appliedTraces: number
  unmatchedTraces: number
}

/** Maps canonical Python detector output into FailureV1 without reimplementing detectors. */
export function applyAceAnalysisBundle(store: TraceStore, value: unknown): AppliedAnalysisBundle {
  const bundle = record(value)
  const traceEntries = record(bundle.traces)
  const summaries = new Map<string, ReturnType<TraceStore['list']>>()
  for (const summary of store
    .list()
    .filter((candidate) => candidate.meta.corpusId === 'production')) {
    const sourceTraceId = summary.meta.sourceTraceId ?? summary.meta.traceId
    const matches = summaries.get(sourceTraceId)
    if (matches) matches.push(summary)
    else summaries.set(sourceTraceId, [summary])
  }
  let appliedTraces = 0
  let unmatchedTraces = 0
  for (const [sourceTraceId, rawEntry] of Object.entries(traceEntries)) {
    const matches = summaries.get(sourceTraceId)
    // A detector bundle is keyed by producer id. If that id is duplicated,
    // applying it to either canonical uid would silently corrupt evidence.
    if (matches?.length !== 1) {
      unmatchedTraces += 1
      continue
    }
    const summary = matches[0]
    const traceUid = summary.meta.traceUid ?? summary.meta.traceId
    const full = store.getFull(traceUid)
    if (!full) continue
    const entry = record(rawEntry)
    const failures: FailureV1[] = []
    const flags: DetectorFlag[] = []
    for (const rawFailure of Array.isArray(entry.failures) ? entry.failures : []) {
      const finding = record(rawFailure)
      const code = stringValue(finding.code)
      if (!code) continue
      const source = record(finding.source)
      const rawIndex = numberValue(finding.raw_index)
      const chronologicalIndex = numberValue(finding.chronological_index)
      const message =
        rawIndex === undefined
          ? undefined
          : full.messages.find((candidate, index) => (candidate.rawIndex ?? index) === rawIndex)
      const normalizedSeverity = severity(finding.severity)
      const evidence = stringValue(finding.evidence)
      failures.push({
        origin: 'detector',
        code,
        severity: normalizedSeverity,
        gating: false,
        ...(message ? { messageId: message.id } : {}),
        indexSpace: 'raw',
        ...(rawIndex !== undefined ? { rawIndex } : {}),
        ...(chronologicalIndex !== undefined ? { chronologicalIndex } : {}),
        ...(evidence ? { evidence } : {}),
        source: 'ace.detector_registry',
      })
      flags.push({
        detector: code,
        severity: normalizedSeverity,
        tier: stringValue(source.tier),
        family: stringValue(source.family),
        note: evidence,
        ...(message ? { messageId: message.id } : {}),
        indexSpace: 'raw',
        ...(rawIndex !== undefined ? { rawIndex } : {}),
        ...(chronologicalIndex !== undefined ? { chronologicalIndex } : {}),
      })
    }
    const existing = full.evaluation
    const evaluation: TraceEvaluation = {
      lifecycle: existing?.lifecycle ?? { state: full.meta.status },
      outcome: existing?.outcome ?? 'ungraded',
      checks: existing?.checks ?? [],
      metrics: {
        ...existing?.metrics,
        detector_findings: failures.length,
      },
      failures: [
        ...(existing?.failures.filter((failure) => failure.source !== 'ace.detector_registry') ??
          []),
        ...failures,
      ],
      flags,
      userSimGate: existing?.userSimGate,
      judge: existing?.judge,
      semanticVerify: existing?.semanticVerify,
      worldDiff: existing?.worldDiff ?? [],
      ledger: existing?.ledger ?? [],
      lineage: existing?.lineage,
    }
    const issues = stringList(entry.issues)
    store.updateEvaluation(traceUid, evaluation, {
      language: stringValue(entry.language) ?? 'unknown',
      issues,
      ...(issues.length > 0 ? { issue: issues.join(', ') } : {}),
      detectorBundleSchemaVersion: numberValue(bundle.schema_version) ?? 1,
    })
    appliedTraces += 1
  }
  return {
    schemaVersion: numberValue(bundle.schema_version) ?? 1,
    source: record(bundle.source),
    aggregates: record(bundle.aggregates),
    appliedTraces,
    unmatchedTraces,
  }
}
