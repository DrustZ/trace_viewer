import type { FailureV1, Trace } from '@shared/schema/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EvaluationTab, failureMessageId } from './EvaluationTab'

function traceWithFailure(failure: FailureV1): Trace {
  return {
    meta: {
      traceId: 'trace-1',
      traceUid: 'simulation:run:trace-1',
      instanceId: 'scenario-1',
      component: 'ace/support',
      status: 'failed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'ace-episode',
    },
    messages: [
      {
        id: 'message-user',
        role: 'user',
        content: 'help',
        rawIndex: 1,
        chronologicalIndex: 0,
      },
      {
        id: 'message-assistant',
        role: 'assistant',
        content: 'answer',
        rawIndex: 0,
        chronologicalIndex: 1,
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
      failures: [failure],
      flags: [],
      worldDiff: [],
      ledger: [],
    },
  }
}

describe('EvaluationTab failure anchors', () => {
  it('resolves the declared index space instead of array order', () => {
    const rawFailure: FailureV1 = {
      origin: 'detector',
      code: 'bad_tool_choice',
      severity: 'major',
      gating: false,
      indexSpace: 'raw',
      rawIndex: 0,
      source: 'test',
    }
    const trace = traceWithFailure(rawFailure)

    expect(failureMessageId(trace, rawFailure)).toBe('message-assistant')
    expect(
      failureMessageId(trace, {
        ...rawFailure,
        indexSpace: 'chronological',
        chronologicalIndex: 0,
      }),
    ).toBe('message-user')
  })

  it('renders a jump control only for an anchor that can be resolved', () => {
    const trace = traceWithFailure({
      origin: 'grader',
      code: 'missing_action',
      severity: 'major',
      gating: true,
      messageId: 'message-assistant',
      source: 'test',
    })
    const html = renderToStaticMarkup(
      <EvaluationTab trace={trace} onJumpToMessage={() => undefined} />,
    )

    expect(html).toContain('Open this message in the conversation')
    expect(html).toContain('message-assistant ↗')
  })

  it('keeps synthetic production reruns visibly excluded from formal metrics', () => {
    const trace = traceWithFailure({
      origin: 'grader',
      code: 'missing_action',
      severity: 'major',
      gating: true,
      source: 'test',
    })
    if (!trace.evaluation) throw new Error('fixture must include evaluation')
    trace.evaluation.lineage = {
      relation: 'synthetic_regression_rerun',
      parentTraceUid: 'production:source:trace-7',
      regressionId: 'reg-production-7',
      fidelity: 'synthetic_regression_scenario_rerun_state_regenerated',
      synthetic: true,
      formalMetricsExcluded: true,
    }

    const html = renderToStaticMarkup(<EvaluationTab trace={trace} />)

    expect(html).toContain('Synthetic regression rerun · formal metrics excluded')
    expect(html).toContain('production:source:trace-7')
    expect(html).toContain('reg-production-7')
  })
})
