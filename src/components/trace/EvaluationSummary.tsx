import type { Trace } from '@shared/schema/types'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { unifiedFailures } from './failureSource'

function verdictClass(outcome: string): string {
  if (outcome === 'pass') return 'bg-emerald-100 text-emerald-800'
  if (outcome === 'fail' || outcome === 'runtime_error') return 'bg-red-100 text-red-800'
  if (outcome === 'invalid') return 'bg-amber-100 text-amber-800'
  return 'bg-slate-100 text-slate-700'
}

/** Compact check row coloring: red = hard gate failed, amber = shadow failed, green = passed. */
export function checkRowTone(check: { gating: boolean; ok: boolean }): string {
  if (check.ok) return 'text-emerald-700'
  return check.gating ? 'text-red-700' : 'text-amber-700'
}

/**
 * Peek-sized evaluation summary for the trace drawer, below the conversation
 * preview and collapsed by default: the one-line header carries the verdict
 * badge and the failed-hard-gate count (with a red dot when any hard gate
 * failed); expanding reveals the per-check table and the jump to the full
 * evaluation tab. The conversation stays the drawer's primary surface.
 */
export function EvaluationSummary({ trace }: { trace: Trace }) {
  const evaluation = trace.evaluation
  const findings = useMemo(() => (evaluation ? unifiedFailures(trace).length : 0), [trace])
  if (!evaluation) return null
  const checks = evaluation.checks
  const failedGating = checks.filter((check) => check.gating && !check.ok).length
  const traceUid = trace.meta.traceUid ?? trace.meta.traceId

  return (
    <details
      data-testid="drawer-evaluation-summary"
      className="shrink-0 border-t border-slate-200 bg-white px-4 py-1.5"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 py-0.5">
        {failedGating > 0 && (
          <span
            data-testid="drawer-evaluation-alert"
            className="h-2 w-2 rounded-full bg-red-500"
            aria-label={`${failedGating} failed hard gates`}
          />
        )}
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${verdictClass(evaluation.outcome)}`}
        >
          {evaluation.outcome.replace('_', ' ')}
        </span>
        <span className="text-[11px] text-slate-500">
          {failedGating} failed hard gates · {findings} findings
        </span>
        <span className="ml-auto text-[10px] text-slate-400">evaluation ▾</span>
      </summary>
      <div className="flex justify-end pt-1">
        <Link
          to={`/trace/${encodeURIComponent(traceUid)}?tab=evaluation`}
          className="text-[11px] font-medium text-violet-700 hover:underline"
        >
          Open full evaluation →
        </Link>
      </div>
      {checks.length > 0 && (
        <table className="mt-1.5 w-full text-left text-[11px]">
          <tbody>
            {checks.map((check) => (
              <tr key={check.name} className="border-t border-slate-100 align-top">
                <td className="py-1 pr-2 font-mono text-slate-800">{check.name}</td>
                <td className="py-1 pr-2">
                  <span
                    className={`rounded px-1 py-0.5 text-[9px] font-medium ${
                      check.gating ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {check.gating ? 'hard gate' : 'shadow'}
                  </span>
                </td>
                <td className={`py-1 pr-2 font-semibold ${checkRowTone(check)}`}>
                  {check.ok ? '✓' : '✕'}
                </td>
                <td className="max-w-0 truncate py-1 text-slate-500" title={check.detail}>
                  {check.detail?.split('\n')[0] ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  )
}
