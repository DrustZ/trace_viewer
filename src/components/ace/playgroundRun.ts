import type { Trace } from '@shared/schema/types'
import {
  type AceRunFormResult,
  type AceRunFormValues,
  buildAceRunRequest,
  DEFAULT_ACE_RUN_FORM,
} from './AceRunLauncher'
import { traceEnvironmentSeed, traceRunFormOverrides } from './interactiveLab'

/**
 * Playground single-episode launch: a thin projection of the full run form
 * onto the interactive controls. It reuses the exact request pipeline of
 * AceRunLauncher (validation, ranges, metric-hygiene rules) but pins the
 * schedule to one scenario × one seed.
 */
export interface PlaygroundRunConfig {
  scenarioFile: string
  /** Exactly one scenario id. */
  scenarioId: string
  /** Exactly one seed. */
  seed: string
  promptPreset: string
  /** Non-empty custom prompt downgrades the run to counterfactual. */
  promptText: string
  bot: AceRunFormValues['bot']
  model: string
  temperature: string
  reasoningEffort: AceRunFormValues['reasoningEffort']
  costCap: string
  /** Simulation parent for a matched fresh rerun (never a checkpoint restore). */
  sourceTraceUid?: string
}

export const DEFAULT_PLAYGROUND_CONFIG: PlaygroundRunConfig = {
  scenarioFile: 'atomic.json',
  scenarioId: '',
  seed: '1',
  promptPreset: 'optimized',
  promptText: '',
  bot: '',
  model: '',
  temperature: '0',
  reasoningEffort: '',
  costCap: '2',
}

/**
 * Initial Playground configuration: URL params first, then (for a simulation
 * source trace) the recorded config — prompt, harness, model, sampling —
 * plus its scenario and environment seed. A missing seed is never guessed.
 */
export function initialPlaygroundConfig(
  params: { scenarioFile?: string; scenarioId?: string; seed?: string },
  sourceTrace?: Trace,
): PlaygroundRunConfig {
  const base: PlaygroundRunConfig = {
    ...DEFAULT_PLAYGROUND_CONFIG,
    ...(params.scenarioFile?.trim() ? { scenarioFile: params.scenarioFile.trim() } : {}),
    ...(params.scenarioId?.trim() ? { scenarioId: params.scenarioId.trim() } : {}),
    ...(params.seed?.trim() ? { seed: params.seed.trim() } : {}),
  }
  if (sourceTrace?.meta.corpusId !== 'simulation') return base
  const overrides = traceRunFormOverrides(sourceTrace)
  const recordedSeed = traceEnvironmentSeed(sourceTrace)
  return {
    ...base,
    scenarioId: sourceTrace.meta.instanceId,
    ...(recordedSeed !== undefined ? { seed: String(recordedSeed) } : {}),
    ...(overrides.prompt ? { promptPreset: overrides.prompt } : {}),
    ...(overrides.promptText ? { promptText: overrides.promptText } : {}),
    ...(overrides.bot ? { bot: overrides.bot } : {}),
    ...(overrides.model ? { model: overrides.model } : {}),
    ...(overrides.temperature ? { temperature: overrides.temperature } : {}),
    ...(overrides.reasoningEffort ? { reasoningEffort: overrides.reasoningEffort } : {}),
  }
}

/** Builds the exact POST /api/ace/runs payload for one interactive episode. */
export function buildPlaygroundRunRequest(config: PlaygroundRunConfig): AceRunFormResult {
  if (config.scenarioId.trim() === '') {
    return { ok: false, error: 'Pick a scenario before running an episode.' }
  }
  const values: AceRunFormValues = {
    ...DEFAULT_ACE_RUN_FORM,
    scenarioFile: config.scenarioFile,
    scenarioIds: config.scenarioId,
    seeds: config.seed,
    // Playground episodes are experiments, never Scored; a custom prompt
    // downgrades further to counterfactual so formal metrics stay clean —
    // the same rule the batch launcher enforces.
    runKind: config.promptText.trim() ? 'counterfactual' : 'debug',
    prompt: config.promptPreset,
    promptText: config.promptText,
    bot: config.bot,
    model: config.model,
    temperature: config.temperature,
    reasoningEffort: config.reasoningEffort,
    costCap: config.costCap,
  }
  const result = buildAceRunRequest(
    values,
    config.sourceTraceUid ? { sourceTraceUid: config.sourceTraceUid } : {},
  )
  if (!result.ok) return result
  if ((result.request.scenarioIds?.length ?? 0) !== 1 || result.request.seeds.length !== 1) {
    return {
      ok: false,
      error: 'Playground runs exactly one scenario × one seed. Use Runs → New run for batches.',
    }
  }
  return result
}
