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

export function classifyAcePair(a: AceBatchEpisode, b: AceBatchEpisode): AcePairDelta {
  if (!['pass', 'fail'].includes(a.outcome) || !['pass', 'fail'].includes(b.outcome)) {
    return 'not_comparable'
  }
  if (a.outcome !== 'pass' && b.outcome === 'pass') return 'improvement'
  if (a.outcome === 'pass' && b.outcome !== 'pass') return 'regression'
  return 'tie'
}

export function pairAceRuns(a: AceBatchEpisode[], b: AceBatchEpisode[]): AceEpisodePair[] {
  const right = new Map(b.map((row) => [row.pairKey, row]))
  return a.flatMap((left) => {
    const match = right.get(left.pairKey)
    return match
      ? [
          {
            key: left.pairKey,
            scenarioId: left.scenarioId,
            seed: left.environmentSeed,
            a: left,
            b: match,
            delta: classifyAcePair(left, match),
          },
        ]
      : []
  })
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
  delta: number
  low: number | null
  high: number | null
} {
  if (pairs.length === 0) return { delta: 0, low: null, high: null }
  const eligible = pairs.filter((pair) => pair.delta !== 'not_comparable')
  if (eligible.length === 0) return { delta: 0, low: null, high: null }
  const differences: number[] = eligible.map((pair) =>
    pair.delta === 'improvement' ? 1 : pair.delta === 'regression' ? -1 : 0,
  )
  const delta = differences.reduce((sum, value) => sum + value, 0) / differences.length
  if (differences.length < 2) return { delta, low: null, high: null }
  const variance =
    differences.reduce((sum, value) => sum + (value - delta) ** 2, 0) / (differences.length - 1)
  const margin = 1.96 * Math.sqrt(variance / differences.length)
  return { delta, low: Math.max(-1, delta - margin), high: Math.min(1, delta + margin) }
}

export function AcePairedComparison({ runA, runB }: { runA: string; runB: string }) {
  const a = useAceRun(runA)
  const b = useAceRun(runB)
  const pairs = useMemo(
    () => pairAceRuns(a.data?.episodes ?? [], b.data?.episodes ?? []),
    [a.data, b.data],
  )
  if (a.isError || b.isError) return null
  if (a.isLoading || b.isLoading) {
    return (
      <p className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-500">
        Loading matched units…
      </p>
    )
  }
  if (pairs.length === 0) {
    return (
      <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        No matched units. Paired analysis requires the same schedule digest, scenario ID, and
        environment seed; use the unpaired per-run table above for unrelated batches.
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
            {notComparable} excluded (invalid/runtime/pending)
          </span>
        ) : null}
        <span className="ml-auto font-mono">
          paired Δ {(interval.delta * 100).toFixed(1)} pp
          {interval.low === null || interval.high === null
            ? ''
            : ` · 95% CI ${(interval.low * 100).toFixed(1)} to ${(interval.high * 100).toFixed(1)}`}
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
