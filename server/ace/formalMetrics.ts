import type { AceRunKind } from '../../shared/schema/ace'
import type { TraceSummary } from '../../shared/schema/types'

type SimulationRunKind = 'scored' | 'debug' | 'counterfactual'

export interface FormalMetricsEligibility {
  eligible: boolean
  runKind?: SimulationRunKind
}

function simulationRunKind(value: unknown): value is SimulationRunKind {
  return value === 'scored' || value === 'debug' || value === 'counterfactual'
}

/**
 * Formal metrics accept only explicit, internally consistent scored provenance.
 * Corpus-less traces retain the narrow legacy-fixture compatibility path, while
 * normalized simulation traces fail closed when their run kind is absent.
 */
export function formalMetricsEligibility(trace: TraceSummary): FormalMetricsEligibility {
  const extra = trace.meta.extra ?? {}
  const lineage = trace.evaluation?.lineage
  const kindValues = [extra.run_kind, extra.runKind, lineage?.runKind].filter(
    (value) => value !== undefined,
  )
  const malformedKind = kindValues.some((value) => !simulationRunKind(value))
  const kinds = new Set(kindValues.filter(simulationRunKind))
  const runKind = kinds.size === 1 ? [...kinds][0] : undefined
  const conflictingKind = kinds.size > 1
  const malformedExclusionMarker = [lineage?.formalMetricsExcluded, lineage?.synthetic].some(
    (value) => value !== undefined && typeof value !== 'boolean',
  )
  const hasReplayMode = lineage !== undefined && lineage.mode !== undefined
  const excluded =
    malformedKind ||
    conflictingKind ||
    malformedExclusionMarker ||
    lineage?.formalMetricsExcluded === true ||
    lineage?.synthetic === true ||
    hasReplayMode ||
    runKind === 'debug' ||
    runKind === 'counterfactual'
  const corpusId = trace.meta.corpusId
  const eligible =
    !excluded &&
    (corpusId === 'simulation'
      ? runKind === 'scored'
      : corpusId === undefined
        ? runKind === undefined || runKind === 'scored'
        : false)
  return { eligible, ...(runKind ? { runKind } : {}) }
}

/** Run-level display/scope classification derived from the same formal gate. */
export function traceRunKindForScope(trace: TraceSummary): AceRunKind {
  if (trace.meta.corpusId === 'production') return 'production'
  const eligibility = formalMetricsEligibility(trace)
  if (eligibility.eligible) return 'scored'
  if (eligibility.runKind === 'debug' || eligibility.runKind === 'counterfactual') {
    return eligibility.runKind
  }
  if (trace.evaluation?.lineage?.mode === 'counterfactual') return 'counterfactual'
  return 'unknown'
}

export function isFormalMetricsTrace(trace: TraceSummary): boolean {
  return formalMetricsEligibility(trace).eligible
}
