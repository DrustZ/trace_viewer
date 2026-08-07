import { describe, expect, it } from 'vitest'
import type { ReviewRecord } from '../../shared/reviews/types'
import { reviewRecordKey } from '../../shared/reviews/types'
import { computeCalibrationStats, recordHasDisagreement } from './calibration'

function record(
  traceUid: string,
  human: 'pass' | 'fail',
  automatic: 'pass' | 'fail',
  overrides: Partial<ReviewRecord> = {},
): ReviewRecord {
  const subject = {
    corpusId: 'simulation',
    runId: 'batch-a',
    traceUid,
    rubricVersion: 'judge_v2',
    annotator: 'local',
    mode: 'calibration' as const,
  }
  return {
    ...subject,
    reviewStatus: 'reviewed',
    overallVerdict: human,
    priority: 'none',
    rootCauseTags: [],
    note: '',
    rubricReviews: [
      { dimensionId: 'resolution', verdict: human, critique: '', evidenceMessageIds: [] },
      { dimensionId: 'single-class', verdict: 'pass', critique: '', evidenceMessageIds: [] },
    ],
    failureReviews: [],
    turnAnnotations: [],
    revision: 1,
    key: reviewRecordKey(subject, 1),
    locked: true,
    createdAt: '2026-08-06T00:00:00.000Z',
    submittedAt: '2026-08-06T00:00:00.000Z',
    automaticSnapshot: {
      judgeVerdicts: {
        resolution: { verdict: automatic },
        'single-class': { verdict: 'pass' },
      },
    },
    ...overrides,
  }
}

describe('calibration statistics', () => {
  it('reports raw agreement, kappa, per-class recall, and undefined single-class kappa', () => {
    const result = computeCalibrationStats([
      record('trace-1', 'pass', 'fail'),
      record('trace-2', 'pass', 'pass'),
      record('trace-3', 'fail', 'pass'),
      record('trace-4', 'fail', 'fail'),
    ])
    expect(result).toMatchObject({
      records: 4,
      recordsWithAutomaticVerdicts: 4,
    })
    expect(result.disagreements).toEqual([
      expect.objectContaining({ traceUid: 'trace-1', dimensionId: 'resolution' }),
      expect.objectContaining({ traceUid: 'trace-3', dimensionId: 'resolution' }),
    ])

    const resolution = result.dimensions.find((item) => item.dimensionId === 'resolution')
    expect(resolution).toMatchObject({
      pairs: 4,
      agreements: 2,
      rawAgreement: 0.5,
      kappa: 0,
      kappaStatus: 'defined',
      perClassRecall: { pass: 0.5, fail: 0.5 },
    })
    const singleClass = result.dimensions.find((item) => item.dimensionId === 'single-class')
    expect(singleClass).toMatchObject({
      rawAgreement: 1,
      kappa: null,
      kappaStatus: 'undefined_single_class',
    })
  })

  it('uses the latest revision and excludes assisted labels from calibration', () => {
    const old = record('trace-1', 'pass', 'fail')
    const revised = record('trace-1', 'fail', 'fail', {
      revision: 2,
      key: reviewRecordKey(old, 2),
    })
    const assisted = record('trace-2', 'pass', 'fail', { mode: 'assisted' })
    const result = computeCalibrationStats([old, revised, assisted])
    expect(result.records).toBe(1)
    expect(result.disagreements).toEqual([])
    expect(result.dimensions.find((item) => item.dimensionId === 'resolution')).toMatchObject({
      pairs: 1,
      rawAgreement: 1,
      kappa: null,
      kappaStatus: 'undefined_single_class',
    })
  })

  it('flags human/judge disagreement on assisted records too', () => {
    expect(recordHasDisagreement(record('trace-1', 'pass', 'fail', { mode: 'assisted' }))).toBe(
      true,
    )
    expect(recordHasDisagreement(record('trace-2', 'pass', 'pass', { mode: 'assisted' }))).toBe(
      false,
    )
    expect(recordHasDisagreement(record('trace-3', 'fail', 'pass'))).toBe(true)
    expect(
      recordHasDisagreement(record('trace-4', 'fail', 'pass', { automaticSnapshot: undefined })),
    ).toBe(false)
  })
})
