import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const aceMocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  scenarios: vi.fn(),
  start: vi.fn(),
}))

vi.mock('../../api/ace', () => ({
  useAceCapabilities: aceMocks.capabilities,
  useAceScenarios: aceMocks.scenarios,
  useStartAceRun: aceMocks.start,
}))

import {
  type AceRunFormValues,
  AceRunLauncher,
  buildAceRunRequest,
  DEFAULT_ACE_RUN_FORM,
} from './AceRunLauncher'

function form(overrides: Partial<AceRunFormValues> = {}): AceRunFormValues {
  return { ...DEFAULT_ACE_RUN_FORM, ...overrides }
}

describe('AceRunLauncher request contract', () => {
  beforeEach(() => {
    aceMocks.capabilities.mockReset()
    aceMocks.scenarios.mockReset()
    aceMocks.start.mockReset()
    aceMocks.capabilities.mockReturnValue({ data: { available: true }, isLoading: false })
    aceMocks.scenarios.mockReturnValue({
      data: { items: [{ file: 'atomic.json', count: 69, scenarioIds: ['refund-01'] }] },
    })
    aceMocks.start.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      error: null,
    })
  })

  it('exposes the complete supported task, bot, model, evaluation, and fault controls', () => {
    const html = renderToStaticMarkup(<AceRunLauncher />)

    for (const label of [
      'Scenario IDs',
      'Issue filter',
      'Language filter',
      'ID knowledge filter',
      'Persistence filter',
      'Scenario limit',
      'Bot harness',
      'Custom prompt (optional)',
      'Conversation opener',
      'User-simulator model',
      'User temperature',
      'Reasoning effort',
      'Latent refund block rate',
    ]) {
      expect(html).toContain(label)
    }
    expect(html).toContain('Max messages *')
    expect(html).toContain('Cost cap (USD) *')
    expect(html).toContain('fixed ACE manifest of exactly 8 tools')
    expect(html).not.toContain('Judge sample count')
    expect(html).not.toContain('Semantic verify sample count')
    expect(html).toContain('This launch schedules 69 tasks × 1 seed')
    expect(html).toContain('Run batch · 69 episodes')
  })

  it('prefills the scenario pack and ID when launched from a task definition', () => {
    aceMocks.scenarios.mockReturnValue({
      data: {
        items: [
          { file: 'atomic.json', count: 69, scenarioIds: [] },
          { file: 'journeys.json', count: 12, scenarioIds: ['journey-07'] },
        ],
      },
    })

    const html = renderToStaticMarkup(
      <AceRunLauncher initialScenarioFile="journeys.json" initialScenarioId="journey-07" />,
    )

    expect(html).toMatch(/<option value="journeys.json" selected="">/)
    expect(html).toMatch(/value="journey-07"/)
  })

  it('keeps a fixed saved-regression token selected even before catalog refresh', () => {
    const html = renderToStaticMarkup(
      <AceRunLauncher initialScenarioFile="regression:reg-abc_123" />,
    )

    expect(html).toContain('Saved regression:reg-abc_123')
    expect(html).toMatch(/<option value="regression:reg-abc_123" selected="">/)
    expect(html).toContain('Synthetic rerun · formal metrics excluded')
    expect(html).toMatch(/<option value="counterfactual" selected="">/)
    expect(html).toMatch(/<option value="scored" disabled="">/)
  })

  it('labels and constrains a trace-derived launch as a fresh non-exact rerun', () => {
    const html = renderToStaticMarkup(
      <AceRunLauncher
        initialScenarioFile="atomic.json"
        initialScenarioId="refund-01"
        initialSeed={9}
        initialRunKind="debug"
        sourceTraceUid="simulation:parent:trace-1"
        title="Interactive branch configuration"
      />,
    )

    expect(html).toContain('Interactive branch configuration')
    expect(html).toContain('Fresh same-task rerun')
    expect(html).toContain('simulation:parent:trace-1')
    expect(html).toContain('DB, RNG, transcript, tools, and model output start fresh')
    expect(html).toMatch(/value="9"/)
    expect(html).toMatch(/<option value="debug" selected="">/)
    expect(html).toMatch(/<option value="scored" disabled="">/)
  })

  it('merges recorded initial values and explains recorded, changed, and defaulted settings', () => {
    const html = renderToStaticMarkup(
      <AceRunLauncher
        initialValues={{ model: 'recorded-model', transport: 'responses', temperature: '0.4' }}
        recordedConfig={{
          fields: {
            model: { value: 'recorded-model', display: 'recorded-model' },
            transport: { value: 'responses', display: 'responses' },
            temperature: { value: 0.4, display: '0.4' },
            checkpoints: { value: false, display: 'disabled' },
          },
          missing: [],
        }}
      />,
    )

    expect(html).toMatch(/value="recorded-model"/)
    expect(html).toMatch(/<option value="responses" selected="">/)
    expect(html).toMatch(/value="0.4"/)
    expect(html).toContain('Best-effort source configuration')
    expect(html).toContain('3 recorded · 1 changed · 16 missing/defaulted')
    expect(html).toContain('Show recorded ↔ effective config')
    expect(html).toContain('disabled')
    expect(html).toContain('enabled (Viewer invariant)')
  })

  it('maps every newly exposed field into the AceRunRequest payload', () => {
    const result = buildAceRunRequest(
      form({
        scenarioIds: 'refund-01, cancel_late-02 refund-01',
        issue: ' refund ',
        language: ' en ',
        idKnowledge: 'unknown',
        persistence: 'persistent',
        limit: '12',
        seeds: '3, 7',
        model: 'assistant-model',
        userModel: 'user-model',
        temperature: '0.4',
        userTemperature: '1.2',
        reasoningEffort: 'high',
        bot: 'workflow',
        botOpens: 'true',
        judge: 'sample',
        judgeSample: '5',
        semantic: 'sample',
        semanticSample: '6',
        latentRefundBlockRate: '0.25',
        failBefore: '0.1',
        responseLost: '0.2',
      }),
    )

    expect(result).toEqual({
      ok: true,
      request: expect.objectContaining({
        scenarioIds: ['refund-01', 'cancel_late-02'],
        filters: {
          issue: 'refund',
          language: 'en',
          idKnowledge: 'unknown',
          persistence: 'persistent',
        },
        limit: 12,
        seeds: [3, 7],
        model: 'assistant-model',
        userModel: 'user-model',
        temperature: 0.4,
        userTemperature: 1.2,
        reasoningEffort: 'high',
        bot: 'workflow',
        botOpens: true,
        judge: 'sample',
        judgeSample: 5,
        semanticVerify: 'sample',
        semanticVerifySample: 6,
        latentRefundBlockRate: 0.25,
        toolFailBeforeRate: 0.1,
        toolResponseLostRate: 0.2,
        checkpoints: true,
      }),
    })
  })

  it('maps a custom prompt only into non-scored runs', () => {
    const result = buildAceRunRequest(
      form({ runKind: 'counterfactual', prompt: 'baseline', promptText: '  custom policy  ' }),
    )
    expect(result).toEqual({
      ok: true,
      request: expect.objectContaining({
        runKind: 'counterfactual',
        prompt: 'baseline',
        promptText: 'custom policy',
      }),
    })

    expect(buildAceRunRequest(form({ runKind: 'scored', promptText: 'custom policy' }))).toEqual({
      ok: false,
      error: 'Custom prompts require a Debug or Counterfactual run so scored metrics stay clean.',
    })
  })

  it.each([
    ['maxMessages', '1', 'Max messages must be between 2 and 500.'],
    ['costCap', '0', 'Cost cap (USD) must be between 0.01 and 100000.'],
    ['temperature', '2.1', 'Temperature must be between 0 and 2.'],
    ['userTemperature', '-0.1', 'User temperature must be between 0 and 2.'],
    ['concurrency', '2.5', 'Concurrency must be a whole number between 1 and 128.'],
    ['limit', '10001', 'Scenario limit must be between 1 and 10000.'],
    ['latentRefundBlockRate', '1.1', 'Latent refund block rate must be between 0 and 1.'],
    ['failBefore', '-0.1', 'Write fail-before rate must be between 0 and 1.'],
    ['responseLost', 'NaN', 'Response-lost rate must be between 0 and 1.'],
  ] as const)('rejects invalid %s before a run can start', (field, value, error) => {
    expect(buildAceRunRequest(form({ [field]: value }))).toEqual({ ok: false, error })
  })

  it('requires and bounds sample counts only when their evaluator is in sample mode', () => {
    expect(
      buildAceRunRequest(form({ judge: 'sample', judgeSample: '', semanticSample: '9999' })),
    ).toEqual({ ok: false, error: 'Judge sample count is required.' })

    expect(
      buildAceRunRequest(
        form({ judge: 'off', judgeSample: '9999', semantic: 'sample', semanticSample: '1001' }),
      ),
    ).toEqual({
      ok: false,
      error: 'Semantic verify sample count must be between 0 and 1000.',
    })

    const off = buildAceRunRequest(
      form({ judge: 'off', judgeSample: '9999', semantic: 'off', semanticSample: '9999' }),
    )
    expect(off.ok).toBe(true)
    if (off.ok) {
      expect(off.request).not.toHaveProperty('judgeSample')
      expect(off.request).not.toHaveProperty('semanticVerifySample')
    }
  })

  it('reports malformed seeds and scenario identifiers instead of silently dropping them', () => {
    expect(buildAceRunRequest(form({ seeds: '1, nope, 2' }))).toEqual({
      ok: false,
      error: 'Seed “nope” must be a non-negative integer.',
    })
    expect(buildAceRunRequest(form({ scenarioIds: 'valid, ../../escape' }))).toEqual({
      ok: false,
      error:
        'Scenario ID “../../escape” may only use letters, numbers, dot, underscore, or hyphen.',
    })
  })

  it('adds trace ancestry only to one-task non-scored fresh reruns', () => {
    const sourceTraceUid = 'simulation:parent:trace-1'
    const valid = buildAceRunRequest(
      form({ scenarioIds: 'refund-01', seeds: '7', runKind: 'counterfactual' }),
      { sourceTraceUid },
    )
    expect(valid).toEqual({
      ok: true,
      request: expect.objectContaining({ sourceTraceUid, scenarioIds: ['refund-01'], seeds: [7] }),
    })

    expect(
      buildAceRunRequest(form({ scenarioIds: 'refund-01', seeds: '7', runKind: 'scored' }), {
        sourceTraceUid,
      }),
    ).toEqual({
      ok: false,
      error: 'Trace-derived fresh reruns must be Debug or Counterfactual, never Scored.',
    })
    expect(
      buildAceRunRequest(form({ scenarioIds: 'refund-01', seeds: '7,8', runKind: 'debug' }), {
        sourceTraceUid,
      }),
    ).toEqual({
      ok: false,
      error: 'A trace-derived branch requires exactly one Scenario ID and one seed.',
    })
  })

  it('rejects a scored regression token even when form state is constructed directly', () => {
    expect(
      buildAceRunRequest(form({ scenarioFile: 'regression:reg-production', runKind: 'scored' })),
    ).toEqual({
      ok: false,
      error:
        'Synthetic regression reruns must be Debug or Counterfactual; formal metrics are excluded.',
    })
  })
})
