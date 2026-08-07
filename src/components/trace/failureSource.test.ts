import type { Trace } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import { failuresByMessage, unifiedFailures } from './failureSource'

function makeTrace(): Trace {
  return {
    meta: {
      traceId: 'trace-1',
      traceUid: 'simulation:run-a:trace-1',
      corpusId: 'simulation',
      runId: 'run-a',
      instanceId: 'scenario-1',
      component: 'ace/support',
      status: 'failed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'ace-episode',
    },
    messages: [
      { id: 'm-0', role: 'user', content: 'Help', rawIndex: 0, chronologicalIndex: 0 },
      {
        id: 'm-1',
        role: 'assistant',
        content: 'Sure',
        rawIndex: 1,
        chronologicalIndex: 1,
        metadata: {
          aceFailures: [
            // Duplicates the evaluation failure anchored to m-1 → must dedupe.
            { id: 'detector:tool_error:1', code: 'tool_error', severity: 'major', origin: 'tool' },
            // Exists only in metadata → kept as a non-gating fill-in.
            {
              id: 'detector:orphan_only:1',
              code: 'orphan_only',
              severity: 'minor',
              origin: 'detector',
              evidence: 'metadata evidence',
            },
          ],
        },
      },
    ],
    stats: {
      score: 0,
      hasError: false,
      truncated: false,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      turns: 1,
      toolUses: 0,
      sandboxExecutions: 0,
      thinkingPortion: 0,
    },
    evaluation: {
      lifecycle: { state: 'failed' },
      outcome: 'fail',
      checks: [],
      metrics: {},
      failures: [
        {
          origin: 'tool',
          code: 'tool_error',
          severity: 'major',
          gating: true,
          messageId: 'm-1',
          source: 'ace.grade',
        },
        {
          origin: 'detector',
          code: 'policy_drift',
          severity: 'minor',
          gating: false,
          indexSpace: 'raw',
          rawIndex: 0,
          source: 'ace.detector.hard',
        },
        {
          origin: 'grader',
          code: 'trace_level_failure',
          severity: 'major',
          gating: true,
          source: 'ace.grade',
        },
      ],
      flags: [
        {
          detector: 'policy_drift',
          severity: 'minor',
          tier: 'hard',
          family: 'log',
          indexSpace: 'raw',
          rawIndex: 0,
        },
      ],
      worldDiff: [],
      ledger: [],
    },
  }
}

describe('unifiedFailures', () => {
  it('keeps evaluation.failures authoritative and dedupes metadata copies by code+anchor', () => {
    const failures = unifiedFailures(makeTrace())
    const toolErrors = failures.filter((failure) => failure.code === 'tool_error')
    expect(toolErrors).toHaveLength(1)
    expect(toolErrors[0]).toMatchObject({
      gating: true,
      metadataOnly: false,
      messageId: 'm-1',
      source: 'ace.grade',
    })
  })

  it('adds metadata-only failures as non-gating fill-ins anchored to their message', () => {
    const failures = unifiedFailures(makeTrace())
    const orphan = failures.find((failure) => failure.code === 'orphan_only')
    expect(orphan).toMatchObject({
      metadataOnly: true,
      gating: false,
      messageId: 'm-1',
      evidence: 'metadata evidence',
      source: 'message.metadata',
    })
  })

  it('joins detector tier/family from evaluation.flags onto matching failures', () => {
    const failures = unifiedFailures(makeTrace())
    const drift = failures.find((failure) => failure.code === 'policy_drift')
    expect(drift).toMatchObject({ tier: 'hard', family: 'log', messageId: 'm-0' })
    // Non-detector failures never inherit unrelated flags.
    const toolError = failures.find((failure) => failure.code === 'tool_error')
    expect(toolError?.tier).toBeUndefined()
  })

  it('resolves raw-index anchors to message ids and keeps trace-level rows unanchored', () => {
    const failures = unifiedFailures(makeTrace())
    expect(failures.find((f) => f.code === 'policy_drift')?.messageId).toBe('m-0')
    const traceLevel = failures.find((f) => f.code === 'trace_level_failure')
    expect(traceLevel?.messageId).toBeUndefined()
    expect(traceLevel?.anchorLabel).toBe('—')
  })

  it('works without an evaluation block (metadata fill-ins only)', () => {
    const trace = makeTrace()
    trace.evaluation = undefined
    const failures = unifiedFailures(trace)
    expect(failures.map((f) => f.code).sort()).toEqual(['orphan_only', 'tool_error'])
    expect(failures.every((f) => f.metadataOnly && !f.gating)).toBe(true)
  })
})

describe('failuresByMessage', () => {
  it('groups only message-anchored failures for inline chips', () => {
    const index = failuresByMessage(makeTrace())
    expect(index.get('m-1')?.map((f) => f.code)).toEqual(['tool_error', 'orphan_only'])
    expect(index.get('m-0')?.map((f) => f.code)).toEqual(['policy_drift'])
    // Trace-level failures never leak onto a message row.
    const all = [...index.values()].flat()
    expect(all.some((f) => f.code === 'trace_level_failure')).toBe(false)
  })
})
