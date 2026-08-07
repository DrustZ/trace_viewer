import type { AceTaskDetail } from '@shared/schema/aceTasks'
import type { Trace } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import { interactiveLabHref, taskScenarioFiles, traceEnvironmentSeed } from './interactiveLab'

function trace(extra: Record<string, unknown> = {}): Trace {
  return {
    meta: {
      traceId: 'producer-id',
      traceUid: 'simulation:run-a:canonical',
      corpusId: 'simulation',
      instanceId: 'task-1',
      component: 'ace/test',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
      extra,
    },
    messages: [],
    stats: {
      score: null,
      hasError: false,
      truncated: false,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      turns: 0,
      toolUses: 0,
      sandboxExecutions: 0,
      thinkingPortion: 0,
    },
  }
}

describe('interactive lab launch helpers', () => {
  it('uses canonical trace identity and never a duplicate producer id', () => {
    expect(interactiveLabHref(trace())).toBe('/ace/lab?trace=simulation%3Arun-a%3Acanonical')
  })

  it('uses only an explicitly recorded non-negative environment seed', () => {
    expect(traceEnvironmentSeed(trace({ environment_seed: 17 }))).toBe(17)
    expect(traceEnvironmentSeed(trace({ environmentSeed: 9 }))).toBe(9)
    expect(traceEnvironmentSeed(trace({ environment_seed: '17' }))).toBeUndefined()
    expect(traceEnvironmentSeed(trace())).toBeUndefined()
  })

  it('lists authoritative task packs as safe basenames and exposes conflicts', () => {
    const task = {
      variants: [
        { sources: [{ file: 'configs/scenarios/sealed.json' }] },
        {
          sources: [{ file: 'configs/scenarios/atomic.json' }, { file: '../unsafe pack.json' }],
        },
      ],
    } as AceTaskDetail
    expect(taskScenarioFiles(task)).toEqual(['atomic.json', 'sealed.json'])
  })
})
