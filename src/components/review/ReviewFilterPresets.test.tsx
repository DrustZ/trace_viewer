import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReviewFilterPresets } from './ReviewFilterPresets'

describe('ReviewFilterPresets', () => {
  it('renders explicit local scope and URL source-of-truth guidance', () => {
    const html = renderToStaticMarkup(
      <ReviewFilterPresets
        filters={{
          annotator: 'local',
          rubricVersion: 'judge_v2',
          mode: 'calibration',
          corpusId: 'ace',
          state: 'unreviewed',
        }}
        onApply={() => undefined}
      />,
    )

    expect(html).toContain('Saved filter presets')
    expect(html).toContain('This browser only')
    expect(html).toContain('Name the current filters')
    expect(html).toContain('updates the shareable URL')
    expect(html).toContain('never sent to the server')
  })
})
