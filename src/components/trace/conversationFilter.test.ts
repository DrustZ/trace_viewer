import type { Message } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import { visibleUnitIndices } from './conversationFilter'
import type { UnifiedFailure } from './failureSource'
import { buildUnits } from './unitize'

function message(id: string, role: Message['role']): Message {
  return { id, role, content: `${role} ${id}` }
}

// u0 system, u1 user, u2 step (assistant), u3 tool, u4 user, u5 step (assistant)
const messages: Message[] = [
  message('m-0', 'system'),
  message('m-1', 'user'),
  { ...message('m-2', 'assistant'), stepIndex: 1 },
  message('m-3', 'tool'),
  message('m-4', 'user'),
  { ...message('m-5', 'assistant'), stepIndex: 2 },
]
const units = buildUnits(messages)

function failureOn(...ids: string[]): Map<string, UnifiedFailure[]> {
  return new Map(
    ids.map((id) => [
      id,
      [
        {
          origin: 'detector',
          code: 'x',
          severity: 'minor',
          gating: false,
          source: 't',
          messageId: id,
          anchorLabel: id,
          metadataOnly: false,
        },
      ],
    ]),
  )
}

describe('visibleUnitIndices', () => {
  it('shows everything by default', () => {
    expect(visibleUnitIndices(units, 'all', false, new Map())).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('filters by role: user, assistant (steps), and tool', () => {
    expect(visibleUnitIndices(units, 'user', false, new Map())).toEqual([1, 4])
    expect(visibleUnitIndices(units, 'assistant', false, new Map())).toEqual([2, 5])
    expect(visibleUnitIndices(units, 'tool', false, new Map())).toEqual([3])
  })

  it('failures-only keeps failure-anchored units plus one unit of context each side', () => {
    // Failure anchored to the tool message at unit 3 → units 2, 3, 4 stay.
    expect(visibleUnitIndices(units, 'all', true, failureOn('m-3'))).toEqual([2, 3, 4])
  })

  it('failures-only clamps context at the trace edges and merges overlapping windows', () => {
    expect(visibleUnitIndices(units, 'all', true, failureOn('m-0'))).toEqual([0, 1])
    expect(visibleUnitIndices(units, 'all', true, failureOn('m-5'))).toEqual([4, 5])
    // Two nearby anchors merge without duplicates.
    expect(visibleUnitIndices(units, 'all', true, failureOn('m-1', 'm-3'))).toEqual([0, 1, 2, 3, 4])
  })

  it('failures-only anchored to a step message keeps the whole step unit', () => {
    // m-2 lives inside step unit 2.
    expect(visibleUnitIndices(units, 'all', true, failureOn('m-2'))).toEqual([1, 2, 3])
  })

  it('role filter composes with failures-only', () => {
    expect(visibleUnitIndices(units, 'user', true, failureOn('m-3'))).toEqual([4])
  })

  it('failures-only with no failures shows nothing (toolbar disables the toggle)', () => {
    expect(visibleUnitIndices(units, 'all', true, new Map())).toEqual([])
  })
})
