import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReviewFastPath } from './ReviewFastPath'
import { ReviewTranscriptSection } from './ReviewTranscriptSection'

const noop = () => undefined

describe('ReviewFastPath first screen', () => {
  it('shows only verdict buttons, note, submit, save, and prev/next', () => {
    const html = renderToStaticMarkup(
      <ReviewFastPath
        verdict="unsure"
        note=""
        locked={false}
        dirty={false}
        saving={false}
        submitting={false}
        canStartRevision={false}
        nextRevision={1}
        onVerdict={noop}
        onNote={noop}
        onSave={noop}
        onSubmit={noop}
        onStartRevision={noop}
        onPrev={noop}
        onNext={noop}
      />,
    )

    for (const label of ['Pass', 'Fail', 'Unsure', 'Submit &amp; lock', 'Save draft']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('← Prev')
    expect(html).toContain('Next →')
    // Exactly the fast-path controls: 3 verdict + prev + next + save + submit = 7 buttons,
    // 1 textarea, and nothing else interactive on the first screen.
    expect(html.match(/<button/g)).toHaveLength(7)
    expect(html.match(/<textarea/g)).toHaveLength(1)
    expect(html.match(/<select|<input/g)).toBeNull()
    // The current verdict is marked pressed.
    expect(html).toMatch(/aria-pressed="true"[^>]*>Unsure|Unsure[^<]*<\/button>/)
    // Submit is reachable from the keyboard globally.
    expect(html).toContain('aria-keyshortcuts="Control+Enter Meta+Enter"')
  })
})

describe('ReviewTranscriptSection evidence picking', () => {
  const messages = [
    { id: 'm-1', role: 'user', content: 'Where is my refund?' },
    { id: 'm-2', role: 'assistant', content: 'I will refund $900.' },
  ]

  it('marks selected evidence for the focused dimension and shows citation badges', () => {
    const html = renderToStaticMarkup(
      <ReviewTranscriptSection
        messages={messages}
        locked={false}
        focusedDimensionLabel="Accuracy"
        selectedIds={new Set(['m-2'])}
        evidenceBadges={new Map([['m-2', ['Accuracy', 'Tone']]])}
        hint={null}
        onToggle={noop}
      />,
    )

    expect(html).toContain('toggle it as evidence for “Accuracy”')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('evidence ×2')
    expect(html).toContain('aria-label="Toggle m-2 as evidence"')
  })

  it('renders the no-focused-dimension hint when provided', () => {
    const html = renderToStaticMarkup(
      <ReviewTranscriptSection
        messages={messages}
        locked={false}
        focusedDimensionLabel={null}
        selectedIds={new Set()}
        evidenceBadges={new Map()}
        hint="Pick a rubric dimension first."
        onToggle={noop}
      />,
    )
    expect(html).toContain('Pick a rubric dimension first.')
  })
})
