import type { AceBatchSummary, AceRunLifecycle } from './ace'

export const ACE_RUN_CONTROL_ACTIONS = ['pause', 'resume', 'cancel'] as const

export type AceRunControlAction = (typeof ACE_RUN_CONTROL_ACTIONS)[number]

export type AceRunControlState = Pick<
  AceBatchSummary,
  'controlsAvailable' | 'lifecycle' | 'manifestAvailable' | 'staleManifest'
>

export interface AceRunControlDecision {
  allowed: boolean
  reason?: string
}

const ALLOWED_LIFECYCLES: Record<AceRunControlAction, readonly AceRunLifecycle[]> = {
  pause: ['running'],
  resume: ['paused'],
  // Repeating cancel while the harness is crossing a safe turn boundary is
  // intentionally idempotent and remains valid.
  cancel: ['queued', 'running', 'paused', 'cancelling'],
}

const TERMINAL_LIFECYCLES = new Set<AceRunLifecycle>(['completed', 'cancelled', 'failed'])

export function aceRunLifecycleControlsAvailable(lifecycle: AceRunLifecycle): boolean {
  return ACE_RUN_CONTROL_ACTIONS.some((action) => ALLOWED_LIFECYCLES[action].includes(lifecycle))
}

export function aceRunAllowedActions(lifecycle: AceRunLifecycle): AceRunControlAction[] {
  return ACE_RUN_CONTROL_ACTIONS.filter((action) => ALLOWED_LIFECYCLES[action].includes(lifecycle))
}

function unavailableReason(run: AceRunControlState): string | undefined {
  if (run.staleManifest) {
    return 'Controls are disabled while the batch manifest is stale.'
  }
  if (run.manifestAvailable === false) {
    return 'This run is read-only because no controllable ACE manifest or bridge is available.'
  }
  if (TERMINAL_LIFECYCLES.has(run.lifecycle)) {
    return `Run is ${run.lifecycle}; no further control actions are valid.`
  }
  if (run.lifecycle === 'unknown') {
    return 'Run lifecycle is unknown; controls are disabled to avoid mutating an orphan run.'
  }
  return 'Run controls are unavailable.'
}

function invalidLifecycleReason(lifecycle: AceRunLifecycle, action: AceRunControlAction): string {
  if (TERMINAL_LIFECYCLES.has(lifecycle)) {
    return `Run is ${lifecycle}; no further control actions are valid.`
  }
  if (lifecycle === 'unknown') {
    return 'Run lifecycle is unknown; controls are disabled to avoid mutating an orphan run.'
  }
  if (action === 'pause') {
    return `Pause is only available while a run is running (current: ${lifecycle}).`
  }
  if (action === 'resume') {
    return `Resume is only available while a run is paused (current: ${lifecycle}).`
  }
  return `Cancel is unavailable while a run is ${lifecycle}.`
}

/** Shared UI hint and server-side authorization for pause/resume/cancel. */
export function aceRunControlDecision(
  run: AceRunControlState,
  action: AceRunControlAction,
  pending = false,
): AceRunControlDecision {
  if (pending) {
    return { allowed: false, reason: 'A run control request is already in progress.' }
  }
  if (run.controlsAvailable === false) {
    return { allowed: false, reason: unavailableReason(run) }
  }
  if (!ALLOWED_LIFECYCLES[action].includes(run.lifecycle)) {
    return { allowed: false, reason: invalidLifecycleReason(run.lifecycle, action) }
  }
  return { allowed: true }
}
