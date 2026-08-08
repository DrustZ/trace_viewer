import type { Trace } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import {
  demoPlaygroundConfig,
  demoRunRequest,
  PLAYGROUND_DEMOS,
  watchForStatus,
} from './playgroundDemos'
import { buildPlaygroundRunRequest } from './playgroundRun'

function judgedTrace(): Trace {
  return {
    meta: {
      traceId: 'ep-1',
      traceUid: 'simulation:run-x:ep-1',
      corpusId: 'simulation',
      runId: 'run-x',
      instanceId: 'g-refund-00',
      component: 'ace/support',
      status: 'completed',
      timestamp: '2026-08-07T00:00:00Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'ace-episode',
    },
    messages: [],
    stats: {
      score: 1,
      hasError: false,
      truncated: false,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      turns: 3,
      toolUses: 2,
      sandboxExecutions: 0,
      thinkingPortion: 0,
    },
    evaluation: {
      lifecycle: { state: 'completed', termination: 'handoff' },
      outcome: 'pass',
      checks: [
        { name: 'CONSENT', ok: true, gating: false },
        { name: 'WORLD_DIFF', ok: true, gating: true },
        { name: 'OUTCOME', ok: false, gating: true, detail: 'wrong final state' },
      ],
      metrics: {},
      failures: [],
      flags: [],
      worldDiff: [],
      ledger: [],
    },
  }
}

describe('PLAYGROUND_DEMOS registry', () => {
  it('curates six runnable demos with complete presets and watch lists', () => {
    expect(PLAYGROUND_DEMOS).toHaveLength(6)
    for (const demo of PLAYGROUND_DEMOS) {
      expect(demo.scenarioFile).toMatch(/\.json$/)
      expect(demo.scenarioIds.length).toBeGreaterThan(0)
      expect(demo.watchFor.length).toBeGreaterThan(0)
      expect(demo.blurb.length).toBeGreaterThan(20)
    }
    const ids = new Set(PLAYGROUND_DEMOS.map((demo) => demo.id))
    expect(ids.size).toBe(6)
    // v4 = informed-handoff canonical everywhere except the bare-baseline
    // counter-example, which must stay deliberately un-tuned.
    for (const demo of PLAYGROUND_DEMOS) {
      expect(demo.promptPreset).toBe(demo.id === 'baseline-bare' ? 'baseline' : 'v4')
    }
  })

  it('builds a valid single-episode config for every one-scenario demo', () => {
    for (const demo of PLAYGROUND_DEMOS.filter((candidate) => candidate.scenarioIds.length === 1)) {
      const config = demoPlaygroundConfig(demo)
      expect(config.scenarioId).toBe(demo.scenarioIds[0])
      // Canonical playground defaults survive: responses transport, cost cap.
      expect(config.transport).toBe('responses')
      expect(config.costCap).toBe('2')
      const request = buildPlaygroundRunRequest(config)
      expect(request).toMatchObject({ ok: true, request: { runKind: 'debug' } })
    }
  })

  it('builds the journey demo as an ordered multi-scenario debug run with shared state', () => {
    const journey = PLAYGROUND_DEMOS.find((demo) => demo.scenarioIds.length > 1)
    expect(journey).toBeDefined()
    if (!journey) return
    expect(journey.stateScope).toBe('journey')
    const result = demoRunRequest(journey)
    expect(result).toMatchObject({
      ok: true,
      request: {
        scenarioFile: 'ext50.json',
        scenarioIds: ['e50-journey-modify-cancel', 'e50-journey-modify-verify'],
        seeds: [1],
        runKind: 'debug',
        prompt: 'v4',
        transport: 'responses',
        stateScope: 'journey',
      },
    })
  })
})

describe('watchForStatus', () => {
  const items = [
    { label: 'consent', check: 'CONSENT' },
    { label: 'world diff', check: 'WORLD_DIFF' },
    { label: 'outcome', check: 'OUTCOME' },
    { label: 'handoff', check: 'termination=handoff' },
    { label: 'never emitted', check: 'WRITE_SAFETY' },
  ]

  it('stays pending until the grade lands', () => {
    for (const item of watchForStatus(items, undefined)) {
      expect(item.state).toBe('pending')
    }
    const ungraded = judgedTrace()
    ungraded.evaluation = undefined
    for (const item of watchForStatus(items, ungraded)) {
      expect(item.state).toBe('pending')
    }
  })

  it('lights each item from its check verdict, termination matcher included', () => {
    const status = watchForStatus(items, judgedTrace())
    expect(status.map((item) => [item.check, item.state])).toEqual([
      ['CONSENT', 'pass'],
      ['WORLD_DIFF', 'pass'],
      ['OUTCOME', 'fail'],
      ['termination=handoff', 'pass'],
      ['WRITE_SAFETY', 'absent'],
    ])
  })

  it('fails a termination assertion that does not match', () => {
    const trace = judgedTrace()
    if (!trace.evaluation) throw new Error('fixture')
    trace.evaluation.lifecycle.termination = 'hangup'
    const [handoff] = watchForStatus([{ label: 'handoff', check: 'termination=handoff' }], trace)
    expect(handoff?.state).toBe('fail')
  })
})
