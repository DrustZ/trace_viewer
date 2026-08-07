import type { UnifiedFailure } from './failureSource'
import type { RenderUnit } from './unitize'

/** Toolbar role filter. 'assistant' covers step units; 'tool' covers tool results. */
export type RoleFilter = 'all' | 'user' | 'assistant' | 'tool'

export const ROLE_FILTERS: readonly RoleFilter[] = ['all', 'user', 'assistant', 'tool']

function unitMatchesRole(unit: RenderUnit, role: RoleFilter): boolean {
  if (role === 'all') return true
  if (unit.kind === 'step') return role === 'assistant'
  return unit.message.role === role
}

function unitHasFailure(
  unit: RenderUnit,
  failureIndex: ReadonlyMap<string, readonly UnifiedFailure[]>,
): boolean {
  const messages = unit.kind === 'step' ? unit.messages : [unit.message]
  return messages.some((message) => (failureIndex.get(message.id)?.length ?? 0) > 0)
}

/**
 * Indices of units the conversation list should render under the toolbar
 * filters. Failures-only keeps every unit carrying a failure-anchored message
 * plus one unit of context on each side (so the exchange around the failure
 * stays readable); the role filter then narrows within that set.
 */
export function visibleUnitIndices(
  units: readonly RenderUnit[],
  role: RoleFilter,
  failuresOnly: boolean,
  failureIndex: ReadonlyMap<string, readonly UnifiedFailure[]>,
): number[] {
  let candidates: number[]
  if (failuresOnly) {
    const keep = new Set<number>()
    units.forEach((unit, index) => {
      if (!unitHasFailure(unit, failureIndex)) return
      if (index > 0) keep.add(index - 1)
      keep.add(index)
      if (index < units.length - 1) keep.add(index + 1)
    })
    candidates = [...keep].sort((a, b) => a - b)
  } else {
    candidates = units.map((_, index) => index)
  }
  if (role === 'all') return candidates
  return candidates.filter((index) => unitMatchesRole(units[index], role))
}
