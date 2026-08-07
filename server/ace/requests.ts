import { randomBytes } from 'node:crypto'
import type { AceRunRequest } from '../../shared/schema/ace'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_FILE =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json|regression:[A-Za-z0-9][A-Za-z0-9._-]{0,127})$/
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const MAX_INLINE_PROMPT = 1_000_000
const MAX_FILTER_VALUE = 256
const DEFAULT_MAX_RUN_COST_USD = 100

export function aceMaxRunCostUsd(): number {
  const configured = Number(process.env.ACE_MAX_RUN_COST_USD ?? DEFAULT_MAX_RUN_COST_USD)
  return Number.isFinite(configured) && configured >= 0.01
    ? Math.min(configured, 100_000)
    : DEFAULT_MAX_RUN_COST_USD
}

export class AceRequestError extends Error {
  readonly status = 400
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AceRequestError('request body must be a JSON object')
  }
  return value as Record<string, unknown>
}

function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new AceRequestError(`${name} must be between ${min} and ${max}`)
  }
  return value
}

function integer(value: unknown, name: string, min: number, max: number): number {
  const result = finite(value, name, min, max)
  if (!Number.isSafeInteger(result)) throw new AceRequestError(`${name} must be an integer`)
  return result
}

function oneOf<T extends string>(value: unknown, name: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new AceRequestError(`${name} must be one of ${values.join(', ')}`)
  }
  return value as T
}

function generatedRunId(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
  return `cockpit-${stamp}-${randomBytes(3).toString('hex')}`
}

function optionalModel(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !SAFE_MODEL.test(value)) {
    throw new AceRequestError(`${name} is not a safe model identifier`)
  }
  return value
}

function optionalPromptText(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_INLINE_PROMPT) {
    throw new AceRequestError(
      `promptText must be a non-empty string of at most ${MAX_INLINE_PROMPT} characters`,
    )
  }
  return value
}

function optionalFilters(value: unknown): AceRunRequest['filters'] | undefined {
  if (value === undefined) return undefined
  const filters = record(value)
  const allowed = ['issue', 'language', 'idKnowledge', 'persistence'] as const
  const unknown = Object.keys(filters).filter(
    (key) => !allowed.includes(key as (typeof allowed)[number]),
  )
  if (unknown.length > 0) {
    throw new AceRequestError(`unknown scenario filter(s): ${unknown.join(', ')}`)
  }
  const normalized: NonNullable<AceRunRequest['filters']> = {}
  for (const key of allowed) {
    const candidate = filters[key]
    if (candidate === undefined) continue
    if (
      typeof candidate !== 'string' ||
      candidate.trim() === '' ||
      candidate.length > MAX_FILTER_VALUE ||
      [...candidate].some((character) => character.charCodeAt(0) < 32)
    ) {
      throw new AceRequestError(`${key} must be a non-empty bounded string`)
    }
    normalized[key] = candidate
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

export function parseAceRunRequest(value: unknown): {
  request: AceRunRequest
  runId: string
  bridgeParams: Record<string, unknown>
} {
  const body = record(value)
  const allowed = new Set([
    'scenarioFile',
    'scenarioIds',
    'filters',
    'limit',
    'seeds',
    'batchId',
    'runKind',
    'prompt',
    'promptText',
    'transport',
    'model',
    'userModel',
    'temperature',
    'userTemperature',
    'reasoningEffort',
    'bot',
    'botOpens',
    'maxMessages',
    'costCapUsd',
    'concurrency',
    'stateScope',
    'latentRefundBlockRate',
    'toolFailBeforeRate',
    'toolResponseLostRate',
    'judge',
    'judgeSample',
    'semanticVerify',
    'semanticVerifySample',
    'checkpoints',
    'sourceTraceUid',
  ])
  const unknown = Object.keys(body).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw new AceRequestError(`unknown field(s): ${unknown.join(', ')}`)

  const scenarioFile = body.scenarioFile
  if (typeof scenarioFile !== 'string' || !SAFE_FILE.test(scenarioFile)) {
    throw new AceRequestError(
      'scenarioFile must be a scenario-pack JSON basename or fixed regression:<id> token',
    )
  }
  if (
    !Array.isArray(body.seeds) ||
    body.seeds.length === 0 ||
    body.seeds.length > 1_000 ||
    body.seeds.some((seed) => !Number.isSafeInteger(seed) || Number(seed) < 0)
  ) {
    throw new AceRequestError('seeds must be 1-1000 non-negative integers')
  }
  const seeds = [...new Set(body.seeds as number[])]
  if (seeds.length !== body.seeds.length) throw new AceRequestError('seeds must be unique')
  const scenarioIds = body.scenarioIds
  if (
    scenarioIds !== undefined &&
    (!Array.isArray(scenarioIds) ||
      scenarioIds.length === 0 ||
      scenarioIds.some((id) => typeof id !== 'string' || !SAFE_ID.test(id)))
  ) {
    throw new AceRequestError('scenarioIds must be a non-empty list of safe identifiers')
  }
  const runId = body.batchId === undefined ? generatedRunId() : String(body.batchId)
  if (!SAFE_ID.test(runId)) throw new AceRequestError('batchId is not a safe run identifier')
  const runKind = oneOf(body.runKind, 'runKind', ['scored', 'debug', 'counterfactual'] as const)
  if (scenarioFile.startsWith('regression:') && runKind === 'scored') {
    throw new AceRequestError(
      'synthetic regression reruns must be debug or counterfactual; formal metrics are excluded',
    )
  }
  const prompt = oneOf(body.prompt, 'prompt', ['baseline', 'improved', 'optimized'] as const)
  const promptText = optionalPromptText(body.promptText)
  if (runKind === 'scored' && promptText !== undefined) {
    throw new AceRequestError('custom promptText requires a debug or counterfactual run')
  }
  const transport = oneOf(body.transport, 'transport', ['chat', 'responses'] as const)
  const maxMessages = integer(body.maxMessages, 'maxMessages', 2, 500)
  const costCapUsd = finite(body.costCapUsd, 'costCapUsd', 0.01, aceMaxRunCostUsd())
  const temperature =
    body.temperature === undefined ? undefined : finite(body.temperature, 'temperature', 0, 2)
  const userTemperature =
    body.userTemperature === undefined
      ? undefined
      : finite(body.userTemperature, 'userTemperature', 0, 2)
  const concurrency =
    body.concurrency === undefined ? undefined : integer(body.concurrency, 'concurrency', 1, 128)
  const stateScope =
    body.stateScope === undefined
      ? undefined
      : oneOf(body.stateScope, 'stateScope', ['episode', 'journey'] as const)
  const reasoningEffort =
    body.reasoningEffort === undefined
      ? undefined
      : oneOf(body.reasoningEffort, 'reasoningEffort', [
          'none',
          'minimal',
          'low',
          'medium',
          'high',
          'xhigh',
        ] as const)
  const bot =
    body.bot === undefined
      ? undefined
      : oneOf(body.bot, 'bot', ['baseline', 'playbook', 'workflow'] as const)
  if (body.botOpens !== undefined && typeof body.botOpens !== 'boolean') {
    throw new AceRequestError('botOpens must be a boolean')
  }
  const latentRefundBlockRate =
    body.latentRefundBlockRate === undefined
      ? undefined
      : finite(body.latentRefundBlockRate, 'latentRefundBlockRate', 0, 1)
  const toolFailBeforeRate =
    body.toolFailBeforeRate === undefined
      ? undefined
      : finite(body.toolFailBeforeRate, 'toolFailBeforeRate', 0, 1)
  const toolResponseLostRate =
    body.toolResponseLostRate === undefined
      ? undefined
      : finite(body.toolResponseLostRate, 'toolResponseLostRate', 0, 1)
  const judge =
    body.judge === undefined
      ? undefined
      : oneOf(body.judge, 'judge', ['off', 'all', 'sample'] as const)
  const semanticVerify =
    body.semanticVerify === undefined
      ? undefined
      : oneOf(body.semanticVerify, 'semanticVerify', ['off', 'all', 'sample'] as const)
  const judgeSample =
    body.judgeSample === undefined ? undefined : integer(body.judgeSample, 'judgeSample', 0, 1_000)
  const semanticVerifySample =
    body.semanticVerifySample === undefined
      ? undefined
      : integer(body.semanticVerifySample, 'semanticVerifySample', 0, 1_000)
  const model = optionalModel(body.model, 'model')
  const userModel = optionalModel(body.userModel, 'userModel')
  const filters = optionalFilters(body.filters)
  const limit = body.limit === undefined ? undefined : integer(body.limit, 'limit', 1, 10_000)
  if (body.checkpoints !== undefined && body.checkpoints !== true) {
    throw new AceRequestError('viewer-launched ACE runs always enable checkpoints')
  }

  if (
    body.sourceTraceUid !== undefined &&
    (typeof body.sourceTraceUid !== 'string' ||
      body.sourceTraceUid.length === 0 ||
      body.sourceTraceUid.length > 512 ||
      [...body.sourceTraceUid].some((character) => character.charCodeAt(0) < 32))
  ) {
    throw new AceRequestError('sourceTraceUid must be a non-empty opaque identifier')
  }
  if (body.sourceTraceUid !== undefined) {
    if (scenarioFile.startsWith('regression:')) {
      throw new AceRequestError(
        'synthetic regression lineage is derived from its immutable artifact, not caller input',
      )
    }
    if (runKind === 'scored') {
      throw new AceRequestError('trace-derived fresh reruns must be debug or counterfactual')
    }
    if (scenarioIds?.length !== 1 || seeds.length !== 1) {
      throw new AceRequestError(
        'trace-derived fresh reruns require exactly one scenarioId and one seed',
      )
    }
  }

  const request = body as unknown as AceRunRequest
  return {
    request,
    runId,
    bridgeParams: {
      runId,
      scenariosFile: scenarioFile,
      ...(scenarioIds ? { scenarioIds } : {}),
      ...(filters ? { filters } : {}),
      ...(limit !== undefined ? { limit } : {}),
      seeds,
      runKind,
      ...(promptText !== undefined ? { promptText } : { promptPreset: prompt }),
      transport: transport === 'chat' ? 'chat_completions' : 'responses',
      ...(model ? { model } : {}),
      ...(userModel ? { userModel } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(userTemperature !== undefined ? { userTemperature } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(bot !== undefined ? { bot } : {}),
      ...(body.botOpens !== undefined ? { botOpens: body.botOpens } : {}),
      maxMessages,
      costCapUsd,
      ...(concurrency !== undefined ? { concurrency } : {}),
      ...(stateScope !== undefined ? { stateScope } : {}),
      ...(latentRefundBlockRate !== undefined ? { latentRefundBlockRate } : {}),
      ...(toolFailBeforeRate !== undefined ? { toolFailBeforeRate } : {}),
      ...(toolResponseLostRate !== undefined ? { toolResponseLostRate } : {}),
      ...(judge !== undefined ? { judge } : {}),
      ...(judgeSample !== undefined ? { judgeSample } : {}),
      ...(semanticVerify !== undefined ? { semanticVerify } : {}),
      ...(semanticVerifySample !== undefined ? { semanticVerifySample } : {}),
    },
  }
}

export function parseControlRequest(value: unknown): 'pause' | 'resume' | 'cancel' {
  const body = record(value)
  if (Object.keys(body).some((key) => key !== 'action')) {
    throw new AceRequestError('control accepts only action')
  }
  return oneOf(body.action, 'action', ['pause', 'resume', 'cancel'] as const)
}
