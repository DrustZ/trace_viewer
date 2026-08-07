import { describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import { TraceStore } from '../store/traceStore'
import { applyAceAnalysisBundle } from './analysisBundle'
import { productionAnalysisSourceFingerprint } from './analysisSource'

function traceFixture(
  traceId: string,
  corpusId: 'production' | 'simulation',
  content = 'Where is my order?',
): ParsedTrace {
  return {
    meta: {
      traceId,
      sourceTraceId: traceId,
      corpusId,
      runId: corpusId,
      instanceId: traceId,
      component: 'ace/test',
      status: 'unknown',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'unknown',
      sourceFormat: 'agent-conversation',
    },
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content,
        rawIndex: 0,
        chronologicalIndex: 0,
        metadata: { sourceTimestampSeconds: 1 },
      },
    ],
    warnings: [],
  }
}

describe('productionAnalysisSourceFingerprint', () => {
  it('changes for production source mutations but not detector overlays or simulations', () => {
    const store = new TraceStore()
    const sourcePath = '/corpus/production-1.json'
    store.upsert(traceFixture('production-1', 'production'), sourcePath)
    const original = productionAnalysisSourceFingerprint(store)

    applyAceAnalysisBundle(store, {
      schema_version: 2,
      traces: {
        'production-1': {
          language: 'en',
          issues: ['order_status'],
          failures: [
            {
              code: 'TEST_FINDING',
              severity: 'major',
              raw_index: 0,
              source: { family: 'test', tier: 'hard_fact' },
            },
          ],
        },
      },
    })
    expect(productionAnalysisSourceFingerprint(store)).toBe(original)

    store.upsert(traceFixture('simulation-1', 'simulation'), '/runs/simulation-1.json')
    expect(productionAnalysisSourceFingerprint(store)).toBe(original)

    store.upsert(
      traceFixture('production-1', 'production', 'My replacement order is still missing.'),
      sourcePath,
    )
    const replaced = productionAnalysisSourceFingerprint(store)
    expect(replaced).not.toBe(original)

    store.remove(sourcePath)
    expect(productionAnalysisSourceFingerprint(store)).not.toBe(replaced)
  })
})
