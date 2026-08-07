import type { AceBatchEpisode } from '@shared/schema/ace'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAceRun } from '../../api/ace'

export type AcePairDelta = 'improvement' | 'regression' | 'tie' | 'not_comparable'

export interface AceEpisodePair {
  key: string
  scenarioId: string
  seed: number
  a: AceBatchEpisode
  b: AceBatchEpisode
  delta: AcePairDelta
}

export interface AcePairingIntegrity {
  /** Rows without a locally derived schedule/scenario/seed identity. */
  missingPairKeyRowsA: number
  missingPairKeyRowsB: number
  /** Keys repeated within arm A. Every row for these keys is excluded from pairing. */
  duplicateKeysA: string[]
  /** Keys repeated within arm B. Every row for these keys is excluded from pairing. */
  duplicateKeysB: string[]
  /** Union of duplicate keys across both arms. A key must be unique on both sides to pair. */
  excludedDuplicatePairKeys: string[]
  excludedRowsA: number
  excludedRowsB: number
  unmatchedUniqueA: number
  unmatchedUniqueB: number
}

export interface AcePairingResult {
  pairs: AceEpisodePair[]
  integrity: AcePairingIntegrity
}

export function classifyAcePair(a: AceBatchEpisode, b: AceBatchEpisode): AcePairDelta {
  if (!['pass', 'fail'].includes(a.outcome) || !['pass', 'fail'].includes(b.outcome)) {
    return 'not_comparable'
  }
  if (a.outcome !== 'pass' && b.outcome === 'pass') return 'improvement'
  if (a.outcome === 'pass' && b.outcome !== 'pass') return 'regression'
  return 'tie'
}

function episodesByPairKey(rows: readonly AceBatchEpisode[]): Map<string, AceBatchEpisode[]> {
  const grouped = new Map<string, AceBatchEpisode[]>()
  for (const row of rows) {
    if (!row.pairKey) continue
    const group = grouped.get(row.pairKey)
    if (group) group.push(row)
    else grouped.set(row.pairKey, [row])
  }
  return grouped
}

export function pairAceRuns(a: AceBatchEpisode[], b: AceBatchEpisode[]): AcePairingResult {
  const leftByKey = episodesByPairKey(a)
  const rightByKey = episodesByPairKey(b)
  const duplicateKeysA = [...leftByKey]
    .filter(([, rows]) => rows.length > 1)
    .map(([key]) => key)
    .sort()
  const duplicateKeysB = [...rightByKey]
    .filter(([, rows]) => rows.length > 1)
    .map(([key]) => key)
    .sort()
  const duplicateKeySet = new Set([...duplicateKeysA, ...duplicateKeysB])
  const excludedDuplicatePairKeys = [...duplicateKeySet].sort()

  const pairs = a.flatMap((left) => {
    if (!left.pairKey) return []
    if (duplicateKeySet.has(left.pairKey)) return []
    const leftGroup = leftByKey.get(left.pairKey)
    const rightGroup = rightByKey.get(left.pairKey)
    if (leftGroup?.length !== 1 || rightGroup?.length !== 1) return []
    const match = rightGroup[0]
    if (!match) return []
    return [
      {
        key: left.pairKey,
        scenarioId: left.scenarioId,
        seed: left.environmentSeed,
        a: left,
        b: match,
        delta: classifyAcePair(left, match),
      },
    ]
  })

  const uniqueUncontaminatedKeys = (grouped: ReadonlyMap<string, AceBatchEpisode[]>) =>
    [...grouped]
      .filter(([key, rows]) => rows.length === 1 && !duplicateKeySet.has(key))
      .map(([key]) => key)
  const uniqueLeftKeys = uniqueUncontaminatedKeys(leftByKey)
  const uniqueRightKeys = uniqueUncontaminatedKeys(rightByKey)

  return {
    pairs,
    integrity: {
      missingPairKeyRowsA: a.filter((row) => !row.pairKey).length,
      missingPairKeyRowsB: b.filter((row) => !row.pairKey).length,
      duplicateKeysA,
      duplicateKeysB,
      excludedDuplicatePairKeys,
      excludedRowsA: excludedDuplicatePairKeys.reduce(
        (sum, key) => sum + (leftByKey.get(key)?.length ?? 0),
        0,
      ),
      excludedRowsB: excludedDuplicatePairKeys.reduce(
        (sum, key) => sum + (rightByKey.get(key)?.length ?? 0),
        0,
      ),
      unmatchedUniqueA: uniqueLeftKeys.filter((key) => !rightByKey.has(key)).length,
      unmatchedUniqueB: uniqueRightKeys.filter((key) => !leftByKey.has(key)).length,
    },
  }
}

/** Deep-link one matched unit into the exact two trace revisions when both are durable. */
export function pairedTraceHref(
  runA: string,
  runB: string,
  scenarioId: string,
  traceA?: string,
  traceB?: string,
): string {
  const search = new URLSearchParams({ runA, runB, instance: scenarioId })
  if (traceA) search.set('traceA', traceA)
  if (traceB) search.set('traceB', traceB)
  return `/compare?${search.toString()}`
}

export function pairedPassInterval(pairs: AceEpisodePair[]): {
  delta: number | null
  low: number | null
  high: number | null
  n: number
} {
  if (pairs.length === 0) return { delta: null, low: null, high: null, n: 0 }
  const eligible = pairs.filter((pair) => pair.delta !== 'not_comparable')
  if (eligible.length === 0) return { delta: null, low: null, high: null, n: 0 }
  const differences: number[] = eligible.map((pair) =>
    pair.delta === 'improvement' ? 1 : pair.delta === 'regression' ? -1 : 0,
  )
  const delta = differences.reduce((sum, value) => sum + value, 0) / differences.length
  if (differences.length < 2) return { delta, low: null, high: null, n: differences.length }
  const variance =
    differences.reduce((sum, value) => sum + (value - delta) ** 2, 0) / (differences.length - 1)
  const margin = 1.96 * Math.sqrt(variance / differences.length)
  return {
    delta,
    low: Math.max(-1, delta - margin),
    high: Math.min(1, delta + margin),
    n: differences.length,
  }
}

export function AcePairedComparison({ runA, runB }: { runA: string; runB: string }) {
  const a = useAceRun(runA)
  const b = useAceRun(runB)
  const pairing = useMemo(
    () => pairAceRuns(a.data?.episodes ?? [], b.data?.episodes ?? []),
    [a.data, b.data],
  )
  const { pairs, integrity } = pairing
  if (a.isError || b.isError) return null
  if (a.isLoading || b.isLoading) {
    return (
      <p className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-500">
        Loading matched units…
      </p>
    )
  }
  if (pairs.length === 0) {
    const duplicateDetail =
      integrity.excludedDuplicatePairKeys.length > 0
        ? ` ${integrity.excludedDuplicatePairKeys.length} non-unique pair key(s) were excluded (${integrity.excludedRowsA} A row(s), ${integrity.excludedRowsB} B row(s)).`
        : ''
    const missingIdentityDetail =
      integrity.missingPairKeyRowsA > 0 || integrity.missingPairKeyRowsB > 0
        ? ` ${integrity.missingPairKeyRowsA} A row(s) and ${integrity.missingPairKeyRowsB} B row(s) lack a trustworthy pair identity.`
        : ''
    return (
      <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        No matched units. Paired analysis requires the same schedule digest, scenario ID, and
        environment seed; use the unpaired per-run table above for unrelated batches.
        {duplicateDetail}
        {missingIdentityDetail}
      </p>
    )
  }
  const improvements = pairs.filter((pair) => pair.delta === 'improvement').length
  const regressions = pairs.filter((pair) => pair.delta === 'regression').length
  const ties = pairs.length - improvements - regressions
  const notComparable = pairs.filter((pair) => pair.delta === 'not_comparable').length
  const comparableTies = ties - notComparable
  const interval = pairedPassInterval(pairs)

  return (
    <details open className="shrink-0 rounded-lg border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2 text-xs text-slate-700">
        <b>Matched ACE units</b>
        <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">
          {improvements} improvements
        </span>
        <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">
          {regressions} regressions
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
          {comparableTies} ties
        </span>
        {notComparable > 0 ? (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">
            {notComparable} excluded (invalid/runtime/ungraded)
          </span>
        ) : null}
        {integrity.excludedDuplicatePairKeys.length > 0 ? (
          <span
            className="rounded bg-amber-50 px-2 py-0.5 text-amber-700"
            title={`Non-unique keys: ${integrity.excludedDuplicatePairKeys.join(', ')}`}
          >
            {integrity.excludedDuplicatePairKeys.length} duplicate key(s) excluded · A{' '}
            {integrity.excludedRowsA} rows · B {integrity.excludedRowsB} rows
          </span>
        ) : null}
        {integrity.missingPairKeyRowsA > 0 || integrity.missingPairKeyRowsB > 0 ? (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">
            missing pair identity · A {integrity.missingPairKeyRowsA} · B{' '}
            {integrity.missingPairKeyRowsB}
          </span>
        ) : null}
        {integrity.unmatchedUniqueA > 0 || integrity.unmatchedUniqueB > 0 ? (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">
            unmatched unique · A {integrity.unmatchedUniqueA} · B {integrity.unmatchedUniqueB}
          </span>
        ) : null}
        <span className="ml-auto font-mono">
          {interval.delta === null
            ? 'paired Δ unavailable · n=0 comparable'
            : `paired Δ ${(interval.delta * 100).toFixed(1)} pp · n=${interval.n}`}
          {interval.delta === null || interval.low === null || interval.high === null
            ? ''
            : ` · approx. 95% CI ${(interval.low * 100).toFixed(1)} to ${(interval.high * 100).toFixed(1)}`}
        </span>
      </summary>
      <div className="max-h-64 overflow-auto border-t border-slate-100">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2">Scenario</th>
              <th>Seed</th>
              <th>A</th>
              <th>B</th>
              <th>Delta</th>
              <th>Failed-check change</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair) => (
              <tr key={pair.key} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-mono">
                  <Link
                    className="text-blue-700 hover:underline"
                    to={pairedTraceHref(
                      runA,
                      runB,
                      pair.scenarioId,
                      pair.a.traceUid,
                      pair.b.traceUid,
                    )}
                  >
                    {pair.scenarioId}
                  </Link>
                </td>
                <td>{pair.seed}</td>
                <td>{pair.a.outcome}</td>
                <td>{pair.b.outcome}</td>
                <td
                  className={
                    pair.delta === 'improvement'
                      ? 'text-emerald-700'
                      : pair.delta === 'regression'
                        ? 'text-red-700'
                        : 'text-slate-500'
                  }
                >
                  {pair.delta}
                </td>
                <td>
                  {pair.a.failedChecks.join(', ') || '—'} → {pair.b.failedChecks.join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
