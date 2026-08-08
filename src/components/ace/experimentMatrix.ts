import {
  ACE_PROMPT_PRESETS,
  type AcePromptPreset,
  type AceRunRequest,
} from '@shared/schema/ace'

const SAFE_EXPERIMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,125}$/
const SAFE_SCENARIO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_SCENARIO_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const MAX_INLINE_PROMPT = 1_000_000

export type ExperimentRunKind = 'debug' | 'counterfactual'
export type ExperimentPromptMode = 'preset' | 'custom'
export type ExperimentReasoningEffort = NonNullable<AceRunRequest['reasoningEffort']> | ''

export interface ExperimentVariantValues {
  bot: NonNullable<AceRunRequest['bot']>
  model: string
  promptMode: ExperimentPromptMode
  promptPreset: AcePromptPreset
  promptText: string
  temperature: string
  transport: AceRunRequest['transport']
  reasoningEffort: ExperimentReasoningEffort
}

export interface ExperimentMatrixValues {
  experimentId: string
  scenarioFile: string
  scenarioId: string
  seeds: string
  runKind: ExperimentRunKind
  maxMessages: string
  costCapUsd: string
  stateScope: NonNullable<AceRunRequest['stateScope']>
  latentRefundBlockRate: string
  toolFailBeforeRate: string
  toolResponseLostRate: string
  a: ExperimentVariantValues
  b: ExperimentVariantValues
}

export interface ExperimentMatrixPlan {
  experimentId: string
  instanceId: string
  requests: { a: AceRunRequest; b: AceRunRequest }
  runIds: { a: string; b: string }
  policyChanged: { a: boolean; b: boolean }
  identicalVariants: boolean
}

export type ExperimentMatrixResult =
  | { ok: true; plan: ExperimentMatrixPlan }
  | { ok: false; error: string }

export function defaultExperimentId(now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:TZ]/g, '')
    .replace('.', '-')
  return `experiment-${stamp}`
}

export function defaultExperimentMatrixValues(now = new Date()): ExperimentMatrixValues {
  return {
    experimentId: defaultExperimentId(now),
    scenarioFile: 'atomic.json',
    scenarioId: '',
    seeds: '1',
    runKind: 'debug',
    maxMessages: '40',
    costCapUsd: '5',
    stateScope: 'episode',
    latentRefundBlockRate: '0',
    toolFailBeforeRate: '0',
    toolResponseLostRate: '0',
    a: {
      bot: 'baseline',
      model: '',
      promptMode: 'preset',
      promptPreset: 'baseline',
      promptText: '',
      temperature: '0',
      transport: 'chat',
      reasoningEffort: '',
    },
    b: {
      bot: 'workflow',
      model: '',
      promptMode: 'preset',
      promptPreset: 'optimized',
      promptText: '',
      temperature: '0',
      transport: 'chat',
      reasoningEffort: '',
    },
  }
}

function finite(
  value: string,
  label: string,
  min: number,
  max: number,
  integer = false,
): number | string {
  const number = Number(value.trim())
  if (
    value.trim() === '' ||
    !Number.isFinite(number) ||
    number < min ||
    number > max ||
    (integer && !Number.isSafeInteger(number))
  ) {
    return `${label} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`
  }
  return number
}

function parseSeeds(value: string): number[] | string {
  const tokens = value
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length === 0) return 'Seeds must include at least one non-negative integer.'
  if (tokens.length > 1_000) return 'Seeds may contain at most 1000 values.'
  const seeds: number[] = []
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) return `Seed “${token}” must be a non-negative integer.`
    const seed = Number(token)
    if (!Number.isSafeInteger(seed)) return `Seed “${token}” is outside the supported range.`
    if (!seeds.includes(seed)) seeds.push(seed)
  }
  return seeds
}

function variantRequest(
  label: 'A' | 'B',
  values: ExperimentVariantValues,
):
  | Pick<
      AceRunRequest,
      'bot' | 'model' | 'prompt' | 'promptText' | 'temperature' | 'transport' | 'reasoningEffort'
    >
  | string {
  const temperature = finite(values.temperature, `Variant ${label} temperature`, 0, 2)
  if (typeof temperature === 'string') return temperature
  const model = values.model.trim()
  if (model && !SAFE_MODEL.test(model)) {
    return `Variant ${label} model is not a safe model identifier.`
  }
  if (!['baseline', 'playbook', 'workflow'].includes(values.bot)) {
    return `Variant ${label} must choose a bot harness.`
  }
  if (!['chat', 'responses'].includes(values.transport)) {
    return `Variant ${label} must choose a supported transport.`
  }
  if (!(ACE_PROMPT_PRESETS as readonly string[]).includes(values.promptPreset)) {
    return `Variant ${label} must choose a supported prompt preset.`
  }
  if (
    values.reasoningEffort &&
    !['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(values.reasoningEffort)
  ) {
    return `Variant ${label} reasoning effort is unsupported.`
  }
  const promptText = values.promptText.trim()
  if (
    values.promptMode === 'custom' &&
    (promptText === '' || values.promptText.length > MAX_INLINE_PROMPT)
  ) {
    return `Variant ${label} custom prompt must be non-empty and at most ${MAX_INLINE_PROMPT} characters.`
  }
  if (!['preset', 'custom'].includes(values.promptMode)) {
    return `Variant ${label} prompt mode is unsupported.`
  }

  return {
    bot: values.bot,
    ...(model ? { model } : {}),
    prompt: values.promptPreset,
    ...(values.promptMode === 'custom' ? { promptText: values.promptText } : {}),
    temperature,
    transport: values.transport,
    ...(values.reasoningEffort ? { reasoningEffort: values.reasoningEffort } : {}),
  }
}

function comparableVariant(request: AceRunRequest): string {
  return JSON.stringify({
    bot: request.bot,
    model: request.model,
    prompt: request.prompt,
    promptText: request.promptText,
    temperature: request.temperature,
    transport: request.transport,
    reasoningEffort: request.reasoningEffort,
  })
}

/** Build both immutable run requests without starting either one. */
export function buildExperimentMatrix(values: ExperimentMatrixValues): ExperimentMatrixResult {
  const experimentId = values.experimentId.trim()
  if (!SAFE_EXPERIMENT_ID.test(experimentId)) {
    return {
      ok: false,
      error:
        'Experiment ID must be 1–126 characters using only letters, numbers, dot, underscore, or hyphen.',
    }
  }
  if (!SAFE_SCENARIO_FILE.test(values.scenarioFile)) {
    return { ok: false, error: 'Scenario pack must be a safe JSON basename.' }
  }
  const scenarioId = values.scenarioId.trim()
  if (!SAFE_SCENARIO_ID.test(scenarioId)) {
    return {
      ok: false,
      error: 'Task ID is required and may only use letters, numbers, dot, underscore, or hyphen.',
    }
  }
  const seeds = parseSeeds(values.seeds)
  if (typeof seeds === 'string') return { ok: false, error: seeds }
  if (!['debug', 'counterfactual'].includes(values.runKind)) {
    return {
      ok: false,
      error: 'Experiment matrices must be debug or counterfactual runs, never scored runs.',
    }
  }

  const maxMessages = finite(values.maxMessages, 'Max messages', 2, 500, true)
  if (typeof maxMessages === 'string') return { ok: false, error: maxMessages }
  const costCapUsd = finite(values.costCapUsd, 'Per-run cost cap (USD)', 0.01, 100_000)
  if (typeof costCapUsd === 'string') return { ok: false, error: costCapUsd }
  const latentRefundBlockRate = finite(
    values.latentRefundBlockRate,
    'Latent refund block rate',
    0,
    1,
  )
  if (typeof latentRefundBlockRate === 'string') {
    return { ok: false, error: latentRefundBlockRate }
  }
  const toolFailBeforeRate = finite(values.toolFailBeforeRate, 'Write fail-before rate', 0, 1)
  if (typeof toolFailBeforeRate === 'string') return { ok: false, error: toolFailBeforeRate }
  const toolResponseLostRate = finite(values.toolResponseLostRate, 'Response-lost rate', 0, 1)
  if (typeof toolResponseLostRate === 'string') {
    return { ok: false, error: toolResponseLostRate }
  }
  if (!['episode', 'journey'].includes(values.stateScope)) {
    return { ok: false, error: 'State scope must be episode or journey.' }
  }

  const aVariant = variantRequest('A', values.a)
  if (typeof aVariant === 'string') return { ok: false, error: aVariant }
  const bVariant = variantRequest('B', values.b)
  if (typeof bVariant === 'string') return { ok: false, error: bVariant }

  const shared: Omit<
    AceRunRequest,
    | 'batchId'
    | 'bot'
    | 'model'
    | 'prompt'
    | 'promptText'
    | 'temperature'
    | 'transport'
    | 'reasoningEffort'
  > = {
    scenarioFile: values.scenarioFile,
    scenarioIds: [scenarioId],
    seeds,
    runKind: values.runKind,
    maxMessages,
    costCapUsd,
    stateScope: values.stateScope,
    latentRefundBlockRate,
    toolFailBeforeRate,
    toolResponseLostRate,
    checkpoints: true,
  }
  const a: AceRunRequest = { ...shared, ...aVariant, batchId: `${experimentId}-a` }
  const b: AceRunRequest = { ...shared, ...bVariant, batchId: `${experimentId}-b` }

  return {
    ok: true,
    plan: {
      experimentId,
      instanceId: scenarioId,
      requests: { a, b },
      runIds: { a: a.batchId as string, b: b.batchId as string },
      policyChanged: {
        a: values.a.promptMode === 'custom',
        b: values.b.promptMode === 'custom',
      },
      identicalVariants: comparableVariant(a) === comparableVariant(b),
    },
  }
}

export function experimentCompareHref(
  runIds: { a: string; b: string },
  instanceId: string,
): string {
  return `/compare?${new URLSearchParams({
    runA: runIds.a,
    runB: runIds.b,
    instance: instanceId,
  }).toString()}`
}
