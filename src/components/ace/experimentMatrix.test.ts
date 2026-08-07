import { describe, expect, it } from 'vitest'
import { parseAceRunRequest } from '../../../server/ace/requests'
import {
  buildExperimentMatrix,
  defaultExperimentId,
  defaultExperimentMatrixValues,
  type ExperimentMatrixValues,
  experimentCompareHref,
} from './experimentMatrix'

function values(overrides: Partial<ExperimentMatrixValues> = {}): ExperimentMatrixValues {
  const defaults = defaultExperimentMatrixValues(new Date('2026-08-06T12:34:56.789Z'))
  return {
    ...defaults,
    experimentId: 'refund-policy-test',
    scenarioFile: 'sealed.json',
    scenarioId: 's-refund-00',
    seeds: '7, 11, 7',
    ...overrides,
    a: { ...defaults.a, ...overrides.a },
    b: { ...defaults.b, ...overrides.b },
  }
}

describe('ACE experiment matrix request builder', () => {
  it('generates deterministic safe IDs for a supplied clock', () => {
    expect(defaultExperimentId(new Date('2026-08-06T12:34:56.789Z'))).toBe(
      'experiment-20260806123456-789',
    )
  })

  it('builds two matched immutable requests while keeping variant policy independent', () => {
    const result = buildExperimentMatrix(
      values({
        runKind: 'counterfactual',
        maxMessages: '60',
        costCapUsd: '2.5',
        stateScope: 'journey',
        latentRefundBlockRate: '0.2',
        toolFailBeforeRate: '0.1',
        toolResponseLostRate: '0.05',
        a: {
          ...values().a,
          bot: 'playbook',
          model: 'gpt-5.2',
          promptPreset: 'improved',
          temperature: '0.3',
          transport: 'responses',
          reasoningEffort: 'high',
        },
        b: {
          ...values().b,
          bot: 'workflow',
          model: 'gpt-5.4-mini',
          promptMode: 'custom',
          promptText: 'Use the experimental policy.',
          temperature: '0.7',
          transport: 'chat',
          reasoningEffort: 'minimal',
        },
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.runIds).toEqual({
      a: 'refund-policy-test-a',
      b: 'refund-policy-test-b',
    })
    expect(result.plan.policyChanged).toEqual({ a: false, b: true })
    expect(result.plan.identicalVariants).toBe(false)

    const { a, b } = result.plan.requests
    const shared = {
      scenarioFile: 'sealed.json',
      scenarioIds: ['s-refund-00'],
      seeds: [7, 11],
      runKind: 'counterfactual',
      maxMessages: 60,
      costCapUsd: 2.5,
      stateScope: 'journey',
      latentRefundBlockRate: 0.2,
      toolFailBeforeRate: 0.1,
      toolResponseLostRate: 0.05,
      checkpoints: true,
    }
    expect(a).toMatchObject(shared)
    expect(b).toMatchObject(shared)
    expect(a).toMatchObject({
      batchId: 'refund-policy-test-a',
      bot: 'playbook',
      model: 'gpt-5.2',
      prompt: 'improved',
      temperature: 0.3,
      transport: 'responses',
      reasoningEffort: 'high',
    })
    expect(a).not.toHaveProperty('promptText')
    expect(b).toMatchObject({
      batchId: 'refund-policy-test-b',
      bot: 'workflow',
      model: 'gpt-5.4-mini',
      prompt: 'optimized',
      promptText: 'Use the experimental policy.',
      temperature: 0.7,
      transport: 'chat',
      reasoningEffort: 'minimal',
    })
  })

  it('allows identical variants but marks the replication explicitly', () => {
    const common = values().a
    const result = buildExperimentMatrix(values({ a: common, b: { ...common } }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.plan.identicalVariants).toBe(true)
  })

  it.each([
    [
      { experimentId: '../escape' },
      'Experiment ID must be 1–126 characters using only letters, numbers, dot, underscore, or hyphen.',
    ],
    [
      { scenarioId: '' },
      'Task ID is required and may only use letters, numbers, dot, underscore, or hyphen.',
    ],
    [{ seeds: '1, nope' }, 'Seed “nope” must be a non-negative integer.'],
    [{ maxMessages: '1' }, 'Max messages must be a whole number between 2 and 500.'],
    [{ costCapUsd: '0' }, 'Per-run cost cap (USD) must be between 0.01 and 100000.'],
    [{ toolResponseLostRate: '1.1' }, 'Response-lost rate must be between 0 and 1.'],
  ] as const)('rejects an unsafe shared matrix contract', (override, error) => {
    expect(buildExperimentMatrix(values(override))).toEqual({ ok: false, error })
  })

  it('rejects unsafe variant config and empty custom prompts before either run starts', () => {
    expect(buildExperimentMatrix(values({ a: { ...values().a, model: '../bad model' } }))).toEqual({
      ok: false,
      error: 'Variant A model is not a safe model identifier.',
    })
    expect(
      buildExperimentMatrix(
        values({ b: { ...values().b, promptMode: 'custom', promptText: '   ' } }),
      ),
    ).toEqual({
      ok: false,
      error: 'Variant B custom prompt must be non-empty and at most 1000000 characters.',
    })
    expect(
      buildExperimentMatrix(values({ runKind: 'scored' as ExperimentMatrixValues['runKind'] })),
    ).toEqual({
      ok: false,
      error: 'Experiment matrices must be debug or counterfactual runs, never scored runs.',
    })
  })

  it('creates the exact matched Compare deep link', () => {
    const href = experimentCompareHref(
      { a: 'refund-policy-test-a', b: 'refund-policy-test-b' },
      's-refund-00',
    )
    expect(Object.fromEntries(new URL(href, 'http://localhost').searchParams)).toEqual({
      runA: 'refund-policy-test-a',
      runB: 'refund-policy-test-b',
      instance: 's-refund-00',
    })
  })

  it('produces two requests accepted by the fixed ACE bridge parser without launching them', () => {
    const result = buildExperimentMatrix(
      values({
        b: {
          ...values().b,
          promptMode: 'custom',
          promptText: 'A local counterfactual prompt.',
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const parsedA = parseAceRunRequest(result.plan.requests.a)
    const parsedB = parseAceRunRequest(result.plan.requests.b)
    expect(parsedA.runId).toBe('refund-policy-test-a')
    expect(parsedB.runId).toBe('refund-policy-test-b')
    expect(parsedA.bridgeParams).toMatchObject({
      scenarioIds: ['s-refund-00'],
      seeds: [7, 11],
      promptPreset: 'baseline',
    })
    expect(parsedB.bridgeParams).toMatchObject({
      scenarioIds: ['s-refund-00'],
      seeds: [7, 11],
      promptText: 'A local counterfactual prompt.',
    })
  })
})
