import type { ReviewPayload, ReviewQueueItem } from '@shared/reviews/types'

/**
 * Fast-path submit: an annotator who only picked a verdict and typed a note
 * still produces a complete, contract-valid ReviewPayload. Submitting moves
 * an in-progress review to `reviewed` automatically; an explicit manual
 * override (`skipped`, or an already `reviewed` status) is preserved.
 */
export function finalizeReviewPayload(payload: ReviewPayload): ReviewPayload {
  return {
    ...payload,
    reviewStatus: payload.reviewStatus === 'in_review' ? 'reviewed' : payload.reviewStatus,
  }
}

/**
 * Toggle a transcript message in/out of the evidence list of one rubric
 * dimension. Returns the same payload reference when the dimension is not
 * part of the review, so callers can detect a no-op and show a hint instead.
 */
export function toggleEvidenceMessageId(
  payload: ReviewPayload,
  dimensionId: string | null,
  messageId: string,
): ReviewPayload {
  if (!dimensionId) return payload
  const review = payload.rubricReviews.find((item) => item.dimensionId === dimensionId)
  if (!review) return payload
  const selected = review.evidenceMessageIds.includes(messageId)
  return {
    ...payload,
    rubricReviews: payload.rubricReviews.map((item) =>
      item.dimensionId === dimensionId
        ? {
            ...item,
            evidenceMessageIds: selected
              ? item.evidenceMessageIds.filter((id) => id !== messageId)
              : [...item.evidenceMessageIds, messageId],
          }
        : item,
    ),
  }
}

/** Which dimensions cite a message, for the "selected" badge on transcript rows. */
export function evidenceDimensionsByMessage(payload: ReviewPayload): Map<string, string[]> {
  const byMessage = new Map<string, string[]>()
  for (const review of payload.rubricReviews) {
    for (const messageId of review.evidenceMessageIds) {
      const existing = byMessage.get(messageId)
      if (existing) existing.push(review.dimensionId)
      else byMessage.set(messageId, [review.dimensionId])
    }
  }
  return byMessage
}

/**
 * Suggestion source for root-cause tags: the queue API exposes each item's
 * historical tags, so the loaded queue page is aggregated client-side.
 * Ordered by frequency (then alphabetically) and excluding already-set tags.
 */
export function rootCauseTagSuggestions(
  items: readonly Pick<ReviewQueueItem, 'rootCauseTags'>[],
  current: readonly string[] = [],
): string[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const raw of item.rootCauseTags) {
      const tag = raw.trim()
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  const selected = new Set(current)
  return [...counts.entries()]
    .filter(([tag]) => !selected.has(tag))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
}
