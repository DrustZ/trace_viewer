import type { Trace, TraceSummary } from '../shared/schema/types'

export function externalTraceEgressEnabled(): boolean {
  return process.env.ACE_ALLOW_EXTERNAL_AI === '1'
}

export function isProductionTrace(trace: Trace | TraceSummary): boolean {
  return trace.meta.corpusId === 'production'
}

export function maySendTraceToExternalAi(trace: Trace | TraceSummary): boolean {
  return !isProductionTrace(trace) || externalTraceEgressEnabled()
}
