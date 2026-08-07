import { describe, expect, it } from 'vitest'
import { parseAceRegressionScenarioSnapshot } from './aceRegression'

const valid = {
  scenario_id: 'production-case-17',
  suite: 'regression',
  card: {
    issue: 'refund_payment',
    language: 'en',
    id_knowledge: 'exact',
    patience: 5,
    persistence: 'pushes_back',
    style: ['frustrated'],
    order_id: 'order_003',
    goal: 'Get the incorrect charge refunded.',
  },
  expected_actions: [
    { name: 'issue_refund', args_subset: { order_id: 'order_003', amount: 1200 } },
  ],
  forbidden_actions: ['cancel_order'],
  expected_outcome: 'refund',
  reward_basis: ['ACTIONS', 'OUTCOME'],
  authorized_effects: [{ order_id: 'order_003', effects: ['refund'], refund_cap: 1200 }],
  required_info: [{ kind: 'money', value: 1200 }],
  expected_state_delta: [{ order_id: 'order_003', field: 'refunded_total', to: 1200 }],
  must_precede: [['check_valid_remediations', 'issue_refund', { order_id: '@grounding' }]],
} as const

describe('parseAceRegressionScenarioSnapshot', () => {
  it('clones the bounded ACE Scenario surface used for a synthetic rerun', () => {
    const parsed = parseAceRegressionScenarioSnapshot(valid)

    expect(parsed).toEqual(valid)
    expect(parsed).not.toBe(valid)
  })

  it.each([
    ['missing grounding order', { card: { ...valid.card, order_id: '' } }],
    ['unsafe scenario id', { scenario_id: '../escape' }],
    ['unsupported tool', { expected_actions: [{ name: 'run_shell' }] }],
    ['unknown card field', { card: { ...valid.card, prompt: '/tmp/secret' } }],
    ['unknown top-level field', { outputPath: '/tmp/escape' }],
    ['invalid reward basis', { reward_basis: ['LLM_JUDGE'] }],
  ])('rejects %s before the bridge is called', (_label, patch) => {
    expect(() =>
      parseAceRegressionScenarioSnapshot({
        ...valid,
        ...patch,
      }),
    ).toThrow()
  })
})
