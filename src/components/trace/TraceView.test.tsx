import type { Trace } from '@shared/schema/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./TraceHeader', () => ({
  TraceHeader: ({ blindReview }: { blindReview?: boolean }) => (
    <div data-testid="header">blind:{String(blindReview)}</div>
  ),
}))
vi.mock('../review/ReviewPanel', () => ({
  ReviewPanel: ({ subject }: { subject: unknown }) => (
    <div data-testid="review-subject">{JSON.stringify(subject)}</div>
  ),
}))
vi.mock('./ReplayTab', () => ({
  ReplayTab: ({ trace }: { trace: Trace }) => (
    <div data-testid="replay-content">{trace.meta.traceUid}</div>
  ),
}))
vi.mock('./ConversationView', () => ({ ConversationView: () => <div>conversation-content</div> }))
vi.mock('./EvaluationTab', () => ({ EvaluationTab: () => <div>evaluation-content</div> }))
vi.mock('./EvolutionTab', () => ({ EvolutionTab: () => <div>evolution-content</div> }))
vi.mock('./MetadataTab', () => ({ MetadataTab: () => <div>metadata-content</div> }))
vi.mock('./PlaygroundTab', () => ({ PlaygroundTab: () => <div>playground-content</div> }))
vi.mock('./RawTab', () => ({ RawTab: () => <div>raw-content</div> }))
vi.mock('./StateToolsTab', () => ({ StateToolsTab: () => <div>state-content</div> }))
vi.mock('./TraceChat', () => ({ TraceChat: () => null }))

import { TraceView } from './TraceView'

function makeTrace(): Trace {
  return {
    meta: {
      traceId: 'duplicate-source-id',
      traceUid: 'simulation:run-a:uid-1',
      sourceTraceId: 'duplicate-source-id',
      corpusId: 'simulation',
      runId: 'run-a',
      instanceId: 'scenario-1',
      component: 'ace/support',
      status: 'failed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'ace-episode',
      extra: { arm: 'secret-arm' },
    },
    messages: [],
    stats: {
      score: 0,
      hasError: false,
      truncated: false,
      model: { name: 'secret-model' },
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      turns: 0,
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
          origin: 'detector',
          code: 'secret-detector-verdict',
          severity: 'major',
          gating: false,
          source: 'test',
        },
      ],
      flags: [],
      worldDiff: [],
      ledger: [],
    },
  }
}

describe('TraceView cockpit integration', () => {
  it('renders Replay & Fork from the canonical trace without falling through to playground', () => {
    const html = renderToStaticMarkup(
      <TraceView trace={makeTrace()} tab="replay" onTabChange={() => undefined} variant="page" />,
    )

    expect(html).toContain('simulation:run-a:uid-1')
    expect(html).not.toContain('playground-content')
  })

  it('keeps trace-embedded review Assisted and routes blind Calibration to its isolated page', () => {
    const html = renderToStaticMarkup(
      <TraceView trace={makeTrace()} tab="review" onTabChange={() => undefined} variant="page" />,
    )

    expect(html).toContain('blind:false')
    expect(html).toContain('&quot;mode&quot;:&quot;assisted&quot;')
    expect(html).not.toContain('&quot;mode&quot;:&quot;calibration&quot;')
    expect(html).toContain('data-testid="blind-calibration-link"')
    expect(html).toContain('/reviews?mode=calibration&amp;corpusId=ace&amp;state=unreviewed')
    expect(html).toContain('&quot;traceUid&quot;:&quot;simulation:run-a:uid-1&quot;')
    expect(html).not.toContain('secret-model')
    expect(html).not.toContain('secret-arm')
    expect(html).not.toContain('secret-detector-verdict')
  })
})
