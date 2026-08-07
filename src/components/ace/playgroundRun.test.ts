import type { Trace } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import {
  buildPlaygroundRunRequest,
  DEFAULT_PLAYGROUND_CONFIG,
  initialPlaygroundConfig,
  type PlaygroundRunConfig,
} from './playgroundRun'

function config(overrides: Partial<PlaygroundRunConfig> = {}): PlaygroundRunConfig {
  return { ...DEFAULT_PLAYGROUND_CONFIG, scenarioId: 'cancel-late-01', ...overrides }
}

describe('buildPlaygroundRunRequest', () => {
  it('builds a one-scenario × one-seed debug request from the panel state', () => {
    const result = buildPlaygroundRunRequest(
      config({ bot: 'playbook', model: 'gpt-5-mini', temperature: '0.4', reasoningEffort: 'low' }),
    )
    expect(result).toMatchObject({
      ok: true,
      request: {
        scenarioFile: 'atomic.json',
        scenarioIds: ['cancel-late-01'],
        seeds: [1],
        runKind: 'debug',
        prompt: 'optimized',
        bot: 'playbook',
        model: 'gpt-5-mini',
        temperature: 0.4,
        reasoningEffort: 'low',
        costCapUsd: 2,
        checkpoints: true,
      },
    })
  })

  it('downgrades to counterfactual when a custom prompt is set (metrics hygiene)', () => {
    const result = buildPlaygroundRunRequest(config({ promptText: 'You are a careful agent.' }))
    expect(result).toMatchObject({
      ok: true,
      request: { runKind: 'counterfactual', promptText: 'You are a careful agent.' },
    })
  })

  it('requires a scenario and rejects multi-scenario/multi-seed schedules', () => {
    expect(buildPlaygroundRunRequest(config({ scenarioId: '' }))).toMatchObject({ ok: false })
    expect(buildPlaygroundRunRequest(config({ seed: '1, 2' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('one scenario × one seed'),
    })
    expect(buildPlaygroundRunRequest(config({ scenarioId: 'a-1, b-2' }))).toMatchObject({
      ok: false,
    })
  })

  it('keeps the launcher validation rules (cost cap bounds)', () => {
    expect(buildPlaygroundRunRequest(config({ costCap: '0' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('Cost cap'),
    })
  })

  it('records fresh-rerun lineage via sourceTraceUid', () => {
    const result = buildPlaygroundRunRequest(
      config({ sourceTraceUid: 'simulation:run-a:episode-1' }),
    )
    expect(result).toMatchObject({
      ok: true,
      request: { sourceTraceUid: 'simulation:run-a:episode-1', runKind: 'debug' },
    })
  })
})

function sourceTrace(): Trace {
  return {
    meta: {
      traceId: 'episode-1',
      traceUid: 'simulation:parent-run:episode-1',
      corpusId: 'simulation',
      runId: 'parent-run',
      instanceId: 'scenario-01',
      component: 'ace/test',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
      extra: {
        environment_seed: 3,
        config_snapshot: {
          runner: {},
          spec: {
            prompt_source: { kind: 'preset', value: 'baseline' },
            bot_model: 'assistant-recorded',
            bot_temperature: 0.3,
            reasoning_effort: 'low',
            bot: 'baseline',
          },
        },
      },
    },
    messages: [],
    stats: {
      score: 0,
      hasError: false,
      truncated: false,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      turns: 0,
      toolUses: 0,
      sandboxExecutions: 0,
      thinkingPortion: 0,
    },
  }
}

describe('initialPlaygroundConfig', () => {
  it('prefills prompt/harness/model/sampling plus scenario and seed from a simulation trace', () => {
    expect(initialPlaygroundConfig({}, sourceTrace())).toMatchObject({
      scenarioId: 'scenario-01',
      seed: '3',
      promptPreset: 'baseline',
      bot: 'baseline',
      model: 'assistant-recorded',
      temperature: '0.3',
      reasoningEffort: 'low',
    })
  })

  it('never guesses a missing environment seed', () => {
    const trace = sourceTrace()
    trace.meta.extra = {}
    expect(initialPlaygroundConfig({ seed: '7' }, trace)).toMatchObject({
      scenarioId: 'scenario-01',
      seed: '7',
    })
  })

  it('ignores production traces and honors URL params', () => {
    const trace = sourceTrace()
    trace.meta.corpusId = 'production'
    expect(
      initialPlaygroundConfig({ scenarioFile: 'multi.json', scenarioId: 'x-1', seed: '5' }, trace),
    ).toMatchObject({
      scenarioFile: 'multi.json',
      scenarioId: 'x-1',
      seed: '5',
      promptPreset: 'optimized',
    })
  })
})
