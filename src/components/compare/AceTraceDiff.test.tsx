import type { ReviewRecord } from '@shared/reviews/types'
import type { Message, ToolLedgerEntry, Trace } from '@shared/schema/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AceTraceDiffSummary,
  alignToolSequence,
  alignTraceMessages,
  compareAceTraces,
  matchedAceTraceIdentity,
  toolActualOutcome,
} from './AceTraceDiff'

function message(id: string, content: string, chronologicalIndex: number): Message {
  return { id, role: 'assistant', content, chronologicalIndex }
}

function trace(uid: string, messages: Message[], ledger: ToolLedgerEntry[] = []): Trace {
  return {
    meta: {
      traceId: uid,
      traceUid: uid,
      corpusId: 'simulation',
      runId: uid.startsWith('a') ? 'run-a' : 'run-b',
      instanceId: 'scenario-1',
      component: 'ace/support',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'ace-episode',
      pairKey: 'schedule-a:scenario-1:7',
    },
    messages,
    stats: {
      score: 1,
      hasError: false,
      truncated: false,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      turns: 0,
      toolUses: ledger.length,
      sandboxExecutions: 0,
      thinkingPortion: 0,
    },
    evaluation: {
      lifecycle: { state: 'completed' },
      outcome: 'pass',
      checks: [],
      metrics: {},
      failures: [],
      flags: [],
      worldDiff: [],
      ledger,
    },
  }
}

describe('ACE matched trace identity', () => {
  const expected = { runA: 'run-a', runB: 'run-b', instanceId: 'scenario-1' }

  it('accepts only the same canonical schedule/scenario/seed unit', () => {
    expect(
      matchedAceTraceIdentity(
        trace('a-trace', [message('a', 'A', 0)]),
        trace('b-trace', [message('b', 'B', 0)]),
        expected,
      ),
    ).toEqual({ matched: true, pairKey: 'schedule-a:scenario-1:7' })
  })

  it('rejects same-scenario traces from different seeds', () => {
    const a = trace('a-trace', [])
    const b = trace('b-trace', [])
    b.meta.pairKey = 'schedule-a:scenario-1:8'

    expect(matchedAceTraceIdentity(a, b, expected)).toMatchObject({
      matched: false,
      reason: expect.stringContaining('environment seeds'),
    })
  })

  it('rejects missing pair identity and stale run or instance URLs', () => {
    const a = trace('a-trace', [])
    const b = trace('b-trace', [])
    delete b.meta.pairKey
    expect(matchedAceTraceIdentity(a, b, expected)).toMatchObject({
      matched: false,
      reason: expect.stringContaining('pair key'),
    })

    b.meta.pairKey = a.meta.pairKey
    b.meta.runId = 'another-run'
    expect(matchedAceTraceIdentity(a, b, expected)).toMatchObject({
      matched: false,
      reason: expect.stringContaining('selected runs'),
    })

    b.meta.runId = 'run-b'
    b.meta.instanceId = 'scenario-2'
    expect(matchedAceTraceIdentity(a, b, expected)).toMatchObject({
      matched: false,
      reason: expect.stringContaining('selected scenario'),
    })
  })
})

function reviewRecord(): ReviewRecord {
  return {
    corpusId: 'simulation',
    runId: 'run-a',
    traceUid: 'a-trace',
    rubricVersion: 'judge_v2',
    annotator: 'local',
    mode: 'assisted',
    revision: 2,
    key: 'review-a-2',
    locked: true,
    createdAt: '2026-08-06T00:00:00.000Z',
    submittedAt: '2026-08-06T00:01:00.000Z',
    reviewStatus: 'reviewed',
    overallVerdict: 'fail',
    priority: 'high',
    rootCauseTags: ['policy-grounding'],
    note: 'The response promised an unsupported action.',
    rubricReviews: [
      {
        dimensionId: 'policy',
        verdict: 'fail',
        critique: 'Unsupported promise',
        evidenceMessageIds: ['m-a'],
      },
    ],
    failureReviews: [{ failureId: 'failure-1', decision: 'confirmed', note: 'Reproduced' }],
    turnAnnotations: [
      {
        annotationId: 'annotation-1',
        messageId: 'm-a',
        label: 'unsupported-claim',
        tags: ['policy'],
        note: '',
      },
    ],
  }
}

describe('ACE exact trace message alignment', () => {
  it('keeps insertions separate and detects true stable-id reordering', () => {
    const rows = alignTraceMessages(
      [message('m-a', 'A', 0), message('m-b', 'B', 1), message('m-c', 'C', 2)],
      [
        message('m-b', 'B', 0),
        message('m-new', 'inserted', 1),
        message('m-a', 'A', 2),
        message('m-c', 'C', 3),
      ],
    )
    const byId = new Map(rows.map((row) => [row.a?.value.id ?? row.b?.value.id, row]))

    expect(byId.get('m-new')?.status).toBe('added')
    expect(byId.get('m-a')).toMatchObject({ status: 'changed', reordered: true })
    expect(byId.get('m-b')).toMatchObject({ status: 'changed', reordered: true })
    // The insertion changes m-c's absolute index, not its order among shared messages.
    expect(byId.get('m-c')).toMatchObject({ status: 'unchanged', reordered: false })
  })

  it('falls back to the same chronological position when stable ids differ', () => {
    const [row] = alignTraceMessages(
      [message('producer-a', 'old', 0)],
      [message('producer-b', 'new', 0)],
    )

    expect(row).toMatchObject({
      status: 'changed',
      matchBy: 'chronological_position',
      differences: ['id', 'content'],
    })
  })
})

describe('ACE tool alignment', () => {
  it('keeps unknown actual outcomes explicit even when a partial payload exists', () => {
    const unknown: ToolLedgerEntry = {
      name: 'refund_order',
      toolCallId: 'call-1',
      args: { orderId: 'o-1' },
      result: { visible: 'accepted' },
      outcomeKnown: false,
      actualResult: { shouldNotBeTreatedAsKnown: true },
    }
    const known: ToolLedgerEntry = {
      ...unknown,
      outcomeKnown: true,
      actualResult: { status: 'refunded' },
    }

    expect(toolActualOutcome(unknown)).toEqual({ kind: 'unknown' })
    expect(alignToolSequence([unknown], [known])[0]).toMatchObject({
      status: 'changed',
      differences: ['actual outcome'],
    })
  })
})

describe('AceTraceDiffSummary', () => {
  it('renders aligned evidence, known review labels, and an explicit unavailable-label state', () => {
    const unknownTool: ToolLedgerEntry = {
      name: 'refund_order',
      toolCallId: 'call-1',
      args: { orderId: 'o-1' },
      resultHead: 'accepted',
      outcomeKnown: false,
    }
    const a = trace('a-trace', [message('m-a', 'first', 0)], [unknownTool])
    const b = trace(
      'b-trace',
      [message('m-a', 'changed', 0)],
      [{ ...unknownTool, outcomeKnown: true, actualResult: { status: 'refunded' } }],
    )
    if (a.evaluation && b.evaluation) {
      a.evaluation.worldDiff = [
        { orderId: 'o-1', field: 'status', before: 'pending', after: 'refunded', legal: true },
      ]
      b.evaluation.worldDiff = [
        { orderId: 'o-1', field: 'status', before: 'pending', after: 'blocked', legal: false },
      ]
    }
    const html = renderToStaticMarkup(
      <AceTraceDiffSummary
        traceA={a}
        traceB={b}
        comparison={compareAceTraces(a, b)}
        reviewA={{ loading: false, records: [reviewRecord()], draftModes: [] }}
        reviewB={{ loading: false, records: [], draftModes: [] }}
      />,
    )

    expect(html).toContain('Aligned ACE trace diff')
    expect(html).toContain('Message alignment')
    expect(html).toContain('Tool sequence')
    expect(html).toContain('Visible result')
    expect(html).toContain('Actual result')
    expect(html).toContain('Unknown outcome')
    expect(html).toContain('World diff comparison')
    expect(html).toContain('policy=fail')
    expect(html).toContain('policy-grounding')
    expect(html).toContain('Review labels unavailable for this comparison')
    expect(html).toContain('Arbitrary annotators and historical rubric versions')
  })
})
