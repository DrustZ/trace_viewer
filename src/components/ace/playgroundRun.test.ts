import type { Trace } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import {
  buildPlaygroundRunRequest,
  DEFAULT_PLAYGROUND_CONFIG,
  EPISODE_POLL_MS,
  episodePollInterval,
  episodeSettled,
  initialPlaygroundConfig,
  isExistingRunConflict,
  type PlaygroundRunConfig,
  quickRunSelection,
  resolveScenarioPack,
  runtimeErrorSummary,
  shouldAutorun,
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
        // Canonical batches all run responses; the chat endpoint rejects
        // function tools whenever reasoning is not 'none'.
        transport: 'responses',
        bot: 'playbook',
        model: 'gpt-5-mini',
        temperature: 0.4,
        reasoningEffort: 'low',
        costCapUsd: 2,
        checkpoints: true,
      },
    })
  })

  it("rejects chat transport with any reasoning effort other than 'none' before submit", () => {
    // Explicit non-none reasoning and the runner default ('' → low) both fail.
    for (const reasoningEffort of ['low', 'minimal', ''] as const) {
      expect(buildPlaygroundRunRequest(config({ transport: 'chat', reasoningEffort }))).toMatchObject({
        ok: false,
        error: expect.stringContaining("reasoning effort 'none'"),
      })
    }
  })

  it("allows the recorded chat + reasoning 'none' combination through unchanged", () => {
    expect(
      buildPlaygroundRunRequest(config({ transport: 'chat', reasoningEffort: 'none' })),
    ).toMatchObject({
      ok: true,
      request: { transport: 'chat', reasoningEffort: 'none' },
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

describe('quickRunSelection', () => {
  const packs = [{ file: 'atomic.json' }, { file: 'multi.json' }]
  const tasks = [
    { scenarioId: 'multi-1', sourceFiles: ['configs/scenarios/multi.json'] },
    { scenarioId: 'atomic-1', sourceFiles: ['configs/scenarios/atomic.json'] },
    { scenarioId: 'atomic-2', sourceFiles: ['configs/scenarios/atomic.json'] },
  ]

  it('picks the first scenario of the default (first) pack with seed 1', () => {
    expect(quickRunSelection(packs, tasks)).toEqual({
      scenarioFile: 'atomic.json',
      scenarioId: 'atomic-1',
      seed: '1',
    })
  })

  it('honors the currently selected pack when it exists in the catalog', () => {
    expect(quickRunSelection(packs, tasks, 'multi.json')).toEqual({
      scenarioFile: 'multi.json',
      scenarioId: 'multi-1',
      seed: '1',
    })
  })

  it('falls back to the first pack when the preferred file is unknown', () => {
    expect(quickRunSelection(packs, tasks, 'missing.json')).toMatchObject({
      scenarioFile: 'atomic.json',
      scenarioId: 'atomic-1',
    })
  })

  it('returns null until packs and matching scenarios have loaded', () => {
    expect(quickRunSelection([], tasks)).toBeNull()
    expect(quickRunSelection(packs, [])).toBeNull()
    expect(
      quickRunSelection([{ file: 'empty.json' }], tasks), // pack with no scenarios
    ).toBeNull()
  })
})

describe('resolveScenarioPack', () => {
  const tasks = [
    { scenarioId: 'ab-idbait-00-refund_payment', sourceFiles: ['configs/scenarios/ab.json'] },
    { scenarioId: 'atomic-1', sourceFiles: ['configs/scenarios/atomic.json'] },
  ]

  it('corrects a trace-prefilled scenario to the pack that actually contains it', () => {
    expect(resolveScenarioPack('ab-idbait-00-refund_payment', 'atomic.json', tasks)).toBe('ab.json')
  })

  it('leaves the pack alone when it already owns the scenario', () => {
    expect(resolveScenarioPack('atomic-1', 'atomic.json', tasks)).toBeUndefined()
    expect(
      resolveScenarioPack('ab-idbait-00-refund_payment', 'configs/scenarios/ab.json', tasks),
    ).toBeUndefined()
  })

  it('stays silent for an empty or unknown scenario and an unloaded catalog', () => {
    expect(resolveScenarioPack('', 'atomic.json', tasks)).toBeUndefined()
    expect(resolveScenarioPack('missing-99', 'atomic.json', tasks)).toBeUndefined()
    expect(resolveScenarioPack('atomic-1', 'multi.json', [])).toBeUndefined()
  })
})

describe('shouldAutorun', () => {
  const ready = {
    requested: true,
    alreadyFired: false,
    capabilitiesKnown: true,
    bridgeAvailable: true,
    scenarioId: 'scenario-01',
    seed: '3',
  }

  it('fires once for a complete prefilled config', () => {
    expect(shouldAutorun(ready)).toBe(true)
  })

  it('never fires twice: the guard flag wins over everything else', () => {
    expect(shouldAutorun({ ...ready, alreadyFired: true })).toBe(false)
  })

  it('waits for capabilities and requires a live bridge', () => {
    expect(shouldAutorun({ ...ready, capabilitiesKnown: false })).toBe(false)
    expect(shouldAutorun({ ...ready, bridgeAvailable: false })).toBe(false)
  })

  it('never runs on top of an existing session (run param present)', () => {
    expect(shouldAutorun({ ...ready, selectedRunId: 'run-1' })).toBe(false)
  })

  it('requires an explicit request and a complete scenario + seed', () => {
    expect(shouldAutorun({ ...ready, requested: false })).toBe(false)
    expect(shouldAutorun({ ...ready, scenarioId: '' })).toBe(false)
    expect(shouldAutorun({ ...ready, seed: ' ' })).toBe(false)
  })
})

describe('episodePollInterval (SSE fallback)', () => {
  it('polls while the run is active in any pre-terminal lifecycle', () => {
    for (const lifecycle of ['queued', 'running', 'paused', 'cancelling']) {
      expect(episodePollInterval({ lifecycle })).toBe(EPISODE_POLL_MS)
    }
  })

  it('polls while the batch manifest has not appeared yet (starting window)', () => {
    expect(episodePollInterval({})).toBe(EPISODE_POLL_MS)
    expect(episodePollInterval({ episodeSettled: false })).toBe(EPISODE_POLL_MS)
  })

  it('stops on terminal lifecycles', () => {
    for (const lifecycle of ['completed', 'failed', 'cancelled']) {
      expect(episodePollInterval({ lifecycle })).toBe(false)
    }
  })

  it('stops without a manifest once the episode itself has settled', () => {
    expect(episodePollInterval({ episodeSettled: true })).toBe(false)
  })
})

describe('runtimeErrorSummary', () => {
  const providerError =
    "BadRequestError: Error code: 400 - {'error': {'message': \"Function tools with reasoning_effort are not supported…\"}}" +
    '\nTraceback (most recent call last):\n  …'

  it('surfaces the first line of the run manifest lifecycle error', () => {
    expect(runtimeErrorSummary(providerError, undefined)).toBe(providerError.split('\n')[0])
  })

  it('falls back to the runtime failure evidence of a runtime_error episode', () => {
    const trace = sourceTrace()
    trace.evaluation = {
      lifecycle: { state: 'failed' },
      outcome: 'runtime_error',
      checks: [],
      metrics: {},
      failures: [
        {
          origin: 'runtime',
          code: 'runtime.failed',
          severity: 'critical',
          gating: false,
          evidence: 'Episode runtime failed.',
          source: 'ace.batch',
        },
      ],
      flags: [],
      worldDiff: [],
      ledger: [],
    }
    expect(runtimeErrorSummary(undefined, trace)).toBe('Episode runtime failed.')
  })

  it('stays silent for healthy sessions', () => {
    expect(runtimeErrorSummary(undefined, undefined)).toBeUndefined()
    const passed = sourceTrace()
    passed.evaluation = {
      lifecycle: { state: 'completed' },
      outcome: 'pass',
      checks: [],
      metrics: {},
      failures: [],
      flags: [],
      worldDiff: [],
      ledger: [],
    }
    expect(runtimeErrorSummary(undefined, passed)).toBeUndefined()
    expect(runtimeErrorSummary('', passed)).toBeUndefined()
  })
})

describe('isExistingRunConflict (idempotent retry attach)', () => {
  it('recognizes the runner duplicate-batch rejection and the bridge active-run conflict', () => {
    expect(
      isExistingRunConflict(
        new Error(
          '{"error":"ValueError: batch \'viewer-1\' already exists with a different configuration"}',
        ),
      ),
    ).toBe(true)
    expect(isExistingRunConflict(new Error('ACE run is already active: viewer-1'))).toBe(true)
  })

  it('leaves every other failure on the visible error path', () => {
    expect(isExistingRunConflict(new Error('Cost cap must be between 0.01 and 100'))).toBe(false)
    expect(isExistingRunConflict(new Error('The user aborted a request.'))).toBe(false)
    expect(isExistingRunConflict('already exists')).toBe(false)
    expect(isExistingRunConflict(undefined)).toBe(false)
  })
})

describe('episodeSettled', () => {
  it('is false without a trace or while the episode is executing', () => {
    expect(episodeSettled(undefined)).toBe(false)
    const trace = sourceTrace()
    trace.meta.status = 'executing'
    expect(episodeSettled(trace)).toBe(false)
  })

  it('is false while the grade is still pending', () => {
    const trace = sourceTrace()
    trace.meta.status = 'completed'
    trace.evaluation = {
      lifecycle: { state: 'executing', pendingPhase: 'grading' },
      outcome: 'ungraded',
      checks: [],
      metrics: {},
      failures: [],
      flags: [],
      worldDiff: [],
      ledger: [],
    }
    expect(episodeSettled(trace)).toBe(false)
  })

  it('is true for a terminal status with no pending phase', () => {
    const trace = sourceTrace()
    trace.meta.status = 'completed'
    expect(episodeSettled(trace)).toBe(true)
  })
})

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

  it('replays a recorded chat_completions + none transport and defaults responses otherwise', () => {
    const recorded = sourceTrace()
    const spec = (recorded.meta.extra?.config_snapshot as { spec: Record<string, unknown> }).spec
    spec.agent_transport = 'chat_completions'
    spec.reasoning_effort = 'none'
    expect(initialPlaygroundConfig({}, recorded)).toMatchObject({
      transport: 'chat',
      reasoningEffort: 'none',
    })

    // A trace without a recorded transport gets the canonical default.
    expect(initialPlaygroundConfig({}, sourceTrace()).transport).toBe('responses')
    expect(initialPlaygroundConfig({}).transport).toBe('responses')
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
