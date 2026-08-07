import type { AceTaskDetail } from '@shared/schema/aceTasks'
import type { Trace } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import { buildAceRunRequest, DEFAULT_ACE_RUN_FORM } from './AceRunLauncher'
import {
  interactiveLabHref,
  taskScenarioFiles,
  traceEnvironmentSeed,
  traceRunFormOverrides,
  traceRunRecordedConfig,
} from './interactiveLab'

function trace(extra: Record<string, unknown> = {}): Trace {
  return {
    meta: {
      traceId: 'producer-id',
      traceUid: 'simulation:run-a:canonical',
      corpusId: 'simulation',
      instanceId: 'task-1',
      component: 'ace/test',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
      extra,
    },
    messages: [],
    stats: {
      score: null,
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

describe('interactive lab launch helpers', () => {
  it('uses canonical trace identity and never a duplicate producer id', () => {
    expect(interactiveLabHref(trace())).toBe('/ace/lab?trace=simulation%3Arun-a%3Acanonical')
  })

  it('uses only an explicitly recorded non-negative environment seed', () => {
    expect(traceEnvironmentSeed(trace({ environment_seed: 17 }))).toBe(17)
    expect(traceEnvironmentSeed(trace({ environmentSeed: 9 }))).toBe(9)
    expect(traceEnvironmentSeed(trace({ environment_seed: '17' }))).toBeUndefined()
    expect(traceEnvironmentSeed(trace())).toBeUndefined()
  })

  it('lists authoritative task packs as safe basenames and exposes conflicts', () => {
    const task = {
      variants: [
        { sources: [{ file: 'configs/scenarios/sealed.json' }] },
        {
          sources: [{ file: 'configs/scenarios/atomic.json' }, { file: '../unsafe pack.json' }],
        },
      ],
    } as AceTaskDetail
    expect(taskScenarioFiles(task)).toEqual(['atomic.json', 'sealed.json'])
  })

  it('projects every recorded policy, harness, evaluator, fault, and checkpoint setting', () => {
    const source = trace({
      config_snapshot: {
        runner: {
          max_messages: 28,
          concurrency: 3,
          bot_opens: false,
          state_scope: 'journey',
          latent_refund_block_rate: 0.2,
          tool_fail_before_rate: 0.1,
          tool_response_lost_rate: 0.05,
          judge_mode: 'sample',
          judge_sample: 4,
          semantic_verify_mode: 'sample',
          semantic_verify_sample: 2,
          checkpoint_enabled: true,
        },
        spec: {
          prompt_source: { kind: 'preset', value: 'improved' },
          prompt_snapshot: { bot: 'recorded prompt text' },
          bot_model: 'assistant-recorded',
          user_model: 'user-recorded',
          bot_temperature: 0.4,
          user_temperature: 1.1,
          agent_transport: 'responses',
          reasoning_effort: 'high',
          bot: 'workflow',
        },
      },
    })

    expect(traceRunFormOverrides(source)).toEqual({
      prompt: 'improved',
      model: 'assistant-recorded',
      userModel: 'user-recorded',
      temperature: '0.4',
      userTemperature: '1.1',
      transport: 'responses',
      reasoningEffort: 'high',
      bot: 'workflow',
      botOpens: 'false',
      stateScope: 'journey',
      maxMessages: '28',
      concurrency: '3',
      latentRefundBlockRate: '0.2',
      failBefore: '0.1',
      responseLost: '0.05',
      judge: 'sample',
      judgeSample: '4',
      semantic: 'sample',
      semanticSample: '2',
    })
    const recorded = traceRunRecordedConfig(source)
    expect(recorded.missing).toEqual([])
    expect(recorded.fields).toMatchObject({
      prompt: { value: 'preset:improved' },
      model: { value: 'assistant-recorded' },
      transport: { value: 'responses' },
      checkpoints: { value: true },
    })

    const built = buildAceRunRequest(
      {
        ...DEFAULT_ACE_RUN_FORM,
        ...traceRunFormOverrides(source),
        scenarioIds: 'task-1',
        seeds: '7',
        runKind: 'debug',
      },
      { sourceTraceUid: 'simulation:run-a:canonical' },
    )
    expect(built).toEqual({
      ok: true,
      request: expect.objectContaining({
        prompt: 'improved',
        model: 'assistant-recorded',
        userModel: 'user-recorded',
        transport: 'responses',
        temperature: 0.4,
        userTemperature: 1.1,
        reasoningEffort: 'high',
        bot: 'workflow',
        botOpens: false,
        maxMessages: 28,
        concurrency: 3,
        stateScope: 'journey',
        latentRefundBlockRate: 0.2,
        toolFailBeforeRate: 0.1,
        toolResponseLostRate: 0.05,
        judge: 'sample',
        judgeSample: 4,
        semanticVerify: 'sample',
        semanticVerifySample: 2,
        checkpoints: true,
        sourceTraceUid: 'simulation:run-a:canonical',
      }),
    })
  })

  it('copies an inline/file prompt snapshot and leaves absent config explicitly missing', () => {
    const source = trace({
      config_snapshot: {
        spec: {
          prompt_source: { kind: 'file', value: 'configs/prompts/custom.md' },
          prompt_snapshot: { bot: 'Full recorded custom policy.' },
        },
      },
    })

    expect(traceRunFormOverrides(source)).toEqual({
      promptText: 'Full recorded custom policy.',
    })
    const recorded = traceRunRecordedConfig(source)
    expect(recorded.fields.prompt).toMatchObject({
      value: 'inline:Full recorded custom policy.',
    })
    expect(recorded.missing).toContain('model')
    expect(recorded.missing).toContain('checkpoints')
  })
})
