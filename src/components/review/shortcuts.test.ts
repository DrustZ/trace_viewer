import { emptyReviewPayload } from '@shared/reviews/types'
import { describe, expect, it } from 'vitest'
import {
  applyReviewClassificationShortcut,
  isReviewEditingTarget,
  type ReviewShortcutEvent,
  reviewShortcutFor,
  visibleReviewShortcutLabels,
} from './shortcuts'

function key(value: string, overrides: Partial<ReviewShortcutEvent> = {}): ReviewShortcutEvent {
  return {
    key: value,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  }
}

describe('human review keyboard shortcuts', () => {
  it('maps Command/Ctrl+S to save and Command/Ctrl+Enter to submit', () => {
    expect(reviewShortcutFor(key('s', { metaKey: true }))).toBe('save')
    expect(reviewShortcutFor(key('S', { ctrlKey: true }))).toBe('save')
    expect(reviewShortcutFor(key('Enter', { metaKey: true }))).toBe('submit')
    expect(reviewShortcutFor(key('Enter', { ctrlKey: true }))).toBe('submit')
  })

  it('maps Alt/Option+Arrow to queue navigation in both directions', () => {
    expect(reviewShortcutFor(key('ArrowDown', { altKey: true }))).toBe('next')
    expect(reviewShortcutFor(key('ArrowUp', { altKey: true }))).toBe('prev')
  })

  it('maps single-key review and focused-failure decisions', () => {
    expect(reviewShortcutFor(key('p'))).toBe('overall-pass')
    expect(reviewShortcutFor(key('f'))).toBe('overall-fail')
    expect(reviewShortcutFor(key('u'))).toBe('overall-unsure')
    expect(reviewShortcutFor(key('c'))).toBe('failure-confirm')
    expect(reviewShortcutFor(key('x'))).toBe('failure-reject')
  })

  it('does not fire shortcuts for typing, repeats, or ambiguous modifier chords', () => {
    expect(reviewShortcutFor(key('s'))).toBeNull()
    expect(reviewShortcutFor(key('ArrowDown'))).toBeNull()
    expect(reviewShortcutFor(key('ArrowDown', { altKey: true, repeat: true }))).toBeNull()
    expect(reviewShortcutFor(key('s', { altKey: true, metaKey: true }))).toBeNull()
    expect(reviewShortcutFor(key('p', { shiftKey: true }))).toBeNull()
    expect(reviewShortcutFor(key('p', { isComposing: true }))).toBeNull()
    expect(reviewShortcutFor(key('p', { defaultPrevented: true }))).toBeNull()
  })

  it('disables single-key and Alt-arrow shortcuts inside editing controls', () => {
    const input = { tagName: 'INPUT' } as unknown as EventTarget
    const textarea = { tagName: 'textarea' } as unknown as EventTarget
    const contentEditable = { tagName: 'div', isContentEditable: true } as unknown as EventTarget
    const customTextbox = {
      tagName: 'div',
      getAttribute: (name: string) => (name === 'role' ? 'textbox' : null),
    } as unknown as EventTarget

    for (const target of [input, textarea, contentEditable, customTextbox]) {
      expect(isReviewEditingTarget(target)).toBe(true)
      expect(reviewShortcutFor(key('p', { target }))).toBeNull()
      expect(reviewShortcutFor(key('u', { target }))).toBeNull()
      expect(reviewShortcutFor(key('c', { target }))).toBeNull()
      expect(reviewShortcutFor(key('ArrowDown', { altKey: true, target }))).toBeNull()
      expect(reviewShortcutFor(key('ArrowUp', { altKey: true, target }))).toBeNull()
    }
  })

  it('keeps ⌘/Ctrl chords global so submit and save work inside a textarea', () => {
    const textarea = { tagName: 'TEXTAREA' } as unknown as EventTarget
    const input = { tagName: 'INPUT' } as unknown as EventTarget

    expect(reviewShortcutFor(key('Enter', { metaKey: true, target: textarea }))).toBe('submit')
    expect(reviewShortcutFor(key('Enter', { ctrlKey: true, target: textarea }))).toBe('submit')
    expect(reviewShortcutFor(key('s', { metaKey: true, target: input }))).toBe('save')
    expect(reviewShortcutFor(key('s', { ctrlKey: true, target: textarea }))).toBe('save')
  })

  it('mutates only server-visible focused automatic failures', () => {
    const initial = emptyReviewPayload()
    const passed = applyReviewClassificationShortcut(initial, 'overall-pass', null, [])
    expect(passed.overallVerdict).toBe('pass')
    expect(applyReviewClassificationShortcut(passed, 'overall-unsure', null, []).overallVerdict).toBe(
      'unsure',
    )

    const hidden = applyReviewClassificationShortcut(initial, 'failure-confirm', 'secret-id', [])
    expect(hidden).toBe(initial)
    expect(hidden.failureReviews).toEqual([])

    const confirmed = applyReviewClassificationShortcut(initial, 'failure-confirm', 'visible-id', [
      'visible-id',
    ])
    expect(confirmed.failureReviews).toEqual([
      { failureId: 'visible-id', decision: 'confirmed', note: '' },
    ])

    const rejected = applyReviewClassificationShortcut(confirmed, 'failure-reject', 'visible-id', [
      'visible-id',
    ])
    expect(rejected.failureReviews).toEqual([
      { failureId: 'visible-id', decision: 'false_positive', note: '' },
    ])
  })

  it('does not render automatic-failure shortcut hints without visible automatic findings', () => {
    expect(visibleReviewShortcutLabels(false).map((shortcut) => shortcut.action)).not.toContain(
      'failure-confirm',
    )
    expect(visibleReviewShortcutLabels(false).map((shortcut) => shortcut.action)).not.toContain(
      'failure-reject',
    )
    expect(visibleReviewShortcutLabels(true).map((shortcut) => shortcut.action)).toContain(
      'failure-confirm',
    )
  })
})
