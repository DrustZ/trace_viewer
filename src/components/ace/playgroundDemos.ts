import type { Trace } from '@shared/schema/types'
import {
  type AceRunFormResult,
  type AceRunFormValues,
  buildAceRunRequest,
  DEFAULT_ACE_RUN_FORM,
} from './AceRunLauncher'
import { DEFAULT_PLAYGROUND_CONFIG, type PlaygroundRunConfig } from './playgroundRun'

/**
 * Curated one-click demos: each card is a preset config that shows one class
 * of metric coming alive in the conversation stream. The `watchFor` items map
 * to grade check names (or `termination=<value>`) and light up ✓/✗ once the
 * episode is judged.
 *
 * Prompt note: the bridge exposes exactly three presets (baseline / improved /
 * optimized); `optimized` loads the current canonical optimized prompt, which
 * supersedes the archived v4 iteration.
 */
export interface DemoWatchItem {
  label: string
  /** A grade check name, or `termination=<value>` for lifecycle assertions. */
  check: string
}

export interface PlaygroundDemo {
  id: string
  title: string
  blurb: string
  scenarioFile: string
  /** One id = a normal episode; several = an ordered journey (shared state clone). */
  scenarioIds: string[]
  seed: string
  bot: PlaygroundRunConfig['bot']
  promptPreset: string
  stateScope: NonNullable<AceRunFormValues['stateScope']>
  watchFor: DemoWatchItem[]
}

export const PLAYGROUND_DEMOS: PlaygroundDemo[] = [
  {
    id: 'compliant-refund',
    title: 'Compliant refund, end to end',
    blurb:
      'Workflow bot: authored confirmation turn mints a ConsentGrant, amounts agree three ways, and the world diff stays inside the license.',
    scenarioFile: 'graded.json',
    scenarioIds: ['g-refund-00'],
    seed: '1',
    bot: 'workflow',
    promptPreset: 'optimized',
    stateScope: 'episode',
    watchFor: [
      { label: 'Consent minted before the write', check: 'CONSENT' },
      { label: 'Money atoms agree (REQUIRED_INFO)', check: 'REQUIRED_INFO' },
      { label: 'World diff inside the license', check: 'WORLD_DIFF' },
      { label: 'Exact final state (OUTCOME)', check: 'OUTCOME' },
    ],
  },
  {
    id: 'fraud-handoff',
    title: 'Fraud block → informed handoff',
    blurb:
      'issue_refund honestly reports "needs expert review"; the workflow looks up first, escalates second, and escalation ends the episode.',
    scenarioFile: 'atomic.json',
    scenarioIds: ['atomic-fraud-blocked'],
    seed: '1',
    bot: 'workflow',
    promptPreset: 'optimized',
    stateScope: 'episode',
    watchFor: [
      { label: 'Lookup precedes escalate (MUST_PRECEDE)', check: 'MUST_PRECEDE' },
      { label: 'Required actions all hit', check: 'ACTIONS' },
      { label: 'Escalation is terminal (handoff)', check: 'termination=handoff' },
    ],
  },
  {
    id: 'refusal-under-pressure',
    title: 'Refusal that holds under pressure',
    blurb:
      'The user pushes again and again; the bot keeps the policy refusal: zero successful cancels, an empty-license world diff, no needless escalation.',
    scenarioFile: 'graded.json',
    scenarioIds: ['nc-canceldelivered-00'],
    seed: '1',
    bot: '',
    promptPreset: 'optimized',
    stateScope: 'episode',
    watchFor: [
      { label: 'Forbidden effects stayed at zero', check: 'FORBIDDEN' },
      { label: 'World untouched (empty license)', check: 'WORLD_DIFF' },
      { label: 'Exact final state (OUTCOME)', check: 'OUTCOME' },
    ],
  },
  {
    id: 'write-fault-exactly-once',
    title: 'Exactly-once under a write fault',
    blurb:
      'The refund response is lost by the scenario itself; WRITE_SAFETY forbids blind retries, so the bot verifies with read tools before confirming.',
    scenarioFile: 'extension.json',
    scenarioIds: ['ext-fault-refund-response-lost'],
    seed: '1',
    bot: '',
    promptPreset: 'optimized',
    stateScope: 'episode',
    watchFor: [
      { label: 'No blind retry (WRITE_SAFETY)', check: 'WRITE_SAFETY' },
      { label: 'World diff inside the license', check: 'WORLD_DIFF' },
      { label: 'Exact final state (OUTCOME)', check: 'OUTCOME' },
    ],
  },
  {
    id: 'journey-state',
    title: 'Journey: state across conversations',
    blurb:
      'Two conversations, one world: the first cancels the order, the second opens on a world where that cancellation is already real.',
    scenarioFile: 'ext50.json',
    scenarioIds: ['e50-journey-modify-cancel', 'e50-journey-modify-verify'],
    seed: '1',
    bot: '',
    promptPreset: 'optimized',
    stateScope: 'journey',
    watchFor: [
      { label: 'Step-2 world sees the cancel (WORLD_DIFF)', check: 'WORLD_DIFF' },
      { label: 'Exact final state (OUTCOME)', check: 'OUTCOME' },
    ],
  },
  {
    id: 'baseline-bare',
    title: 'Counter-example: bare baseline',
    blurb:
      'Baseline prompt + baseline harness on a hard escalation task — expect red badges live: a needless escalation or a missed lookup is the usual failure mode.',
    scenarioFile: 'hard.json',
    scenarioIds: ['hard-escal-human-00'],
    seed: '1',
    bot: 'baseline',
    promptPreset: 'baseline',
    stateScope: 'episode',
    watchFor: [
      { label: 'Required actions all hit', check: 'ACTIONS' },
      { label: 'Exact final state (OUTCOME)', check: 'OUTCOME' },
      { label: 'World diff inside the license', check: 'WORLD_DIFF' },
    ],
  },
]

/** Panel prefill for a single-episode demo — everything stays editable. */
export function demoPlaygroundConfig(demo: PlaygroundDemo): PlaygroundRunConfig {
  return {
    ...DEFAULT_PLAYGROUND_CONFIG,
    scenarioFile: demo.scenarioFile,
    scenarioId: demo.scenarioIds[0] ?? '',
    seed: demo.seed,
    bot: demo.bot,
    promptPreset: demo.promptPreset,
    stateScope: demo.stateScope,
  }
}

/**
 * Direct request for a journey demo (several scenarios, ordered, one shared
 * state clone). Journeys are the one sanctioned exception to the Playground's
 * one-scenario rule: the runner executes the steps sequentially and the live
 * traces list shows each conversation.
 */
export function demoRunRequest(demo: PlaygroundDemo): AceRunFormResult {
  const values: AceRunFormValues = {
    ...DEFAULT_ACE_RUN_FORM,
    scenarioFile: demo.scenarioFile,
    scenarioIds: demo.scenarioIds.join(', '),
    seeds: demo.seed,
    runKind: 'debug',
    prompt: demo.promptPreset,
    transport: 'responses',
    bot: demo.bot,
    stateScope: demo.stateScope,
    concurrency: '1',
    costCap: DEFAULT_PLAYGROUND_CONFIG.costCap,
  }
  return buildAceRunRequest(values, {})
}

export type DemoWatchState = 'pending' | 'pass' | 'fail' | 'absent'

/**
 * Lights the demo's watch-list against the judged episode. `pending` while the
 * grade has not landed; `absent` when this grader never emitted the check (so
 * a demo card cannot silently look "not yet" forever).
 */
export function watchForStatus(
  items: readonly DemoWatchItem[],
  trace: Trace | undefined,
): Array<DemoWatchItem & { state: DemoWatchState }> {
  const evaluation = trace?.evaluation
  return items.map((item) => {
    if (!evaluation) return { ...item, state: 'pending' as const }
    const termination = /^termination=(.+)$/.exec(item.check)
    if (termination) {
      const actual = evaluation.lifecycle.termination
      if (actual === undefined) {
        return { ...item, state: evaluation.checks.length === 0 ? 'pending' : 'absent' }
      }
      return { ...item, state: actual === termination[1] ? 'pass' : 'fail' }
    }
    const check = evaluation.checks.find((candidate) => candidate.name === item.check)
    if (!check) return { ...item, state: evaluation.checks.length === 0 ? 'pending' : 'absent' }
    return { ...item, state: check.ok ? 'pass' : 'fail' }
  })
}
