import type { FailureDecision, ReviewPayload } from '@shared/reviews/types'

export type ReviewShortcut =
  | 'save'
  | 'submit'
  | 'next'
  | 'prev'
  | 'overall-pass'
  | 'overall-fail'
  | 'overall-unsure'
  | 'failure-confirm'
  | 'failure-reject'

export interface ReviewShortcutEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey?: boolean
  repeat?: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
  target?: EventTarget | null
}

export const REVIEW_SHORTCUT_LABELS: ReadonlyArray<{
  action: ReviewShortcut
  keys: string
  description: string
  requiresAutomatic?: boolean
}> = [
  { action: 'overall-pass', keys: 'P', description: 'Overall pass' },
  { action: 'overall-fail', keys: 'F', description: 'Overall fail' },
  { action: 'overall-unsure', keys: 'U', description: 'Overall unsure' },
  {
    action: 'failure-confirm',
    keys: 'C',
    description: 'Confirm hovered/expanded failure',
    requiresAutomatic: true,
  },
  {
    action: 'failure-reject',
    keys: 'X',
    description: 'Reject hovered/expanded failure',
    requiresAutomatic: true,
  },
  { action: 'save', keys: '⌘/Ctrl S', description: 'Save draft (works while typing)' },
  { action: 'submit', keys: '⌘/Ctrl Enter', description: 'Submit and lock (works while typing)' },
  { action: 'next', keys: 'Alt/Option ↓', description: 'Next queue item' },
  { action: 'prev', keys: 'Alt/Option ↑', description: 'Previous queue item' },
]

export function visibleReviewShortcutLabels(hasAutomaticFailures: boolean) {
  return REVIEW_SHORTCUT_LABELS.filter(
    (shortcut) => !shortcut.requiresAutomatic || hasAutomaticFailures,
  )
}

const EDITING_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])

/**
 * Single-key classification shortcuts stay disabled inside editable controls
 * so typing a note never mutates the review. Modifier chords (⌘/Ctrl S,
 * ⌘/Ctrl Enter) are exempt: they must work globally, including inside a
 * textarea, so the fast path can be submitted without leaving the note field.
 */
export function isReviewEditingTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as EventTarget & {
    tagName?: unknown
    isContentEditable?: unknown
    getAttribute?: (name: string) => string | null
    closest?: (selectors: string) => unknown
  }
  const tagName = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : ''
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
  if (element.isContentEditable === true) return true
  const role = element.getAttribute?.('role')?.toLowerCase()
  if (role && EDITING_ROLES.has(role)) return true
  return Boolean(
    element.closest?.(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"]',
    ),
  )
}

export function reviewShortcutFor(event: ReviewShortcutEvent): ReviewShortcut | null {
  if (event.repeat || event.isComposing || event.defaultPrevented) return null
  const editing = isReviewEditingTarget(event.target)
  if (event.metaKey || event.ctrlKey) {
    if (event.altKey || event.shiftKey) return null
    // Global chords: these fire even while typing in an editable control.
    if (event.key.toLocaleLowerCase() === 's') return 'save'
    if (event.key === 'Enter') return 'submit'
    return null
  }
  if (editing) return null
  if (event.altKey) {
    if (event.shiftKey) return null
    if (event.key === 'ArrowDown') return 'next'
    if (event.key === 'ArrowUp') return 'prev'
    return null
  }
  if (event.shiftKey) return null
  switch (event.key.toLocaleLowerCase()) {
    case 'p':
      return 'overall-pass'
    case 'f':
      return 'overall-fail'
    case 'u':
      return 'overall-unsure'
    case 'c':
      return 'failure-confirm'
    case 'x':
      return 'failure-reject'
  }
  return null
}

function withFailureDecision(
  payload: ReviewPayload,
  failureId: string,
  decision: FailureDecision,
): ReviewPayload {
  const existing = payload.failureReviews.find((item) => item.failureId === failureId)
  return {
    ...payload,
    failureReviews: [
      ...payload.failureReviews.filter((item) => item.failureId !== failureId),
      { failureId, decision, note: existing?.note ?? '' },
    ],
  }
}

/**
 * Apply only the classification shortcuts that mutate a review payload.
 * Failure decisions additionally require the focused id to be present in the
 * server-visible automatic context. An unlocked Calibration response supplies
 * no ids, so it cannot infer or mutate hidden automatic findings.
 */
export function applyReviewClassificationShortcut(
  payload: ReviewPayload,
  shortcut: ReviewShortcut,
  focusedFailureId: string | null,
  visibleFailureIds: readonly string[],
): ReviewPayload {
  if (shortcut === 'overall-pass') return { ...payload, overallVerdict: 'pass' }
  if (shortcut === 'overall-fail') return { ...payload, overallVerdict: 'fail' }
  if (shortcut === 'overall-unsure') return { ...payload, overallVerdict: 'unsure' }
  if (!focusedFailureId || !visibleFailureIds.includes(focusedFailureId)) return payload
  if (shortcut === 'failure-confirm') {
    return withFailureDecision(payload, focusedFailureId, 'confirmed')
  }
  if (shortcut === 'failure-reject') {
    return withFailureDecision(payload, focusedFailureId, 'false_positive')
  }
  return payload
}
