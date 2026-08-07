import { emptyReviewPayload, REVIEW_STATUSES, REVIEW_VERDICTS } from '@shared/reviews/types'
import { describe, expect, it } from 'vitest'
import {
  evidenceDimensionsByMessage,
  finalizeReviewPayload,
  rootCauseTagSuggestions,
  toggleEvidenceMessageId,
} from './reviewFastPath'

describe('fast-path submit payload', () => {
  it('produces a contract-valid payload from verdict + note only', () => {
    const payload = emptyReviewPayload()
    payload.overallVerdict = 'fail'
    payload.note = 'Agent promised a refund above the cap.'

    const finalized = finalizeReviewPayload(payload)

    expect(finalized.overallVerdict).toBe('fail')
    expect(finalized.note).toBe('Agent promised a refund above the cap.')
    // Submit flips in_review → reviewed automatically.
    expect(finalized.reviewStatus).toBe('reviewed')
    expect(REVIEW_STATUSES).toContain(finalized.reviewStatus)
    expect(REVIEW_VERDICTS).toContain(finalized.overallVerdict)
    // Untouched fields keep their contract defaults instead of disappearing.
    expect(finalized.priority).toBe('none')
    expect(finalized.rootCauseTags).toEqual([])
    expect(finalized.rubricReviews).toEqual([])
    expect(finalized.failureReviews).toEqual([])
    expect(finalized.turnAnnotations).toEqual([])
  })

  it('preserves an explicit manual review-status override', () => {
    const payload = { ...emptyReviewPayload(), reviewStatus: 'skipped' as const }
    expect(finalizeReviewPayload(payload).reviewStatus).toBe('skipped')
  })
})

describe('transcript click toggles evidence', () => {
  const withRubric = () => ({
    ...emptyReviewPayload(),
    rubricReviews: [
      { dimensionId: 'accuracy', verdict: 'skip' as const, critique: '', evidenceMessageIds: [] },
      {
        dimensionId: 'tone',
        verdict: 'skip' as const,
        critique: '',
        evidenceMessageIds: ['m-2'],
      },
    ],
  })

  it('adds then removes a message id for the focused dimension only', () => {
    const initial = withRubric()
    const added = toggleEvidenceMessageId(initial, 'accuracy', 'm-1')
    expect(added.rubricReviews[0]?.evidenceMessageIds).toEqual(['m-1'])
    expect(added.rubricReviews[1]?.evidenceMessageIds).toEqual(['m-2'])

    const removed = toggleEvidenceMessageId(added, 'accuracy', 'm-1')
    expect(removed.rubricReviews[0]?.evidenceMessageIds).toEqual([])
    expect(removed.rubricReviews[1]?.evidenceMessageIds).toEqual(['m-2'])
  })

  it('is a detectable no-op without a focused dimension, so the UI can hint', () => {
    const initial = withRubric()
    expect(toggleEvidenceMessageId(initial, null, 'm-1')).toBe(initial)
    expect(toggleEvidenceMessageId(initial, 'missing-dimension', 'm-1')).toBe(initial)
  })

  it('maps messages back to the dimensions citing them for badges', () => {
    const payload = toggleEvidenceMessageId(withRubric(), 'accuracy', 'm-2')
    const byMessage = evidenceDimensionsByMessage(payload)
    expect(byMessage.get('m-2')).toEqual(['accuracy', 'tone'])
    expect(byMessage.has('m-1')).toBe(false)
  })
})

describe('root-cause tag suggestions', () => {
  it('aggregates queue tags by frequency and hides already-selected tags', () => {
    const items = [
      { rootCauseTags: ['refund-cap', 'tone'] },
      { rootCauseTags: ['refund-cap'] },
      { rootCauseTags: ['hallucination', ' tone '] },
      { rootCauseTags: [] },
    ]
    expect(rootCauseTagSuggestions(items)).toEqual(['refund-cap', 'tone', 'hallucination'])
    expect(rootCauseTagSuggestions(items, ['tone'])).toEqual(['refund-cap', 'hallucination'])
  })
})
