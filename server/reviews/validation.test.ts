import { emptyReviewPayload } from '../../shared/reviews/types'
import { describe, expect, it } from 'vitest'
import { parseReviewPayload, parseStoredRecord } from './validation'

describe('review payload validation — judgeReviews', () => {
  it('accepts a payload with judge calibration verdicts', () => {
    const parsed = parseReviewPayload({
      ...emptyReviewPayload(),
      judgeReviews: {
        resolution: { decision: 'agree' },
        escalation: { decision: 'disagree', note: 'cited nonexistent evidence' },
        communication: { decision: 'unsure', note: '' },
      },
    })
    expect(parsed.judgeReviews).toMatchObject({
      escalation: { decision: 'disagree', note: 'cited nonexistent evidence' },
    })
  })

  it('stays backward compatible: legacy payloads without the field parse unchanged', () => {
    const parsed = parseReviewPayload(emptyReviewPayload())
    expect(parsed.judgeReviews).toBeUndefined()
  })

  it('rejects unknown decisions and extra keys', () => {
    expect(() =>
      parseReviewPayload({
        ...emptyReviewPayload(),
        judgeReviews: { resolution: { decision: 'overruled' } },
      }),
    ).toThrow()
    expect(() =>
      parseReviewPayload({
        ...emptyReviewPayload(),
        judgeReviews: { resolution: { decision: 'agree', verdictOverride: 'pass' } },
      }),
    ).toThrow()
  })

  it('accepts stored final records carrying judgeReviews (reviews.jsonl round-trip)', () => {
    const record = parseStoredRecord({
      corpusId: 'simulation',
      runId: 'run-1',
      traceUid: 'trace-1',
      rubricVersion: 'judge_v2',
      annotator: 'local',
      mode: 'assisted',
      ...emptyReviewPayload(),
      judgeReviews: { outcome: { decision: 'disagree', note: 'misread policy' } },
      revision: 1,
      key: 'k',
      locked: true,
      createdAt: '2026-08-07T00:00:00Z',
      submittedAt: '2026-08-07T00:00:01Z',
    })
    expect(record.judgeReviews?.outcome?.decision).toBe('disagree')
  })
})
