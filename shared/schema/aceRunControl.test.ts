import { describe, expect, it } from 'vitest'
import type { AceRunLifecycle } from './ace'
import {
  ACE_RUN_CONTROL_ACTIONS,
  aceRunAllowedActions,
  aceRunControlDecision,
  aceRunLifecycleControlsAvailable,
} from './aceRunControl'

describe('ACE run control policy', () => {
  it.each([
    ['queued', ['cancel']],
    ['running', ['pause', 'cancel']],
    ['paused', ['resume', 'cancel']],
    ['cancelling', ['cancel']],
    ['completed', []],
    ['cancelled', []],
    ['failed', []],
    ['unknown', []],
  ] satisfies Array<[AceRunLifecycle, string[]]>)(
    'maps %s to valid actions',
    (lifecycle, actions) => {
      expect(aceRunAllowedActions(lifecycle)).toEqual(actions)
      expect(aceRunLifecycleControlsAvailable(lifecycle)).toBe(actions.length > 0)
      expect(
        ACE_RUN_CONTROL_ACTIONS.filter(
          (action) => aceRunControlDecision({ lifecycle, controlsAvailable: true }, action).allowed,
        ),
      ).toEqual(actions)
    },
  )

  it('fails closed for stale, read-only, orphan, and pending controls', () => {
    expect(
      aceRunControlDecision(
        { lifecycle: 'running', controlsAvailable: false, staleManifest: true },
        'pause',
      ),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining('manifest is stale') })
    expect(
      aceRunControlDecision(
        { lifecycle: 'running', controlsAvailable: false, manifestAvailable: false },
        'pause',
      ),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining('read-only') })
    expect(
      aceRunControlDecision(
        { lifecycle: 'queued', controlsAvailable: true, manifestAvailable: false },
        'cancel',
      ),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining('read-only') })
    expect(
      aceRunControlDecision({ lifecycle: 'unknown', controlsAvailable: false }, 'cancel'),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining('orphan run') })
    expect(
      aceRunControlDecision({ lifecycle: 'running', controlsAvailable: true }, 'pause', true),
    ).toMatchObject({ allowed: false, reason: expect.stringContaining('already in progress') })
  })
})
