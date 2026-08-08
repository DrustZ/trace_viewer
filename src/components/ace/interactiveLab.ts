import { ACE_PROMPT_PRESETS } from '@shared/schema/ace'
import type { AceTaskDetail } from '@shared/schema/aceTasks'
import type { Trace } from '@shared/schema/types'

const PROMPT_PRESETS: readonly string[] = ACE_PROMPT_PRESETS
import {
  ACE_RUN_FIDELITY_FIELDS,
  type AceRunFidelityField,
  type AceRunFormValues,
  type AceRunRecordedConfig,
  type AceRunRecordedSetting,
} from './AceRunLauncher'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Environment seed recorded by ACE sidecar normalization; undefined is never guessed. */
export function traceEnvironmentSeed(trace: Trace): number | undefined {
  const extra = record(trace.meta.extra)
  const candidates = [extra.environment_seed, extra.environmentSeed]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0) {
      return candidate
    }
  }
  return undefined
}

/** Every authoritative scenario pack containing this task, reduced to safe basenames. */
export function taskScenarioFiles(task: AceTaskDetail | undefined): string[] {
  if (!task) return []
  const files = task.variants.flatMap((variant) => variant.sources.map((source) => source.file))
  return [...new Set(files)]
    .map((file) => file.split('/').at(-1) ?? '')
    .filter((file) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(file))
    .sort()
}

export function interactiveLabHref(trace: Pick<Trace, 'meta'>): string {
  const traceUid = trace.meta.traceUid ?? trace.meta.traceId
  return `/ace/lab?${new URLSearchParams({ trace: traceUid }).toString()}`
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

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined)
}

function setting(value: string | number | boolean, display = String(value)): AceRunRecordedSetting {
  return { value, display }
}

function sourceProjection(trace: Trace): {
  initialValues: Partial<AceRunFormValues>
  recordedConfig: AceRunRecordedConfig
} {
  const extra = record(trace.meta.extra)
  const snapshot = record(extra.config_snapshot)
  const runner = record(snapshot.runner)
  // A versioned config snapshot is authoritative. `extra.spec` is retained only as a
  // field-level fallback for older Viewer-produced sidecars.
  const spec = { ...record(extra.spec), ...record(snapshot.spec) }
  const promptSource = record(spec.prompt_source)
  const promptSnapshot = record(spec.prompt_snapshot)
  const fields: AceRunRecordedConfig['fields'] = {}
  const initialValues: Partial<AceRunFormValues> = {}

  const preset =
    promptSource.kind === 'preset' &&
    typeof promptSource.value === 'string' &&
    PROMPT_PRESETS.includes(promptSource.value)
      ? promptSource.value
      : typeof spec.prompt === 'string' && PROMPT_PRESETS.includes(spec.prompt)
        ? spec.prompt
        : undefined
  const promptText = stringValue(promptSnapshot.bot)
  if (preset) {
    initialValues.prompt = preset
    fields.prompt = setting(`preset:${preset}`, `preset ${preset}`)
  } else if (promptText) {
    initialValues.promptText = promptText
    fields.prompt = setting(
      `inline:${promptText}`,
      `${String(promptSource.kind ?? 'recorded')} prompt (${promptText.length} chars)`,
    )
  }

  const transportRaw = firstDefined(spec.agent_transport, spec.transport)
  const transport =
    transportRaw === 'responses'
      ? 'responses'
      : transportRaw === 'chat_completions' || transportRaw === 'chat'
        ? 'chat'
        : undefined
  if (transport) {
    initialValues.transport = transport
    fields.transport = setting(transport)
  }

  const model = stringValue(firstDefined(spec.bot_model, spec.model))
  if (model) {
    initialValues.model = model
    fields.model = setting(model)
  }
  const userModel = stringValue(firstDefined(spec.user_model, spec.userModel))
  if (userModel) {
    initialValues.userModel = userModel
    fields.userModel = setting(userModel)
  }
  const temperature = numberValue(firstDefined(spec.bot_temperature, spec.temperature))
  if (temperature !== undefined) {
    initialValues.temperature = String(temperature)
    fields.temperature = setting(temperature)
  }
  const userTemperature = numberValue(firstDefined(spec.user_temperature, spec.userTemperature))
  if (userTemperature !== undefined) {
    initialValues.userTemperature = String(userTemperature)
    fields.userTemperature = setting(userTemperature)
  }

  const reasoning = stringValue(firstDefined(spec.reasoning_effort, spec.reasoningEffort))
  if (reasoning && ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(reasoning)) {
    initialValues.reasoningEffort = reasoning as NonNullable<AceRunFormValues['reasoningEffort']>
    fields.reasoningEffort = setting(reasoning)
  }
  const bot = stringValue(spec.bot)
  if (bot && ['baseline', 'playbook', 'workflow'].includes(bot)) {
    initialValues.bot = bot as NonNullable<AceRunFormValues['bot']>
    fields.bot = setting(bot)
  }

  const botOpens = booleanValue(firstDefined(runner.bot_opens, runner.botOpens))
  if (botOpens !== undefined) {
    initialValues.botOpens = botOpens ? 'true' : 'false'
    fields.botOpens = setting(botOpens, botOpens ? 'bot opens' : 'user opens')
  }
  const stateScope = stringValue(
    firstDefined(runner.state_scope, runner.stateScope, spec.state_scope, spec.stateScope),
  )
  if (stateScope === 'episode' || stateScope === 'journey') {
    initialValues.stateScope = stateScope
    fields.stateScope = setting(stateScope)
  }

  const numericMappings: Array<{
    field: AceRunFidelityField
    form: keyof AceRunFormValues
    value: unknown
  }> = [
    {
      field: 'maxMessages',
      form: 'maxMessages',
      value: firstDefined(runner.max_messages, runner.maxMessages),
    },
    {
      field: 'concurrency',
      form: 'concurrency',
      value: runner.concurrency,
    },
    {
      field: 'latentRefundBlockRate',
      form: 'latentRefundBlockRate',
      value: firstDefined(
        runner.latent_refund_block_rate,
        runner.latentRefundBlockRate,
        spec.latent_refund_block_rate,
      ),
    },
    {
      field: 'toolFailBeforeRate',
      form: 'failBefore',
      value: firstDefined(
        runner.tool_fail_before_rate,
        runner.toolFailBeforeRate,
        spec.tool_fail_before_rate,
      ),
    },
    {
      field: 'toolResponseLostRate',
      form: 'responseLost',
      value: firstDefined(
        runner.tool_response_lost_rate,
        runner.toolResponseLostRate,
        spec.tool_response_lost_rate,
      ),
    },
    {
      field: 'judgeSample',
      form: 'judgeSample',
      value: firstDefined(runner.judge_sample, runner.judgeSample),
    },
    {
      field: 'semanticVerifySample',
      form: 'semanticSample',
      value: firstDefined(runner.semantic_verify_sample, runner.semanticVerifySample),
    },
  ]
  for (const mapping of numericMappings) {
    const value = numberValue(mapping.value)
    if (value === undefined) continue
    ;(initialValues as Record<string, unknown>)[mapping.form] = String(value)
    fields[mapping.field] = setting(value)
  }

  const judge = stringValue(firstDefined(runner.judge_mode, runner.judgeMode))
  if (judge && ['off', 'all', 'sample'].includes(judge)) {
    initialValues.judge = judge as AceRunFormValues['judge']
    fields.judge = setting(judge)
  }
  const semantic = stringValue(firstDefined(runner.semantic_verify_mode, runner.semanticVerifyMode))
  if (semantic && ['off', 'all', 'sample'].includes(semantic)) {
    initialValues.semantic = semantic as AceRunFormValues['semantic']
    fields.semanticVerify = setting(semantic)
  }
  const checkpoints = booleanValue(
    firstDefined(
      runner.checkpoint_enabled,
      runner.checkpointEnabled,
      spec.checkpoints,
      spec.checkpoint_enabled,
    ),
  )
  if (checkpoints !== undefined) {
    fields.checkpoints = setting(checkpoints, checkpoints ? 'enabled' : 'disabled')
  }

  return {
    initialValues,
    recordedConfig: {
      fields,
      missing: ACE_RUN_FIDELITY_FIELDS.filter((field) => fields[field] === undefined),
    },
  }
}

/** Clone only typed, user-visible runner settings; never infer missing config. */
export function traceRunFormOverrides(trace: Trace): Partial<AceRunFormValues> {
  return sourceProjection(trace).initialValues
}

/** Recorded/missing values used by the launcher to explain best-effort rerun fidelity. */
export function traceRunRecordedConfig(trace: Trace): AceRunRecordedConfig {
  return sourceProjection(trace).recordedConfig
}
