import { describe, expect, it } from 'vitest'
import type { Message, Trace, TraceMeta } from '../shared/schema/types'
import { finalizeTrace } from '../shared/stats/computeStats'
import { hashSeed, mulberry32 } from './rng'
import { browsecomp } from './scenarios/browsecomp'
import { deepscalerMath } from './scenarios/deepscalerMath'
import { leetcode } from './scenarios/leetcode'
import { nemotronScience } from './scenarios/nemotronScience'
import { swebench } from './scenarios/swebench'
import { terminalBench } from './scenarios/terminalBench'
import { buildProfSpans, type ProfSpan } from './spans'
import type { Scenario, TracePlan } from './types'

const SEED = 7
const START_MS = Date.parse('2026-03-01T05:00:00.000Z')

const SCENARIOS: Record<string, { component: string; scenario: Scenario }> = {
  deepscaler: { component: 'stem/deepscaler-math', scenario: deepscalerMath },
  nemotron: { component: 'stem/nemotron-science', scenario: nemotronScience },
  swebench: { component: 'swe/swebench-verified-mini', scenario: swebench },
  termbench: { component: 'terminal/terminal-bench', scenario: terminalBench },
  leetcode: { component: 'code/leetcode', scenario: leetcode },
  browsecomp: { component: 'search/browsecomp-plus', scenario: browsecomp },
}

function makePlan(short: string, overrides: Partial<TracePlan> = {}): TracePlan {
  return {
    component: SCENARIOS[short].component,
    short,
    instanceIdx: 1,
    instanceId: `${short}-i01`,
    traceId: `${short}-i01-s50-r01`,
    split: 'train',
    step: 50,
    startMs: START_MS,
    pSuccess: 0.9,
    success: true,
    failure: null,
    executing: false,
    withLogprobs: false,
    huge: false,
    emit: 'native',
    ...overrides,
  }
}

function buildTrace(short: string, overrides: Partial<TracePlan> = {}): Trace {
  const plan = makePlan(short, overrides)
  const output = SCENARIOS[short].scenario(
    plan,
    mulberry32(hashSeed(SEED, plan.traceId, 'content')),
  )
  const meta: TraceMeta = {
    traceId: plan.traceId,
    instanceId: plan.instanceId,
    component: plan.component,
    status: output.status,
    timestamp: new Date(plan.startMs).toISOString(),
    checkpointStep: plan.step,
    split: plan.split,
    sourceFormat: 'native',
    ...(output.rewardDetails ? { rewardDetails: output.rewardDetails } : {}),
  }
  return finalizeTrace(meta, output.messages, { score: output.score, truncated: output.truncated })
}

function spansFor(trace: Trace): ProfSpan[] {
  return buildProfSpans(
    trace.messages,
    trace.meta,
    trace.stats,
    mulberry32(hashSeed(SEED, trace.meta.traceId, 'spans')),
  )
}

describe('buildProfSpans', () => {
  it('emits exactly one root that covers every child, for every component', () => {
    for (const short of Object.keys(SCENARIOS)) {
      const spans = spansFor(buildTrace(short))
      const roots = spans.filter((s) => s.parentId === null)
      expect(roots, short).toHaveLength(1)
      const root = roots[0]
      expect(root.kind, short).toBe('trace')
      expect(root.name, short).toBe(`${short}-i01-s50-r01`)
      expect(root.startMs, short).toBe(0)

      const byId = new Map(spans.map((s) => [s.id, s]))
      for (const s of spans) {
        if (s.parentId === null) continue
        const parent = byId.get(s.parentId)
        expect(parent, `${short}: parent of ${s.id}`).toBeDefined()
        const p = parent as ProfSpan
        expect(s.startMs, `${short}: ${s.id} starts inside ${p.id}`).toBeGreaterThanOrEqual(
          p.startMs,
        )
        expect(
          s.startMs + s.durationMs,
          `${short}: ${s.id} ends inside ${p.id}`,
        ).toBeLessThanOrEqual(p.startMs + p.durationMs)
      }
    }
  })

  it('orders siblings by startMs and names turn containers by stepIndex', () => {
    const trace = buildTrace('swebench')
    const spans = spansFor(trace)
    const byParent = new Map<string, ProfSpan[]>()
    for (const s of spans) {
      if (s.parentId === null) continue
      const list = byParent.get(s.parentId) ?? []
      list.push(s)
      byParent.set(s.parentId, list)
    }
    for (const [parent, siblings] of byParent) {
      for (let i = 1; i < siblings.length; i++) {
        expect(siblings[i].startMs, `children of ${parent} sorted`).toBeGreaterThanOrEqual(
          siblings[i - 1].startMs,
        )
      }
    }
    const turns = spans.filter((s) => s.name.startsWith('turn_'))
    expect(turns.length).toBe(trace.stats.turns)
    for (const t of turns) expect(t.kind).toBe('io')
    expect(turns.map((t) => t.name)).toEqual(
      Array.from({ length: turns.length }, (_, i) => `turn_${i + 1}`),
    )
  })

  it('aligns each leaf with its message timestamp offset and duration', () => {
    const trace = buildTrace('swebench')
    const spans = spansFor(trace)
    const traceStart = Date.parse(trace.meta.timestamp)
    const messages = new Map(trace.messages.map((m) => [m.id, m]))
    const leaves = spans.filter((s) => s.messageId !== undefined)
    expect(leaves.length).toBe(trace.messages.length)
    for (const leaf of leaves) {
      const m = messages.get(leaf.messageId as string) as Message
      expect(m, leaf.id).toBeDefined()
      expect(leaf.startMs, leaf.id).toBe(Date.parse(m.timestamp as string) - traceStart)
      if ((m.durationMs ?? 0) > 0) expect(leaf.durationMs, leaf.id).toBe(m.durationMs)
      else expect(leaf.durationMs, leaf.id).toBeGreaterThanOrEqual(3)
    }
  })

  it('classifies leaves: io messages, model channels, sandbox execs, search queries', () => {
    const swe = spansFor(buildTrace('swebench'))
    expect(swe.some((s) => s.name === 'system.message' && s.kind === 'io')).toBe(true)
    expect(swe.some((s) => s.name === 'developer.message' && s.kind === 'io')).toBe(true)
    expect(swe.some((s) => s.name === 'user.message' && s.kind === 'io')).toBe(true)
    expect(swe.some((s) => s.name === 'assistant.analysis' && s.kind === 'model')).toBe(true)
    expect(swe.some((s) => s.name === 'assistant.commentary' && s.kind === 'model')).toBe(true)
    expect(swe.some((s) => s.name === 'assistant.final' && s.kind === 'model')).toBe(true)
    expect(swe.some((s) => s.name === 'bash.exec' && s.kind === 'sandbox')).toBe(true)
    const analysis = swe.find((s) => s.name === 'assistant.analysis') as ProfSpan
    expect(analysis.detail?.tokens_out).toBeGreaterThan(0)

    const search = spansFor(buildTrace('browsecomp'))
    expect(search.some((s) => s.name === 'search.query' && s.kind === 'io')).toBe(true)
    expect(search.some((s) => s.kind === 'sandbox')).toBe(false)
  })

  it('emits the component grader tail after the last message, inside the root', () => {
    const expected: Record<string, string> = {
      deepscaler: 'math_verify',
      nemotron: 'llm_judge',
      swebench: 'test_runner',
      termbench: 'checker',
      leetcode: 'test_runner',
      browsecomp: 'answer_match',
    }
    for (const [short, name] of Object.entries(expected)) {
      const trace = buildTrace(short)
      const spans = spansFor(trace)
      const graders = spans.filter((s) => s.kind === 'grader')
      expect(graders, short).toHaveLength(1)
      const grader = graders[0]
      expect(grader.name, short).toBe(name)
      const root = spans[0]
      expect(grader.parentId, short).toBe(root.id)
      const traceStart = Date.parse(trace.meta.timestamp)
      const lastEnd = trace.messages.reduce((acc, m) => {
        const end = Date.parse(m.timestamp as string) - traceStart + (m.durationMs ?? 0)
        return Math.max(acc, end)
      }, 0)
      expect(grader.startMs, short).toBeGreaterThan(lastEnd)
      expect(root.durationMs, short).toBeGreaterThanOrEqual(grader.startMs + grader.durationMs)
    }
  })

  it('grader details carry verdicts and test counts from rewardDetails', () => {
    const swe = spansFor(buildTrace('swebench'))
    const runner = swe.find((s) => s.name === 'test_runner') as ProfSpan
    expect(runner.detail?.tests_total).toBeGreaterThan(0)
    expect(runner.detail?.tests_passed).toBe(runner.detail?.tests_total)

    const leet = spansFor(buildTrace('leetcode'))
    const cases = leet.find((s) => s.name === 'test_runner') as ProfSpan
    expect(cases.detail?.cases_total).toBeGreaterThan(0)
    expect(typeof cases.detail?.cases_passed).toBe('number')

    const math = spansFor(buildTrace('deepscaler'))
    const verify = math.find((s) => s.name === 'math_verify') as ProfSpan
    expect(verify.detail?.verdict).toBe('correct')
    expect(verify.durationMs).toBeGreaterThanOrEqual(2)
  })

  it('llm_judge carries a nested judge.completion model span at ~90% of its duration', () => {
    const spans = spansFor(buildTrace('nemotron'))
    const judge = spans.find((s) => s.name === 'llm_judge') as ProfSpan
    expect(judge.kind).toBe('grader')
    expect(judge.durationMs).toBeGreaterThanOrEqual(800)
    const completion = spans.find((s) => s.name === 'judge.completion') as ProfSpan
    expect(completion.kind).toBe('model')
    expect(completion.parentId).toBe(judge.id)
    expect(completion.startMs).toBeGreaterThanOrEqual(judge.startMs)
    expect(completion.startMs + completion.durationMs).toBeLessThanOrEqual(
      judge.startMs + judge.durationMs,
    )
    expect(completion.durationMs / judge.durationMs).toBeCloseTo(0.9, 1)
  })

  it('marks a timed-out tool result as an error leaf with an exception detail', () => {
    const trace = buildTrace('swebench', { failure: 'tool_timeout_retry', success: true })
    const spans = spansFor(trace)
    const errors = spans.filter((s) => s.kind === 'sandbox' && s.status === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    for (const e of errors) {
      expect(e.name).toBe('bash.exec')
      expect(e.detail?.exception).toBe('TimeoutError: command exceeded 30000ms')
      expect(e.durationMs).toBe(30000)
    }
    expect(spans[0].status).toBe('error')
  })

  it('executing traces get no grader tail and an ok root', () => {
    const trace = buildTrace('termbench', { executing: true })
    expect(trace.meta.status).toBe('executing')
    const spans = spansFor(trace)
    expect(spans.some((s) => s.kind === 'grader')).toBe(false)
    expect(spans[0].status).toBe('ok')
  })

  it('a deterministic ~4% of grader spans record a retried timeout with inflated duration', () => {
    const trace = buildTrace('deepscaler')
    let errored: ProfSpan | undefined
    let seen = 0
    for (let i = 0; i < 400 && !errored; i++) {
      const spans = buildProfSpans(
        trace.messages,
        trace.meta,
        trace.stats,
        mulberry32(hashSeed(SEED, `probe-${i}`, 'spans')),
      )
      seen += 1
      errored = spans.find((s) => s.kind === 'grader' && s.status === 'error')
    }
    expect(errored, `no grader error in ${seen} builds`).toBeDefined()
    const g = errored as ProfSpan
    expect(g.detail?.exception).toBe('VerifierTimeout: retrying (1/3)')
    expect(g.detail?.verdict).toBe('correct')
    expect(g.durationMs).toBeGreaterThanOrEqual(2 * 3)
  })

  it('caps leaves: past 2000 projected spans only turns are emitted, noted on the root', () => {
    const start = START_MS
    const messages: Message[] = []
    for (let i = 0; i < 1200; i++) {
      const t = start + i * 1000
      messages.push({
        id: '',
        role: 'assistant',
        channel: 'commentary',
        content: '',
        toolCalls: [{ id: `call-${i}`, name: 'bash', arguments: '{}', parsedArguments: {} }],
        timestamp: new Date(t).toISOString(),
        durationMs: 200,
      })
      messages.push({
        id: '',
        role: 'tool',
        content: 'ok',
        toolResult: { toolCallId: `call-${i}`, isError: false, durationMs: 300 },
        timestamp: new Date(t + 400).toISOString(),
        durationMs: 300,
      })
    }
    const meta: TraceMeta = {
      traceId: 'cap-test-s1-r01',
      instanceId: 'cap-test',
      component: 'terminal/terminal-bench',
      status: 'completed',
      timestamp: new Date(start).toISOString(),
      checkpointStep: 1,
      split: 'train',
      sourceFormat: 'native',
      rewardDetails: { checker: 1 },
    }
    const trace = finalizeTrace(meta, messages, { score: 1, truncated: false })
    const spans = buildProfSpans(
      trace.messages,
      trace.meta,
      trace.stats,
      mulberry32(hashSeed(SEED, meta.traceId, 'spans')),
    )
    expect(spans[0].detail?.leaf_spans_omitted).toBe(true)
    expect(spans.some((s) => s.messageId !== undefined)).toBe(false)
    const turns = spans.filter((s) => s.name.startsWith('turn_'))
    expect(turns.length).toBe(trace.stats.turns)
    expect(spans.some((s) => s.kind === 'grader')).toBe(true)
  })

  it('is deterministic: same trace and seed produce identical spans', () => {
    for (const short of ['swebench', 'nemotron', 'browsecomp']) {
      const trace = buildTrace(short)
      expect(spansFor(trace), short).toEqual(spansFor(trace))
    }
  })
})
