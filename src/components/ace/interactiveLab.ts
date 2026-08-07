import type { AceTaskDetail } from '@shared/schema/aceTasks'
import type { Trace } from '@shared/schema/types'
import type { AceRunFormValues } from './AceRunLauncher'

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

function finiteText(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
}

/** Clone only typed, user-visible runner settings; never infer missing config. */
export function traceRunFormOverrides(trace: Trace): Partial<AceRunFormValues> {
  const extra = record(trace.meta.extra)
  const spec = record(extra.spec)
  const snapshot = record(extra.config_snapshot)
  const runner = record(snapshot.runner)
  const promptSource = record(spec.prompt_source)
  const prompt =
    promptSource.kind === 'preset' &&
    typeof promptSource.value === 'string' &&
    ['baseline', 'improved', 'optimized'].includes(promptSource.value)
      ? promptSource.value
      : undefined
  const transport =
    spec.agent_transport === 'responses'
      ? 'responses'
      : spec.agent_transport === 'chat_completions'
        ? 'chat'
        : undefined
  const bot =
    typeof spec.bot === 'string' && ['baseline', 'playbook', 'workflow'].includes(spec.bot)
      ? (spec.bot as NonNullable<AceRunFormValues['bot']>)
      : undefined
  const reasoningEffort =
    typeof spec.reasoning_effort === 'string' &&
    ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(spec.reasoning_effort)
      ? (spec.reasoning_effort as NonNullable<AceRunFormValues['reasoningEffort']>)
      : undefined
  const stateScope =
    runner.state_scope === 'episode' || runner.state_scope === 'journey'
      ? runner.state_scope
      : undefined
  const judge =
    runner.judge_mode === 'off' || runner.judge_mode === 'all' || runner.judge_mode === 'sample'
      ? runner.judge_mode
      : undefined
  const semantic =
    runner.semantic_verify_mode === 'off' ||
    runner.semantic_verify_mode === 'all' ||
    runner.semantic_verify_mode === 'sample'
      ? runner.semantic_verify_mode
      : undefined
  return {
    ...(prompt ? { prompt } : {}),
    ...(transport ? { transport } : {}),
    ...(typeof spec.bot_model === 'string' ? { model: spec.bot_model } : {}),
    ...(typeof spec.user_model === 'string' ? { userModel: spec.user_model } : {}),
    ...(finiteText(spec.bot_temperature) ? { temperature: finiteText(spec.bot_temperature) } : {}),
    ...(finiteText(spec.user_temperature)
      ? { userTemperature: finiteText(spec.user_temperature) }
      : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(bot ? { bot } : {}),
    ...(typeof runner.bot_opens === 'boolean'
      ? { botOpens: runner.bot_opens ? 'true' : 'false' }
      : {}),
    ...(stateScope ? { stateScope } : {}),
    ...(finiteText(runner.max_messages) ? { maxMessages: finiteText(runner.max_messages) } : {}),
    ...(finiteText(runner.concurrency) ? { concurrency: finiteText(runner.concurrency) } : {}),
    ...(finiteText(runner.latent_refund_block_rate)
      ? { latentRefundBlockRate: finiteText(runner.latent_refund_block_rate) }
      : {}),
    ...(finiteText(runner.tool_fail_before_rate)
      ? { failBefore: finiteText(runner.tool_fail_before_rate) }
      : {}),
    ...(finiteText(runner.tool_response_lost_rate)
      ? { responseLost: finiteText(runner.tool_response_lost_rate) }
      : {}),
    ...(judge ? { judge } : {}),
    ...(finiteText(runner.judge_sample) ? { judgeSample: finiteText(runner.judge_sample) } : {}),
    ...(semantic ? { semantic } : {}),
    ...(finiteText(runner.semantic_verify_sample)
      ? { semanticSample: finiteText(runner.semantic_verify_sample) }
      : {}),
  }
}
