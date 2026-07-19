import type { Message, Split, TraceStatus } from '../shared/schema/types'
import type { FailureKind } from './failures'
import type { Rng } from './rng'

export type EmitTarget = 'native' | 'harmony' | 'openai'

export interface TracePlan {
  component: string
  short: string
  /** 1-based instance number, selects the pool item. */
  instanceIdx: number
  instanceId: string
  traceId: string
  split: Split
  step: number
  /** Trace start: base timestamp + step hours + rollout jitter. */
  startMs: number
  /** Logistic learning-curve success probability at this step. */
  pSuccess: number
  success: boolean
  failure: FailureKind | null
  executing: boolean
  withLogprobs: boolean
  huge: boolean
  emit: EmitTarget
}

/** A substring of one message marking the injected-failure region for logprob shading. */
export interface FailureRegion {
  messageIndex: number
  text: string
}

export interface ScenarioOutput {
  messages: Message[]
  score: number | null
  status: TraceStatus
  rewardDetails?: Record<string, number>
  extra?: Record<string, unknown>
  truncated: boolean
  failureRegions?: FailureRegion[]
}

export type Scenario = (plan: TracePlan, rng: Rng) => ScenarioOutput
