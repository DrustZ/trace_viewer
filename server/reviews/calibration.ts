import {
  type CalibrationDimensionStats,
  type CalibrationStatsResponse,
  type ReviewRecord,
  reviewSubjectKey,
} from '../../shared/reviews/types'

export interface CalibrationFilters {
  corpusId?: string
  runId?: string
  rubricVersion?: string
  annotator?: string
}

function matchesFilters(record: ReviewRecord, filters: CalibrationFilters): boolean {
  return (
    record.mode === 'calibration' &&
    (filters.corpusId === undefined || record.corpusId === filters.corpusId) &&
    (filters.runId === undefined || record.runId === filters.runId) &&
    (filters.rubricVersion === undefined || record.rubricVersion === filters.rubricVersion) &&
    (filters.annotator === undefined || record.annotator === filters.annotator)
  )
}

/** Amendments are append-only; calibration reports use only the latest revision. */
function latestRecords(records: readonly ReviewRecord[]): ReviewRecord[] {
  const latest = new Map<string, ReviewRecord>()
  for (const record of records) {
    const key = reviewSubjectKey(record)
    const previous = latest.get(key)
    if (!previous || record.revision > previous.revision) latest.set(key, record)
  }
  return [...latest.values()]
}

function dimensionStats(
  dimensionId: string,
  pairs: Array<{ human: 'pass' | 'fail'; automatic: 'pass' | 'fail' }>,
): CalibrationDimensionStats {
  const confusion = {
    humanPassJudgePass: 0,
    humanPassJudgeFail: 0,
    humanFailJudgePass: 0,
    humanFailJudgeFail: 0,
  }
  for (const pair of pairs) {
    if (pair.human === 'pass' && pair.automatic === 'pass') confusion.humanPassJudgePass += 1
    if (pair.human === 'pass' && pair.automatic === 'fail') confusion.humanPassJudgeFail += 1
    if (pair.human === 'fail' && pair.automatic === 'pass') confusion.humanFailJudgePass += 1
    if (pair.human === 'fail' && pair.automatic === 'fail') confusion.humanFailJudgeFail += 1
  }

  const agreements = confusion.humanPassJudgePass + confusion.humanFailJudgeFail
  const humanPass = confusion.humanPassJudgePass + confusion.humanPassJudgeFail
  const humanFail = confusion.humanFailJudgePass + confusion.humanFailJudgeFail
  const judgePass = confusion.humanPassJudgePass + confusion.humanFailJudgePass
  const judgeFail = confusion.humanPassJudgeFail + confusion.humanFailJudgeFail
  const rawAgreement = pairs.length > 0 ? agreements / pairs.length : null

  let kappa: number | null = null
  let kappaStatus: CalibrationDimensionStats['kappaStatus'] = 'undefined_no_pairs'
  if (pairs.length > 0) {
    if (humanPass === 0 || humanFail === 0 || judgePass === 0 || judgeFail === 0) {
      kappaStatus = 'undefined_single_class'
    } else {
      const expectedAgreement =
        (humanPass / pairs.length) * (judgePass / pairs.length) +
        (humanFail / pairs.length) * (judgeFail / pairs.length)
      kappa =
        expectedAgreement >= 1
          ? null
          : ((rawAgreement ?? 0) - expectedAgreement) / (1 - expectedAgreement)
      kappaStatus = kappa === null ? 'undefined_single_class' : 'defined'
    }
  }

  return {
    dimensionId,
    pairs: pairs.length,
    agreements,
    rawAgreement,
    kappa,
    kappaStatus,
    perClassRecall: {
      pass: humanPass > 0 ? confusion.humanPassJudgePass / humanPass : null,
      fail: humanFail > 0 ? confusion.humanFailJudgeFail / humanFail : null,
    },
    confusion,
  }
}

export function computeCalibrationStats(
  allRecords: readonly ReviewRecord[],
  filters: CalibrationFilters = {},
): CalibrationStatsResponse {
  const records = latestRecords(allRecords.filter((record) => matchesFilters(record, filters)))
  const pairsByDimension = new Map<
    string,
    Array<{ human: 'pass' | 'fail'; automatic: 'pass' | 'fail' }>
  >()
  const disagreements: CalibrationStatsResponse['disagreements'] = []
  let recordsWithAutomaticVerdicts = 0

  for (const record of records) {
    const automatic = record.automaticSnapshot?.judgeVerdicts
    if (!automatic) continue
    recordsWithAutomaticVerdicts += 1
    for (const humanReview of record.rubricReviews) {
      if (humanReview.verdict === 'skip') continue
      const automaticVerdict = automatic[humanReview.dimensionId]?.verdict
      if (automaticVerdict !== 'pass' && automaticVerdict !== 'fail') continue
      const pair = { human: humanReview.verdict, automatic: automaticVerdict }
      const existing = pairsByDimension.get(humanReview.dimensionId)
      if (existing) existing.push(pair)
      else pairsByDimension.set(humanReview.dimensionId, [pair])
      if (pair.human !== pair.automatic) {
        disagreements.push({
          traceUid: record.traceUid,
          corpusId: record.corpusId,
          runId: record.runId,
          rubricVersion: record.rubricVersion,
          dimensionId: humanReview.dimensionId,
          human: pair.human,
          automatic: pair.automatic,
        })
      }
    }
  }

  return {
    records: records.length,
    recordsWithAutomaticVerdicts,
    dimensions: [...pairsByDimension.entries()]
      .map(([dimensionId, pairs]) => dimensionStats(dimensionId, pairs))
      .sort((a, b) => a.dimensionId.localeCompare(b.dimensionId)),
    disagreements,
  }
}

export function recordHasDisagreement(record: ReviewRecord): boolean {
  return computeCalibrationStats([record]).disagreements.length > 0
}
