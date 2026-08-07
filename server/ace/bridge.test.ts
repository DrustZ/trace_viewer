import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACE_BRIDGE_MODULE, aceBridgeSourcePath } from './bridge'

describe('ACE bridge package location', () => {
  it('tracks the current ACE experiments package after the domain migration', () => {
    expect(ACE_BRIDGE_MODULE).toBe('ace.experiments.cockpit_bridge')
    expect(aceBridgeSourcePath('/workspace/ac_express')).toBe(
      path.join('/workspace/ac_express', 'src', 'ace', 'experiments', 'cockpit_bridge.py'),
    )
  })
})
