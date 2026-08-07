import { createHash } from 'node:crypto'

const CONFIG_FIELDS = [
  'prompt',
  'model',
  'userModel',
  'transport',
  'temperature',
  'userTemperature',
  'reasoningEffort',
  'bot',
  'botOpens',
  'maxMessages',
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
] as const

type ConfigField = (typeof CONFIG_FIELDS)[number]
type ConfigValue = string | number | boolean
type CanonicalConfig = Partial<Record<ConfigField, ConfigValue>>

const POLICY_FIELDS = new Set<ConfigField>([
  'prompt',
  'model',
  'userModel',
  'transport',
  'temperature',
  'userTemperature',
  'reasoningEffort',
  'bot',
  'botOpens',
])

export interface AceRunConfigComparison {
  configExact: boolean
  /** Undefined means the source snapshot did not contain enough policy evidence. */
  policyChanged?: boolean
  changedFields: ConfigField[]
  missingFields: ConfigField[]
}

export interface AceRunConfigComparisonContext {
  /** Effective prompt bytes after resolving a trusted preset or inline prompt. */
  effectivePromptText?: string
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function promptFromSource(spec: Record<string, unknown>): string | undefined {
  const source = record(firstDefined(spec.prompt_source, spec.promptSource))
  const snapshot = record(firstDefined(spec.prompt_snapshot, spec.promptSnapshot))
  const text = stringValue(snapshot.bot)
  if (text) return `content:${digest(text)}`
  if (
    source.kind === 'preset' &&
    typeof source.value === 'string' &&
    ['baseline', 'improved', 'optimized'].includes(source.value)
  ) {
    return `preset:${source.value}`
  }
  const legacyPreset = stringValue(spec.prompt)
  if (legacyPreset && ['baseline', 'improved', 'optimized'].includes(legacyPreset)) {
    return `preset:${legacyPreset}`
  }
  return undefined
}

function promptFromChild(
  params: Record<string, unknown>,
  context: AceRunConfigComparisonContext,
): string | undefined {
  if (context.effectivePromptText) {
    return `content:${digest(context.effectivePromptText)}`
  }
  const text = stringValue(params.promptText)
  if (text) return `content:${digest(text)}`
  const preset = stringValue(params.promptPreset)
  return preset ? `preset:${preset}` : undefined
}

function normalizeTransport(value: unknown): string | undefined {
  if (value === 'responses') return 'responses'
  if (value === 'chat' || value === 'chat_completions') return 'chat_completions'
  return undefined
}

function sourceConfig(value: unknown): CanonicalConfig {
  const snapshot = record(value)
  const runner = record(snapshot.runner)
  const spec = record(snapshot.spec)
  return {
    prompt: promptFromSource(spec),
    model: stringValue(firstDefined(spec.bot_model, spec.model)),
    userModel: stringValue(firstDefined(spec.user_model, spec.userModel)),
    transport: normalizeTransport(firstDefined(spec.agent_transport, spec.transport)),
    temperature: numberValue(firstDefined(spec.bot_temperature, spec.temperature)),
    userTemperature: numberValue(firstDefined(spec.user_temperature, spec.userTemperature)),
    reasoningEffort: stringValue(firstDefined(spec.reasoning_effort, spec.reasoningEffort)),
    bot: stringValue(spec.bot),
    botOpens: booleanValue(firstDefined(runner.bot_opens, runner.botOpens)),
    maxMessages: numberValue(firstDefined(runner.max_messages, runner.maxMessages)),
    concurrency: numberValue(runner.concurrency),
    stateScope: stringValue(
      firstDefined(runner.state_scope, runner.stateScope, spec.state_scope, spec.stateScope),
    ),
    latentRefundBlockRate: numberValue(
      firstDefined(
        runner.latent_refund_block_rate,
        runner.latentRefundBlockRate,
        spec.latent_refund_block_rate,
      ),
    ),
    toolFailBeforeRate: numberValue(
      firstDefined(
        runner.tool_fail_before_rate,
        runner.toolFailBeforeRate,
        spec.tool_fail_before_rate,
      ),
    ),
    toolResponseLostRate: numberValue(
      firstDefined(
        runner.tool_response_lost_rate,
        runner.toolResponseLostRate,
        spec.tool_response_lost_rate,
      ),
    ),
    judge: stringValue(firstDefined(runner.judge_mode, runner.judgeMode)),
    judgeSample: numberValue(firstDefined(runner.judge_sample, runner.judgeSample)),
    semanticVerify: stringValue(
      firstDefined(runner.semantic_verify_mode, runner.semanticVerifyMode),
    ),
    semanticVerifySample: numberValue(
      firstDefined(runner.semantic_verify_sample, runner.semanticVerifySample),
    ),
    checkpoints: booleanValue(
      firstDefined(
        runner.checkpoint_enabled,
        runner.checkpointEnabled,
        spec.checkpoints,
        spec.checkpoint_enabled,
      ),
    ),
  }
}

/** Mirrors the fixed defaults in ACE's `_run`; callers pass already-validated bridge params. */
function effectiveChildConfig(
  params: Record<string, unknown>,
  context: AceRunConfigComparisonContext,
): CanonicalConfig {
  const model = stringValue(params.model) ?? 'gpt-5-mini'
  return {
    prompt: promptFromChild(params, context),
    model,
    userModel: stringValue(params.userModel) ?? model,
    transport: normalizeTransport(params.transport) ?? 'responses',
    temperature: numberValue(params.temperature) ?? 0.3,
    userTemperature: numberValue(params.userTemperature) ?? 0.9,
    reasoningEffort: stringValue(params.reasoningEffort) ?? 'low',
    bot: stringValue(params.bot) ?? 'baseline',
    botOpens: booleanValue(params.botOpens) ?? true,
    maxMessages: numberValue(params.maxMessages),
    concurrency: numberValue(params.concurrency) ?? 2,
    stateScope: stringValue(params.stateScope) ?? 'episode',
    latentRefundBlockRate: numberValue(params.latentRefundBlockRate) ?? 0,
    toolFailBeforeRate: numberValue(params.toolFailBeforeRate) ?? 0,
    toolResponseLostRate: numberValue(params.toolResponseLostRate) ?? 0,
    judge: stringValue(params.judge) ?? 'off',
    judgeSample: numberValue(params.judgeSample) ?? 1,
    semanticVerify: stringValue(params.semanticVerify) ?? 'off',
    semanticVerifySample: numberValue(params.semanticVerifySample) ?? 1,
    // The fixed Viewer bridge enables checkpoints even though the flag is not forwarded.
    checkpoints: true,
  }
}

/**
 * Compares the recorded effective source configuration with the child bridge invocation.
 * Structural rerun fields (run kind, batch id, seed set, cost cap) are intentionally excluded:
 * they do not by themselves prove that the model policy changed.
 */
export function compareAceRunConfig(
  configSnapshot: unknown,
  childBridgeParams: Record<string, unknown>,
  context: AceRunConfigComparisonContext = {},
): AceRunConfigComparison {
  const source = sourceConfig(configSnapshot)
  const child = effectiveChildConfig(childBridgeParams, context)
  const missingFields = CONFIG_FIELDS.filter((field) => source[field] === undefined)
  const changedFields = CONFIG_FIELDS.filter(
    (field) => source[field] !== undefined && !Object.is(source[field], child[field]),
  )
  const changedPolicy = changedFields.some((field) => POLICY_FIELDS.has(field))
  const missingPolicy = missingFields.some((field) => POLICY_FIELDS.has(field))
  return {
    configExact: missingFields.length === 0 && changedFields.length === 0,
    ...(changedPolicy ? { policyChanged: true } : missingPolicy ? {} : { policyChanged: false }),
    changedFields,
    missingFields,
  }
}
