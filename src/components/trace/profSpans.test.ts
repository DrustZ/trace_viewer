import type { Message, Trace } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import { buildSpanTree, flattenVisible, type ProfSpan } from './profSpans'

const T0 = Date.parse('2026-03-13T12:00:00.000Z')

function iso(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString()
}

let nextId = 0
function msg(over: Partial<Message>): Message {
  nextId += 1
  return { id: `m-${nextId}`, role: 'user', content: '', ...over }
}

function mkTrace(
  messages: Message[],
  over?: { extra?: Record<string, unknown>; hasError?: boolean },
): Trace {
  return {
    meta: {
      traceId: 'tr-1',
      instanceId: 'inst-1',
      component: 'test/comp',
      status: 'completed',
      timestamp: iso(0),
      checkpointStep: 0,
      split: 'train',
      sourceFormat: 'native',
      extra: over?.extra,
    },
    stats: {
      score: 1,
      hasError: over?.hasError ?? false,
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
    messages,
  }
}

function span(over: Partial<ProfSpan>): ProfSpan {
  return {
    id: 'sp-x',
    parentId: null,
    name: 'x',
    kind: 'io',
    startMs: 0,
    durationMs: 10,
    status: 'ok',
    ...over,
  }
}

describe('buildSpanTree · derivation from messages', () => {
  const fixture = () => [
    msg({ role: 'system', timestamp: iso(0), durationMs: 5 }),
    msg({ role: 'user', timestamp: iso(10), durationMs: 5 }),
    msg({
      role: 'assistant',
      channel: 'analysis',
      stepIndex: 1,
      timestamp: iso(20),
      durationMs: 100,
    }),
    msg({
      role: 'assistant',
      channel: 'commentary',
      stepIndex: 1,
      timestamp: iso(130),
      durationMs: 20,
      toolCalls: [{ id: 'c1', name: 'bash', arguments: '{}' }],
    }),
    msg({
      role: 'tool',
      stepIndex: 1,
      timestamp: iso(160),
      durationMs: 40,
      content: 'TimeoutError: sandbox timed out\nstack…',
      toolResult: { toolCallId: 'c1', isError: true },
    }),
    msg({ role: 'assistant', channel: 'final', stepIndex: 2, timestamp: iso(210), durationMs: 90 }),
  ]

  it('groups leaves under turn spans beneath a single root', () => {
    const messages = fixture()
    const { spans, derived } = buildSpanTree(mkTrace(messages))
    expect(derived).toBe(true)

    const root = spans.find((s) => s.parentId === null)
    expect(root).toBeDefined()
    expect(root?.name).toBe('tr-1')
    expect(root?.kind).toBe('trace')
    expect(root?.startMs).toBe(0)
    // Root covers everything: last leaf ends at 210 + 90.
    expect(root ? root.startMs + root.durationMs : 0).toBe(300)
    expect(spans.every((s) => /^sp-\d+$/.test(s.id))).toBe(true)

    const turns = spans.filter((s) => s.name.startsWith('turn_'))
    expect(turns.map((t) => t.name)).toEqual(['turn_1', 'turn_2'])
    expect(turns.every((t) => t.parentId === root?.id)).toBe(true)
    // turn_1 stretches over analysis..tool result: [20, 200].
    expect(turns[0].startMs).toBe(20)
    expect(turns[0].durationMs).toBe(180)

    // Preamble leaves hang directly off the root.
    const sys = spans.find((s) => s.name === 'system.message')
    expect(sys?.parentId).toBe(root?.id)
    expect(sys?.kind).toBe('io')
    expect(sys?.messageId).toBe(messages[0].id)
  })

  it('maps kinds and names per the contract and flags error tool results', () => {
    const { spans } = buildSpanTree(mkTrace(fixture()))
    const byName = new Map(spans.map((s) => [s.name, s]))
    expect(byName.get('user.message')?.kind).toBe('io')
    expect(byName.get('assistant.analysis')?.kind).toBe('model')
    expect(byName.get('assistant.commentary')?.kind).toBe('model')
    expect(byName.get('assistant.final')?.kind).toBe('model')

    const exec = byName.get('bash.exec')
    expect(exec?.kind).toBe('sandbox')
    expect(exec?.status).toBe('error')
    expect(exec?.detail?.exception).toBe('TimeoutError: sandbox timed out')
    // Leaf-local error does not flip the turn, root stays ok when stats are clean.
    expect(spans.find((s) => s.name === 'turn_1')?.status).toBe('ok')
    expect(spans.find((s) => s.parentId === null)?.status).toBe('ok')
  })

  it('marks the root error when stats.hasError, and grader tools as grader kind', () => {
    const messages = [
      msg({
        role: 'assistant',
        channel: 'commentary',
        stepIndex: 1,
        timestamp: iso(0),
        durationMs: 5,
        toolCalls: [{ id: 'g1', name: 'llm_judge', arguments: '{}' }],
      }),
      msg({
        role: 'tool',
        stepIndex: 1,
        timestamp: iso(10),
        durationMs: 5,
        toolResult: { toolCallId: 'g1', isError: false },
      }),
    ]
    const { spans } = buildSpanTree(mkTrace(messages, { hasError: true }))
    expect(spans.find((s) => s.parentId === null)?.status).toBe('error')
    const judge = spans.find((s) => s.name === 'llm_judge')
    expect(judge?.kind).toBe('grader')
  })

  it('falls back to index-spaced 1s ticks when timestamps are missing', () => {
    const { spans, derived } = buildSpanTree(
      mkTrace([msg({ role: 'user' }), msg({ role: 'assistant', stepIndex: 1 })]),
    )
    expect(derived).toBe(true)
    const user = spans.find((s) => s.name === 'user.message')
    const final = spans.find((s) => s.name === 'assistant.final')
    expect(user?.startMs).toBe(0)
    expect(final?.startMs).toBe(1000)
    expect(final?.durationMs).toBe(1000)
  })
})

describe('buildSpanTree · meta.extra.spans validation', () => {
  it('keeps valid spans, drops junk entries and orphans, sorts children by startMs', () => {
    const raw = [
      span({ id: 'sp-0', name: 'root', kind: 'trace', durationMs: 100 }),
      span({ id: 'sp-2', parentId: 'sp-0', name: 'late', startMs: 50 }),
      span({ id: 'sp-1', parentId: 'sp-0', name: 'early', startMs: 5 }),
      span({ id: 'sp-9', parentId: 'sp-404', name: 'orphan' }), // parent missing
      { id: 'sp-3', parentId: 'sp-0' }, // missing required fields
      {
        id: 42,
        name: 'bad-id',
        kind: 'io',
        startMs: 0,
        durationMs: 1,
        status: 'ok',
        parentId: null,
      },
      span({ id: 'sp-4', parentId: 'sp-0', kind: 'warp' as never, name: 'bad-kind' }),
      span({ id: 'sp-5', parentId: 'sp-0', status: 'meh' as never, name: 'bad-status' }),
      span({ id: 'sp-6', parentId: 'sp-0', durationMs: Number.NaN, name: 'bad-duration' }),
      null,
      'junk',
    ]
    const { spans, derived } = buildSpanTree(mkTrace([], { extra: { spans: raw } }))
    expect(derived).toBe(false)
    expect(spans.map((s) => s.id)).toEqual(['sp-0', 'sp-1', 'sp-2'])
    expect(spans.map((s) => s.name)).toEqual(['root', 'early', 'late'])
  })

  it('derives from messages when the spans array holds no usable root', () => {
    const { spans, derived } = buildSpanTree(
      mkTrace([msg({ role: 'user' })], { extra: { spans: [null, { id: 'x' }] } }),
    )
    expect(derived).toBe(true)
    expect(spans.find((s) => s.parentId === null)?.name).toBe('tr-1')
  })
})

describe('flattenVisible', () => {
  const tree = [
    span({ id: 'sp-0', name: 'root', kind: 'trace', durationMs: 100 }),
    span({ id: 'sp-1', parentId: 'sp-0', name: 'turn_1', startMs: 0 }),
    span({ id: 'sp-2', parentId: 'sp-1', name: 'leaf-a', startMs: 1 }),
    span({ id: 'sp-3', parentId: 'sp-1', name: 'leaf-b', startMs: 2 }),
    span({ id: 'sp-4', parentId: 'sp-0', name: 'turn_2', startMs: 50 }),
    span({ id: 'sp-5', parentId: 'sp-4', name: 'leaf-c', startMs: 51 }),
  ]

  it('returns depth-annotated rows in DFS order', () => {
    const rows = flattenVisible(tree, new Set())
    expect(rows.map((r) => r.span.id)).toEqual(['sp-0', 'sp-1', 'sp-2', 'sp-3', 'sp-4', 'sp-5'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2, 1, 2])
    expect(rows.map((r) => r.hasChildren)).toEqual([true, true, false, false, true, false])
  })

  it('hides descendants of collapsed spans but keeps the span itself', () => {
    const rows = flattenVisible(tree, new Set(['sp-1']))
    expect(rows.map((r) => r.span.id)).toEqual(['sp-0', 'sp-1', 'sp-4', 'sp-5'])
    // Collapsing the root hides everything below it.
    expect(flattenVisible(tree, new Set(['sp-0'])).map((r) => r.span.id)).toEqual(['sp-0'])
  })
})
