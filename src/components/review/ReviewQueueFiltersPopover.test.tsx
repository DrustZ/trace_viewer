import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReviewQueueFilters } from '../../api/reviews'
import { ReviewQueueFiltersPopover } from './ReviewQueueFiltersPopover'
import {
  activeReviewQueueFilterCount,
  patchReviewQueueFilters,
  reviewQueueFiltersFromSearchParams,
  reviewQueueFiltersToSearchParams,
} from './reviewQueueState'

const fullFilters: ReviewQueueFilters = {
  annotator: 'ray',
  rubricVersion: 'judge_v3',
  mode: 'assisted',
  state: 'draft',
  priority: 'high',
  corpusId: 'production',
  runId: 'run-b',
  q: 'refund',
  tags: ['refund-cap', 'tone'],
  disagreement: true,
  limit: 200,
  offset: 400,
}

describe('Filters popover keeps every queue parameter', () => {
  it('merges a single control edit without dropping q, tags, or disagreement', () => {
    const next = patchReviewQueueFilters(fullFilters, { priority: 'low' })

    expect(next.priority).toBe('low')
    expect(next.q).toBe('refund')
    expect(next.tags).toEqual(['refund-cap', 'tone'])
    expect(next.disagreement).toBe(true)
    expect(next.annotator).toBe('ray')
    expect(next.rubricVersion).toBe('judge_v3')
    expect(next.runId).toBe('run-b')
    // Every edit restarts pagination so the page window stays truthful.
    expect(next.offset).toBe(0)
  })

  it('round-trips the merged filters through the URL without loss', () => {
    const next = patchReviewQueueFilters(fullFilters, { state: 'submitted' })
    const restored = reviewQueueFiltersFromSearchParams(reviewQueueFiltersToSearchParams(next))

    expect(restored.state).toBe('submitted')
    expect(restored.q).toBe('refund')
    expect(restored.tags).toEqual(['refund-cap', 'tone'])
    expect(restored.disagreement).toBe(true)
    expect(restored.priority).toBe('high')
    expect(restored.runId).toBe('run-b')
  })

  it('renders all filter controls with the current values when open', () => {
    const html = renderToStaticMarkup(
      <ReviewQueueFiltersPopover
        defaultOpen
        filters={fullFilters}
        onSetFilters={() => undefined}
      />,
    )

    for (const label of [
      'Search reviews',
      'Review corpus',
      'Review state',
      'Review priority',
      'Annotator',
      'Rubric version',
      'Run ID',
    ]) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    expect(html).toContain('value="refund"')
    expect(html).toContain('value="ray"')
    expect(html).toContain('value="judge_v3"')
    expect(html).toContain('value="run-b"')
    expect(html).toContain('calibration')
    expect(html).toContain('Saved filter presets')
  })

  it('shows an active-filter badge count', () => {
    // state, priority, corpusId, runId, q, tags, disagreement = 7
    expect(activeReviewQueueFilterCount(fullFilters)).toBe(7)
    expect(
      activeReviewQueueFilterCount({
        annotator: 'local',
        rubricVersion: 'judge_v2',
        mode: 'calibration',
      }),
    ).toBe(0)
    const html = renderToStaticMarkup(
      <ReviewQueueFiltersPopover filters={fullFilters} onSetFilters={() => undefined} />,
    )
    expect(html).toContain('>7<')
  })
})
