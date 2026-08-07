import type { ReviewQueueResponse } from '@shared/reviews/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReviewQueuePagination } from './ReviewQueue'

function page(offset: number, count: number, total: number): ReviewQueueResponse {
  return {
    total,
    limit: 200,
    offset,
    items: Array.from({ length: count }, (_, index) => ({
      subject: {
        corpusId: 'simulation',
        runId: 'run-a',
        traceUid: `trace-${offset + index}`,
        rubricVersion: 'judge_v2',
        annotator: 'local',
        mode: 'assisted' as const,
      },
      trace: {
        corpusId: 'simulation',
        runId: 'run-a',
        traceUid: `trace-${offset + index}`,
        sourceTraceId: `trace-${offset + index}`,
      },
      state: 'unreviewed' as const,
      revision: 1,
      locked: false,
      priority: 'none' as const,
      rootCauseTags: [],
    })),
  }
}

describe('ReviewQueuePagination', () => {
  it('renders a truthful final-page range and disables only the unavailable direction', () => {
    const html = renderToStaticMarkup(
      <ReviewQueuePagination
        page={page(200, 5, 205)}
        onPrevious={() => undefined}
        onNext={() => undefined}
      />,
    )

    expect(html).toContain('Showing 201–205 of 205')
    const previous = html.match(/<button[^>]*aria-label="Previous review page"[^>]*>/)?.[0]
    const next = html.match(/<button[^>]*aria-label="Next review page"[^>]*>/)?.[0]
    expect(previous).not.toContain(' disabled=""')
    expect(next).toContain(' disabled=""')
  })

  it('renders an empty queue as zero of zero with both directions disabled', () => {
    const html = renderToStaticMarkup(
      <ReviewQueuePagination
        page={page(0, 0, 0)}
        onPrevious={() => undefined}
        onNext={() => undefined}
      />,
    )

    expect(html).toContain('Showing 0 of 0')
    expect(html.match(/ disabled=""/g)).toHaveLength(2)
  })
})
