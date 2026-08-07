import { describe, expect, it } from 'vitest'
import { compareAceRunConfig } from './runConfigFidelity'

function snapshot(
  overrides: {
    promptSource?: Record<string, unknown>
    promptText?: string
    checkpoints?: boolean
  } = {},
) {
  return {
    runner: {
      max_messages: 20,
      concurrency: 2,
      bot_opens: true,
      state_scope: 'episode',
      latent_refund_block_rate: 0,
      tool_fail_before_rate: 0,
      tool_response_lost_rate: 0,
      judge_mode: 'off',
      judge_sample: 1,
      semantic_verify_mode: 'off',
      semantic_verify_sample: 1,
      checkpoint_enabled: overrides.checkpoints ?? true,
    },
    spec: {
      prompt_source: overrides.promptSource ?? { kind: 'preset', value: 'baseline' },
      ...(overrides.promptText ? { prompt_snapshot: { bot: overrides.promptText } } : {}),
      bot_model: 'gpt-5-mini',
      user_model: 'gpt-5-mini',
      bot_temperature: 0.3,
      user_temperature: 0.9,
      agent_transport: 'responses',
      reasoning_effort: 'low',
      bot: 'baseline',
    },
  }
}

function child(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'child',
    scenariosFile: 'atomic.json',
    scenarioIds: ['scenario-01'],
    seeds: [3],
    runKind: 'debug',
    promptPreset: 'baseline',
    transport: 'responses',
    maxMessages: 20,
    costCapUsd: 5,
    ...overrides,
  }
}

describe('fresh-rerun config fidelity', () => {
  it('recognizes an exact Viewer-effective snapshot independent of run kind', () => {
    expect(compareAceRunConfig(snapshot(), child({ runKind: 'counterfactual' }))).toEqual({
      configExact: true,
      policyChanged: false,
      changedFields: [],
      missingFields: [],
    })
  })

  it('compares resolved preset bytes when the source recorded a prompt snapshot', () => {
    const recorded = snapshot({ promptText: 'Recorded baseline bytes' })
    expect(
      compareAceRunConfig(recorded, child(), {
        effectivePromptText: 'Recorded baseline bytes',
      }),
    ).toMatchObject({ configExact: true, policyChanged: false })
    expect(
      compareAceRunConfig(recorded, child(), {
        effectivePromptText: 'Edited baseline bytes',
      }),
    ).toMatchObject({
      configExact: false,
      policyChanged: true,
      changedFields: ['prompt'],
    })
  })

  it('compares inline prompt content and detects preset or model policy changes', () => {
    const inline = snapshot({
      promptSource: { kind: 'inline', value: null },
      promptText: 'Exact recorded policy',
    })
    expect(
      compareAceRunConfig(
        inline,
        child({ promptPreset: undefined, promptText: 'Exact recorded policy' }),
      ),
    ).toMatchObject({ configExact: true, policyChanged: false })

    expect(
      compareAceRunConfig(snapshot(), child({ promptPreset: 'optimized', model: 'changed-model' })),
    ).toMatchObject({
      configExact: false,
      policyChanged: true,
      changedFields: expect.arrayContaining(['prompt', 'model', 'userModel']),
    })
  })

  it('separates non-policy config changes from policy changes', () => {
    expect(compareAceRunConfig(snapshot({ checkpoints: false }), child())).toMatchObject({
      configExact: false,
      policyChanged: false,
      changedFields: ['checkpoints'],
    })
  })

  it('treats a missing source snapshot as best-effort with unknown policy fidelity', () => {
    const comparison = compareAceRunConfig(undefined, child())
    expect(comparison.configExact).toBe(false)
    expect(comparison.missingFields).toHaveLength(20)
    expect(comparison).not.toHaveProperty('policyChanged')
  })
})
