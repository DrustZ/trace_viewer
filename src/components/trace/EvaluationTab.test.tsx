import type { FailureV1, Trace } from '@shared/schema/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { EvaluationSummary } from './EvaluationSummary'
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

describe('EvaluationTab shadow-layer visibility', () => {
  it('says explicitly when judge and semantic verification were off — never silent', () => {
    const trace = traceWithFailure({
      origin: 'grader',
      code: 'missing_action',
      severity: 'major',
      gating: true,
      source: 'test',
    })
    const html = renderToStaticMarkup(<EvaluationTab trace={trace} />)

    expect(html).toContain('data-testid="judge-off-note"')
    expect(html).toContain('LLM judge: off for this run')
    expect(html).toContain('data-testid="semantic-off-note"')
    expect(html).toContain('Semantic verification: off for this run')
    expect(html).toContain('never gates the outcome')
  })

  it('tones grade checks by verdict: red hard-gate fail, amber shadow fail, green pass', () => {
    const trace = traceWithFailure({
      origin: 'grader',
      code: 'missing_action',
      severity: 'major',
      gating: true,
      source: 'test',
    })
    if (!trace.evaluation) throw new Error('fixture must include evaluation')
    trace.evaluation.checks = [
      { name: 'FORBIDDEN', ok: false, gating: true, detail: 'forbidden refund effect' },
      { name: 'SOFT_TONE', ok: false, gating: false, detail: 'curt reply' },
      { name: 'ACTIONS', ok: true, gating: true, detail: 'all expected actions occurred' },
    ]
    const html = renderToStaticMarkup(<EvaluationTab trace={trace} />)

    expect(html).toContain('HARD GATE')
    expect(html).toContain('SHADOW')
    expect(html).toMatch(/bg-red-50\/70[^>]*>[\s\S]*?FORBIDDEN/)
    expect(html).toMatch(/bg-amber-50\/70[^>]*>[\s\S]*?SOFT_TONE/)
    expect(html).toMatch(/bg-emerald-50\/40[^>]*>[\s\S]*?ACTIONS/)
  })
})

describe('EvaluationSummary (drawer peek)', () => {
  it('shows verdict, per-check hard-gate/shadow rows, and the full-evaluation link', () => {
    const trace = traceWithFailure({
      origin: 'grader',
      code: 'forbidden_effect',
      severity: 'critical',
      gating: true,
      source: 'test',
    })
    if (!trace.evaluation) throw new Error('fixture must include evaluation')
    trace.evaluation.checks = [
      {
        name: 'FORBIDDEN',
        ok: false,
        gating: true,
        detail: 'forbidden refund effect: 299 cents\nsecond line',
      },
      { name: 'SOFT_TONE', ok: false, gating: false, detail: 'curt reply' },
      { name: 'ACTIONS', ok: true, gating: true },
    ]
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EvaluationSummary trace={trace} />
      </MemoryRouter>,
    )

    expect(html).toContain('data-testid="drawer-evaluation-summary"')
    expect(html).toContain('fail')
    expect(html).toContain('1 failed hard gates · 1 findings')
    expect(html).toContain('FORBIDDEN')
    expect(html).toContain('hard gate')
    expect(html).toContain('shadow')
    // The visible cell carries the first line; the full detail stays on title.
    expect(html).toContain('>forbidden refund effect: 299 cents</td>')
    expect(html).toMatch(
      /href="\/trace\/simulation(?::|%3A)run(?::|%3A)trace-1\?tab=evaluation"[^>]*>Open full evaluation/,
    )
  })

  it('renders nothing for an ungraded trace', () => {
    const trace = traceWithFailure({
      origin: 'grader',
      code: 'x',
      severity: 'minor',
      gating: false,
      source: 'test',
    })
    trace.evaluation = undefined
    expect(
      renderToStaticMarkup(
        <MemoryRouter>
          <EvaluationSummary trace={trace} />
        </MemoryRouter>,
      ),
    ).toBe('')
  })
})
