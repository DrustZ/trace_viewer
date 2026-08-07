import { describe, expect, it } from 'vitest'
import { AceRequestError, parseAceRunRequest, parseControlRequest } from './requests'

const validRequest = {
  scenarioFile: 'atomic.json',
  scenarioIds: ['cancel-late-01', 'refund_02'],
  seeds: [7, 11],
  batchId: 'cockpit-test-1',
  runKind: 'scored',
  prompt: 'optimized',
  transport: 'chat',
  model: 'openai/gpt-5-mini:2026-08-01',
  userModel: 'gpt-5-mini',
  temperature: 0.25,
  userTemperature: 0.8,
  reasoningEffort: 'medium',
  bot: 'workflow',
  botOpens: false,
  filters: { issue: 'refund_payment', language: 'en' },
  limit: 2,
  maxMessages: 24,
  costCapUsd: 12.5,
  concurrency: 3,
  stateScope: 'episode',
  latentRefundBlockRate: 0.15,
  toolFailBeforeRate: 0.1,
  toolResponseLostRate: 0.2,
  judge: 'sample',
  judgeSample: 2,
  semanticVerify: 'all',
  semanticVerifySample: 3,
  checkpoints: true,
} as const

describe('parseAceRunRequest', () => {
  it('translates the public contract to the fixed Python bridge vocabulary', () => {
    const parsed = parseAceRunRequest(validRequest)

    expect(parsed.runId).toBe('cockpit-test-1')
    expect(parsed.bridgeParams).toEqual({
      runId: 'cockpit-test-1',
      scenariosFile: 'atomic.json',
      scenarioIds: ['cancel-late-01', 'refund_02'],
      seeds: [7, 11],
      runKind: 'scored',
      promptPreset: 'optimized',
      transport: 'chat_completions',
      model: 'openai/gpt-5-mini:2026-08-01',
      userModel: 'gpt-5-mini',
      temperature: 0.25,
      userTemperature: 0.8,
      reasoningEffort: 'medium',
      bot: 'workflow',
      botOpens: false,
      filters: { issue: 'refund_payment', language: 'en' },
      limit: 2,
      maxMessages: 24,
      costCapUsd: 12.5,
      concurrency: 3,
      stateScope: 'episode',
      latentRefundBlockRate: 0.15,
      toolFailBeforeRate: 0.1,
      toolResponseLostRate: 0.2,
      judge: 'sample',
      judgeSample: 2,
      semanticVerify: 'all',
      semanticVerifySample: 3,
    })
    expect(parsed.bridgeParams).not.toHaveProperty('command')
    expect(parsed.bridgeParams).not.toHaveProperty('checkpoints')
  })

  it('maps Responses without allowing callers to inject bridge fields', () => {
    const parsed = parseAceRunRequest({
      ...validRequest,
      transport: 'responses',
      prompt: 'baseline',
      runKind: 'debug',
    })
    expect(parsed.bridgeParams.transport).toBe('responses')
    expect(parsed.bridgeParams.promptPreset).toBe('baseline')

    expect(() => parseAceRunRequest({ ...validRequest, command: 'rm -rf /' })).toThrowError(
      new AceRequestError('unknown field(s): command'),
    )
  })

  it('accepts only the fixed regression artifact token, never a regression path', () => {
    const parsed = parseAceRunRequest({
      ...validRequest,
      scenarioFile: 'regression:reg-abc_123',
      scenarioIds: undefined,
    })
    expect(parsed.bridgeParams.scenariosFile).toBe('regression:reg-abc_123')
    expect(() =>
      parseAceRunRequest({ ...validRequest, scenarioFile: 'regression:../escape' }),
    ).toThrow(AceRequestError)
  })

  it('uses an inline prompt instead of a preset without accepting prompt paths', () => {
    const parsed = parseAceRunRequest({
      ...validRequest,
      runKind: 'counterfactual',
      prompt: 'baseline',
      promptText: 'You are the counterfactual ACE support policy.',
    })
    expect(parsed.bridgeParams.promptText).toBe('You are the counterfactual ACE support policy.')
    expect(parsed.bridgeParams).not.toHaveProperty('promptPreset')
    expect(() => parseAceRunRequest({ ...validRequest, promptFile: '/tmp/prompt' })).toThrow(
      'unknown field(s): promptFile',
    )
    expect(() =>
      parseAceRunRequest({ ...validRequest, promptText: 'custom scored prompt' }),
    ).toThrow('custom promptText requires a debug or counterfactual run')
  })

  it.each([
    ['path traversal', { scenarioFile: '../atomic.json' }],
    ['nested path', { scenarioFile: 'nested/atomic.json' }],
    ['non-json pack', { scenarioFile: 'atomic.yaml' }],
    ['duplicate seeds', { seeds: [1, 1] }],
    ['negative seed', { seeds: [-1] }],
    ['unsafe batch id', { batchId: '../run' }],
    ['unsafe model', { model: 'gpt\nmalicious' }],
    ['unsafe user model', { userModel: '../bad model' }],
    ['empty inline prompt', { promptText: '   ' }],
    ['unknown scenario filter', { filters: { suite: 'sealed' } }],
    ['bad botOpens', { botOpens: 'yes' }],
    ['bad reasoning effort', { reasoningEffort: 'ultra' }],
    ['missing cost cap', { costCapUsd: undefined }],
    ['too-low cost cap', { costCapUsd: 0 }],
    ['non-integer max messages', { maxMessages: 4.5 }],
    ['disabled checkpoints', { checkpoints: false }],
  ])('rejects %s', (_label, patch) => {
    expect(() => parseAceRunRequest({ ...validRequest, ...patch })).toThrow(AceRequestError)
  })

  it('generates a bounded safe run id when batchId is omitted', () => {
    const parsed = parseAceRunRequest({ ...validRequest, batchId: undefined })
    expect(parsed.runId).toMatch(/^cockpit-\d{14}-[0-9a-f]{6}$/)
    expect(parsed.bridgeParams.runId).toBe(parsed.runId)
  })

  it('accepts canonical trace ancestry only for one-task non-scored fresh reruns', () => {
    const parsed = parseAceRunRequest({
      ...validRequest,
      scenarioIds: ['cancel-late-01'],
      seeds: [7],
      runKind: 'debug',
      sourceTraceUid: 'simulation:parent-run:trace-1',
    })

    expect(parsed.request.sourceTraceUid).toBe('simulation:parent-run:trace-1')
    expect(parsed.bridgeParams).not.toHaveProperty('sourceTraceUid')
    expect(parsed.bridgeParams).not.toHaveProperty('lineage')

    expect(() => parseAceRunRequest({ ...validRequest, sourceTraceUid: 'trace-1' })).toThrow(
      'trace-derived fresh reruns must be debug or counterfactual',
    )
    expect(() =>
      parseAceRunRequest({
        ...validRequest,
        runKind: 'debug',
        sourceTraceUid: 'trace-1',
      }),
    ).toThrow('require exactly one scenarioId and one seed')
    expect(() =>
      parseAceRunRequest({
        ...validRequest,
        scenarioIds: ['cancel-late-01'],
        seeds: [7],
        runKind: 'debug',
        sourceTraceUid: 'bad\nuid',
      }),
    ).toThrow('sourceTraceUid must be a non-empty opaque identifier')
  })
})

describe('parseControlRequest', () => {
  it.each(['pause', 'resume', 'cancel'] as const)('accepts %s only', (action) => {
    expect(parseControlRequest({ action })).toBe(action)
  })

  it('rejects bridge parameter injection', () => {
    expect(() => parseControlRequest({ action: 'pause', runId: '../other' })).toThrow(
      'control accepts only action',
    )
  })
})
