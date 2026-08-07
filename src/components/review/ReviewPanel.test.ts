import { describe, expect, it } from 'vitest'
import { groundTruthPresentation } from './ReviewPanel'

describe('ReviewPanel ground-truth presentation', () => {
  it('distinguishes historical evidence from current-checkout references', () => {
    expect(
      groundTruthPresentation({
        status: 'available',
        authoritative: true,
        source: 'trace_bound_episode_sidecar_scenario_snapshot',
        traceBound: true,
        scenarioId: 'scenario-1',
      }),
    ).toMatchObject({ kind: 'trace_bound', title: 'Trace-bound task ground truth' })

    expect(
      groundTruthPresentation({
        status: 'reference',
        authoritative: false,
        source: 'current_task_catalog',
        traceBound: false,
        scenarioId: 'scenario-1',
        definitionDigest: 'current-definition',
      }),
    ).toMatchObject({
      kind: 'reference',
      title: 'Current task catalog reference (not trace-bound)',
      warning: expect.stringContaining('current checkout may differ'),
    })
  })

  it('explains that Calibration never substitutes the current checkout', () => {
    expect(
      groundTruthPresentation({
        status: 'unavailable',
        authoritative: false,
        reason: 'current_task_catalog_not_trace_bound',
        scenarioId: 'scenario-1',
      }),
    ).toMatchObject({
      kind: 'unavailable',
      title: 'Task ground truth unavailable',
      warning: expect.stringContaining('not substituted in Calibration'),
    })
  })
})
