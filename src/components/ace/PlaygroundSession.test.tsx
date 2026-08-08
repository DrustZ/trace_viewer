import type { Message, Trace } from '@shared/schema/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkpoints: vi.fn(),
  replay: vi.fn(),
  regressionCapability: vi.fn(),
  saveRegression: vi.fn(),
}))

vi.mock('../../api/ace', () => ({
  useAceCheckpoints: mocks.checkpoints,
  useAceReplay: mocks.replay,
  useAceRegressionCapability: mocks.regressionCapability,
  useSaveAceRegression: mocks.saveRegression,
}))

import {
  bubbleStyle,
  EpisodeConversation,
  EpisodeResultCard,
  inlineBadgesByMessage,
  PlaygroundActions,
  sessionPhase,
} from './PlaygroundSession'

function message(id: string, role: Message['role'], overrides: Partial<Message> = {}): Message {
  return { id, role, content: `${role} says ${id}`, ...overrides }
}

function episode(): Trace {
  return {
    meta: {
      traceId: 'ep-1',
      traceUid: 'simulation:run-x:ep-1',
      corpusId: 'simulation',
      runId: 'run-x',
      instanceId: 'scenario-01',
      component: 'ace/support',
      status: 'completed',
      timestamp: '2026-08-07T00:00:00Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'ace-episode',
    },
    messages: [
      message('m-0', 'user'),
      message('m-1', 'assistant', {
        metadata: { agentType: 'beta' },
        toolCalls: [{ id: 'c-1', name: 'get_order_details', arguments: '{"order_id":"order_1"}' }],
      }),
      message('m-2', 'tool', { toolResult: { toolCallId: 'c-1', isError: false } }),
      message('m-3', 'assistant', { metadata: { agentType: 'human' } }),
    ],
    stats: {
      score: 0,
      hasError: false,
      truncated: false,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      turns: 2,
      toolUses: 1,
      sandboxExecutions: 0,
      thinkingPortion: 0,
    },
    evaluation: {
      lifecycle: { state: 'failed' },
      outcome: 'fail',
      checks: [
        { name: 'refund_issued', ok: false, gating: true, detail: 'refund never issued' },
        { name: 'no_hallucination', ok: true, gating: true },
      ],
      metrics: {},
      failures: [
        {
          origin: 'grader',
          code: 'refund_missing',
          severity: 'major',
          gating: true,
          source: 'ace.grade',
        },
      ],
      flags: [],
      worldDiff: [],
      ledger: [],
    },
  }
}

describe('bubbleStyle role coloring', () => {
  it('separates user / beta / human / tool with distinct colors and sides', () => {
    expect(bubbleStyle(message('m', 'user'))).toMatchObject({ label: 'USER', align: 'start' })
    expect(
      bubbleStyle(message('m', 'assistant', { metadata: { agentType: 'beta' } })),
    ).toMatchObject({ label: 'BETA', align: 'end' })
    expect(
      bubbleStyle(message('m', 'assistant', { metadata: { agentType: 'human' } })),
    ).toMatchObject({ label: 'HUMAN', align: 'end' })
    expect(bubbleStyle(message('m', 'assistant'))).toMatchObject({
      label: 'ASSISTANT',
      align: 'end',
    })
    expect(bubbleStyle(message('m', 'tool'))).toMatchObject({ label: 'TOOL', align: 'start' })
    expect(
      bubbleStyle(message('m', 'tool', { toolResult: { toolCallId: 'c', isError: true } })),
    ).toMatchObject({ label: 'TOOL · ERROR' })
    const chips = ['user', 'assistant', 'tool'].map(
      (role) => bubbleStyle(message('m', role as Message['role'])).chip,
    )
    expect(new Set(chips).size).toBe(chips.length)
  })
})

describe('EpisodeConversation', () => {
  it('renders bubbles per role with inline expandable tool calls', () => {
    const html = renderToStaticMarkup(<EpisodeConversation trace={episode()} />)
    expect(html).toContain('data-role="user"')
    expect(html).toContain('data-role="beta"')
    expect(html).toContain('data-role="human"')
    expect(html).toContain('data-role="tool"')
    expect(html).toContain('data-testid="playground-tool-call"')
    expect(html).toContain('get_order_details')
    expect(html).toContain('order_1')
  })

  it('renders a still-executing (pending) episode: partial messages, no grade required', () => {
    const trace = episode()
    trace.meta.status = 'executing'
    trace.evaluation = undefined
    trace.messages = trace.messages.slice(0, 2)
    const html = renderToStaticMarkup(<EpisodeConversation trace={trace} />)
    expect(html).toContain('data-role="user"')
    expect(html).toContain('data-role="beta"')
    expect(html).not.toContain('Waiting for the first durable message')
  })
})

describe('inlineBadgesByMessage', () => {
  function judged(): Trace {
    const trace = episode()
    if (!trace.evaluation) throw new Error('fixture must include evaluation')
    trace.evaluation.checks = [
      { name: 'WORLD_DIFF', ok: true, gating: true, detail: 'diff within license' },
      { name: 'OUTCOME', ok: true, gating: true },
      { name: 'ACTIONS', ok: true, gating: true }, // passing but not a milestone
      { name: 'SOFT', ok: true, gating: false },
    ]
    trace.evaluation.failures = [
      {
        origin: 'grader',
        code: 'refund_missing',
        severity: 'major',
        gating: true,
        messageId: 'm-1',
        evidence: 'refund never issued',
        source: 'ace.grade',
      },
      {
        origin: 'detector',
        code: 'curt_tone',
        severity: 'minor',
        gating: false,
        messageId: 'm-3',
        source: 'detector',
      },
    ]
    return trace
  }

  it('anchors failures to their message with gating/shadow tones', () => {
    const badges = inlineBadgesByMessage(judged())
    expect(badges.get('m-1')).toMatchObject([
      { tone: 'gating', detail: 'refund never issued' },
    ])
    expect(badges.get('m-3')?.some((badge) => badge.tone === 'shadow')).toBe(true)
  })

  it('attaches only milestone hard-gate passes, at the final message', () => {
    const badges = inlineBadgesByMessage(judged())
    const finalBadges = badges.get('m-3') ?? []
    const milestones = finalBadges.filter((badge) => badge.tone === 'milestone')
    expect(milestones.map((badge) => badge.label).sort()).toEqual(['OUTCOME', 'WORLD_DIFF'])
    // Non-milestone passes (ACTIONS) and shadow passes (SOFT) stay off the stream.
    const all = [...badges.values()].flat().map((badge) => badge.label)
    expect(all).not.toContain('ACTIONS')
    expect(all).not.toContain('SOFT')
  })

  it('renders anchored badges beside the bubbles with expandable detail', () => {
    const html = renderToStaticMarkup(<EpisodeConversation trace={judged()} />)
    expect(html).toContain('data-testid="playground-inline-badges"')
    expect(html).toContain('✕ refund_missing')
    expect(html).toContain('✓ WORLD_DIFF')
    expect(html).toContain('refund never issued')
  })
})

describe('sessionPhase', () => {
  it('reports starting until the first durable message exists', () => {
    expect(sessionPhase(undefined, 0)).toMatchObject({ kind: 'starting', active: true })
    expect(sessionPhase('running', 0)).toMatchObject({ kind: 'starting', active: true })
  })

  it('counts messages while the episode is executing', () => {
    expect(sessionPhase('running', 1)).toMatchObject({
      kind: 'running',
      label: 'running · 1 message',
      active: true,
    })
    expect(sessionPhase('running', 7).label).toBe('running · 7 messages')
  })

  it('promotes grade-like pending phases to a grading pill', () => {
    expect(sessionPhase('running', 5, 'grading')).toMatchObject({
      kind: 'grading',
      label: 'grading',
      active: true,
    })
    // A tool phase is still "running", not grading.
    expect(sessionPhase('running', 5, 'await_tool: get_order').kind).toBe('running')
  })

  it('terminal lifecycles win and deactivate the session', () => {
    expect(sessionPhase('completed', 9, 'grading')).toMatchObject({
      kind: 'complete',
      active: false,
    })
    expect(sessionPhase('failed', 2)).toMatchObject({ kind: 'failed', label: 'failed' })
    expect(sessionPhase('cancelled', 2)).toMatchObject({ kind: 'failed', label: 'cancelled' })
  })

  it('resolves complete from a settled episode when the run manifest is unreachable', () => {
    expect(sessionPhase(undefined, 8, undefined, true)).toMatchObject({
      kind: 'complete',
      active: false,
    })
    // An unsettled episode without a manifest still reads as live progress.
    expect(sessionPhase(undefined, 8, undefined, false).kind).toBe('running')
    // An authoritative active lifecycle outranks the settled fallback.
    expect(sessionPhase('running', 8, undefined, true).kind).toBe('running')
  })
})

describe('EpisodeResultCard', () => {
  it('shows outcome, cost, and every check grouped hard-gate / shadow', () => {
    const html = renderToStaticMarkup(<EpisodeResultCard trace={episode()} costUsd={0.1234} />)
    expect(html).toContain('fail')
    // Grouped episode-level view: both gating checks visible, failed one flagged.
    expect(html).toContain('Hard gates')
    expect(html).toContain('refund_issued')
    expect(html).toContain('refund never issued')
    expect(html).toContain('no_hallucination')
    expect(html).toContain('data-testid="playground-failed-check"')
    // Shadow layers are explicit even when off — never silent.
    expect(html).toContain('judge off · semantic verify off')
    expect(html).toContain('cost $0.123')
  })

  it('renders nothing for an ungraded trace', () => {
    const trace = episode()
    trace.evaluation = undefined
    expect(renderToStaticMarkup(<EpisodeResultCard trace={trace} costUsd={null} />)).toBe('')
  })
})

describe('PlaygroundActions', () => {
  beforeEach(() => {
    mocks.checkpoints.mockReset().mockReturnValue({
      data: {
        available: true,
        forkAvailable: true,
        historicalReplayAvailable: false,
        missing: [],
        checkpoints: [
          { id: 0, phase: 'await_bot', branchable: true, message_count: 2 },
          { id: 1, phase: 'await_user', branchable: true, message_count: 4 },
        ],
      },
    })
    mocks.replay.mockReset().mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.regressionCapability.mockReset().mockReturnValue({
      data: {
        available: true,
        scenarioSnapshotAvailable: true,
        expectedArtifactKind: 'runnable_scenario_pack',
        explanation: 'ok',
        missing: [],
      },
    })
    mocks.saveRegression.mockReset().mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  it('promotes fork-from-turn and save-as-regression to first-class enabled actions', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PlaygroundActions trace={episode()} onChildRun={() => undefined} />
      </MemoryRouter>,
    )
    expect(html).toContain('Fork from turn')
    expect(html).toContain('#1 · await_user · 4 messages')
    const fork = html.match(/<button([^>]*)data-testid="playground-fork"([^>]*)>/)
    expect(`${fork?.[1]}${fork?.[2]}`).not.toContain('disabled=""')
    const save = html.match(/<button([^>]*)data-testid="playground-save-regression"([^>]*)>/)
    expect(`${save?.[1]}${save?.[2]}`).not.toContain('disabled=""')
    // Deep link back to the full rerun surface stays available.
    expect(html).toMatch(/href="\/trace\/simulation(?::|%3A)run-x(?::|%3A)ep-1\?tab=rerun"/)
  })

  it('marks multi-turn human input as P1 with the bridge-capability reason', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PlaygroundActions trace={episode()} onChildRun={() => undefined} />
      </MemoryRouter>,
    )
    const input = html.match(/<textarea([^>]*)data-testid="playground-human-input"([^>]*)>/)
    const attrs = `${input?.[1]}${input?.[2]}`
    expect(attrs).toContain('disabled=""')
    expect(attrs).toContain('Needs bridge interactive support (P1)')
  })

  it('disables fork with the missing-capability reason when no checkpoint is branchable', () => {
    mocks.checkpoints.mockReturnValue({
      data: {
        available: false,
        forkAvailable: false,
        historicalReplayAvailable: false,
        missing: ['checkpoint archive'],
        checkpoints: [],
      },
    })
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PlaygroundActions trace={episode()} onChildRun={() => undefined} />
      </MemoryRouter>,
    )
    const fork = html.match(/<button([^>]*)data-testid="playground-fork"([^>]*)>/)
    expect(`${fork?.[1]}${fork?.[2]}`).toContain('disabled=""')
    expect(html).toContain('Fork unavailable: checkpoint archive')
  })
})
