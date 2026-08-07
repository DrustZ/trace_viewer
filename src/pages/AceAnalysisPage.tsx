import { encodeFilterSet } from '@shared/filter/parse'
import type { FilterCondition } from '@shared/filter/types'
import type { AceBreakdownItem, AceDashboardScope, AceDashboardSummary } from '@shared/schema/ace'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAceAnalysis, useAceDashboard } from '../api/ace'
import { ReliabilityCurves } from '../components/ace/AceDashboard'
import { EmptyState, LoadingState } from '../components/common/EmptyState'
import { formatNumber, formatPercent } from '../components/common/format'
import { AcePairedComparison } from '../components/compare/AcePairedComparison'

export function aceAnalysisRunIds(params: URLSearchParams): string[] {
  return [...new Set(params.getAll('runId').filter((value) => value !== ''))]
}

export function aceAnalysisSearchParams(runIds: readonly string[]): URLSearchParams {
  const result = new URLSearchParams()
  for (const runId of [...new Set(runIds)].sort()) result.append('runId', runId)
  return result
}

export function aceAnalysisTriageOffset(params: URLSearchParams): number {
  const raw = params.get('triageOffset')
  if (raw === null || !/^\d+$/.test(raw)) return 0
  const offset = Number(raw)
  return Number.isSafeInteger(offset) ? offset : 0
}

function aceAnalysisPageHref(runIds: readonly string[], triageOffset: number): string {
  const params = aceAnalysisSearchParams(runIds)
  if (triageOffset > 0) params.set('triageOffset', String(triageOffset))
  const query = params.toString()
  return query ? `/ace/analysis?${query}` : '/ace/analysis'
}

/** Empty selection is the canonical URL representation for “all ACE runs”. */
export function toggleAceAnalysisRun(
  selectedRunIds: readonly string[],
  availableRunIds: readonly string[],
  toggledRunId: string,
  defaultRunIds: readonly string[] = availableRunIds,
): string[] {
  const current = selectedRunIds.length === 0 ? new Set(defaultRunIds) : new Set(selectedRunIds)
  if (current.has(toggledRunId)) current.delete(toggledRunId)
  else current.add(toggledRunId)
  const next = [...current].sort()
  return next.length === defaultRunIds.length && defaultRunIds.every((id) => current.has(id))
    ? []
    : next
}

function traceListHref(
  scope: AceDashboardScope,
  key: string,
  value: string,
  operation: 'eq' | 'contains' = 'contains',
): string {
  const conditions: FilterCondition[] = [
    { key: 'corpus', op: 'in', value: ['production', 'simulation'] },
  ]
  // Always pin the effective run set. In default mode this prevents an
  // exploratory debug/counterfactual run from leaking back into a clicked
  // formal breakdown on the generic trace table.
  conditions.push({ key: 'run', op: 'in', value: scope.selectedRunIds })
  conditions.push({ key, op: operation, value })
  return `/?filters=${encodeURIComponent(encodeFilterSet({ conditions }))}`
}

const TONES = {
  slate: 'border-slate-200 bg-white text-slate-900',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  red: 'border-red-200 bg-red-50 text-red-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
} as const

function Metric({
  label,
  value,
  detail,
  tone = 'slate',
}: {
  label: string
  value: string
  detail?: string
  tone?: keyof typeof TONES
}) {
  return (
    <div className={`rounded-lg border p-3 ${TONES[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-60">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {detail ? <div className="mt-1 text-[11px] opacity-65">{detail}</div> : null}
    </div>
  )
}

function Breakdown({
  title,
  items,
  scope,
  filterKey,
  filterValue = (value) => value,
  operation,
}: {
  title: string
  items: AceBreakdownItem[]
  scope: AceDashboardScope
  filterKey: string
  filterValue?: (value: string) => string
  operation?: 'eq' | 'contains'
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h2 className="text-xs font-semibold text-slate-800">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">No findings in this run scope.</p>
      ) : (
        <div className="mt-2 flex max-h-40 flex-wrap content-start gap-1.5 overflow-auto">
          {items.map((item) => (
            <Link
              key={item.code}
              to={traceListHref(scope, filterKey, filterValue(item.code), operation)}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            >
              {item.code} <span className="font-semibold tabular-nums">{item.count}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

export function AceAnalysisReport({ dashboard }: { dashboard: AceDashboardSummary }) {
  const graded = dashboard.pass + dashboard.fail
  const breakdowns: Array<{
    title: string
    items: AceBreakdownItem[]
    filterKey: string
    operation?: 'eq' | 'contains'
    filterValue?: (value: string) => string
  }> = [
    {
      title: 'Failed grading checks',
      items: dashboard.failureChecks,
      filterKey: 'failureCode',
      filterValue: (value) => `grade.${value.toLowerCase()}`,
    },
    { title: 'Failure origins', items: dashboard.failureOrigins, filterKey: 'failureOrigin' },
    { title: 'Failure codes', items: dashboard.failureCodes, filterKey: 'failureCode' },
    { title: 'Detector tiers', items: dashboard.detectorTiers, filterKey: 'detectorTier' },
    {
      title: 'Detector families',
      items: dashboard.detectorFamilies,
      filterKey: 'detectorFamily',
    },
    { title: 'Tool errors', items: dashboard.toolErrors, filterKey: 'failureCode' },
    {
      title: 'Termination reasons',
      items: dashboard.terminations,
      filterKey: 'termination',
      operation: 'eq',
    },
    { title: 'Issues', items: dashboard.issues, filterKey: 'issue', operation: 'contains' },
    {
      title: 'Languages',
      items: dashboard.languages,
      filterKey: 'language',
      operation: 'eq',
    },
    { title: 'Prompts', items: dashboard.prompts, filterKey: 'prompt', operation: 'eq' },
    {
      title: 'Transports',
      items: dashboard.transports,
      filterKey: 'transport',
      operation: 'eq',
    },
  ]
  const triageStart = dashboard.triage.length > 0 ? dashboard.triageOffset + 1 : 0
  const triageEnd = dashboard.triageOffset + dashboard.triage.length
  const previousTriageOffset = Math.max(0, dashboard.triageOffset - dashboard.triageLimit)
  const nextTriageOffset = dashboard.triageOffset + dashboard.triageLimit

  return (
    <div className="space-y-4">
      <section>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Metric label="ACE traces" value={formatNumber(dashboard.total)} />
          <Metric label="Pass" value={formatNumber(dashboard.pass)} tone="green" />
          <Metric label="Grader fail" value={formatNumber(dashboard.fail)} tone="red" />
          <Metric label="Invalid user sim" value={formatNumber(dashboard.invalid)} tone="amber" />
          <Metric
            label="Runtime error"
            value={formatNumber(dashboard.runtimeError)}
            tone="violet"
          />
          <Metric label="Ungraded" value={formatNumber(dashboard.ungraded)} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          <Metric
            label="Pass rate"
            value={formatPercent(dashboard.passRateExecuted)}
            detail={`${dashboard.pass} / ${graded} executed`}
            tone="green"
          />
          <Metric
            label="Episode validity"
            value={formatPercent(dashboard.userSimEpisodeValidityRate)}
            detail={`${dashboard.userSimValidEpisodes} / ${dashboard.userSimEpisodeDenominator} loaded graded/void episode traces`}
          />
          <Metric
            label="Attempt validity"
            value={formatPercent(dashboard.userSimAttemptValidityRate)}
            detail={
              dashboard.userSimAttemptRunCount > 0
                ? `${dashboard.userSimValidAttempts} / ${dashboard.userSimAttempts} recorded attempts across ${dashboard.userSimAttemptRunCount} run(s)`
                : 'No selected batch reports complete attempt counters'
            }
          />
          <Metric
            label="Required escalation hit"
            value={formatPercent(dashboard.escalation.requiredHitRate)}
            detail={`${dashboard.escalation.requiredObserved} / ${dashboard.escalation.requiredDenominator} required opportunities`}
          />
          <Metric
            label="Unnecessary escalation rate"
            value={formatPercent(dashboard.escalation.unnecessaryEscalationRate)}
            detail={`${dashboard.escalation.notRequiredObserved} / ${dashboard.escalation.notRequiredDenominator} not-required opportunities`}
            tone="amber"
          />
        </div>
        <div className="mt-2">
          <ReliabilityCurves reliability={dashboard.reliability} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-6">
          <Metric
            label="Formal scheduled"
            value={formatNumber(dashboard.formalScheduledEpisodes)}
            detail="uncontaminated scored simulation runs"
          />
          <Metric
            label="In-scope scheduled"
            value={formatNumber(dashboard.scheduledEpisodes)}
            detail="includes explicitly selected exploratory/production runs"
          />
          <Metric label="Terminal" value={formatNumber(dashboard.terminalEpisodes)} />
          <Metric
            label="In progress"
            value={formatNumber(dashboard.inProgressEpisodes)}
            tone={dashboard.inProgressEpisodes > 0 ? 'violet' : 'slate'}
          />
          <Metric
            label="Awaiting ingest"
            value={formatNumber(dashboard.awaitingTraceIngest)}
            detail="terminal manifest units without a loaded trace"
            tone={dashboard.awaitingTraceIngest > 0 ? 'amber' : 'slate'}
          />
          <Metric
            label="Recorded cost"
            value={dashboard.totalCostUsd === null ? '—' : `$${dashboard.totalCostUsd.toFixed(2)}`}
            detail={`${dashboard.costRunCount} selected run(s) report cost`}
          />
        </div>
      </section>

      <section className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {breakdowns.map((item) => (
          <Breakdown key={item.title} scope={dashboard.scope} {...item} />
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <h2 className="text-xs font-semibold text-slate-800">
            High-confidence triage & judge disagreements
          </h2>
          <span className="ml-auto text-[11px] tabular-nums text-slate-400">
            {dashboard.triageTruncated
              ? `showing ${triageStart}–${triageEnd} of ${dashboard.triageTotal} traces`
              : `${dashboard.triageTotal} traces`}
          </span>
          {dashboard.triageHasPrevious ? (
            <Link
              to={aceAnalysisPageHref(dashboard.scope.requestedRunIds, previousTriageOffset)}
              className="rounded border border-slate-200 px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-50"
            >
              ← Previous
            </Link>
          ) : null}
          {dashboard.triageHasNext ? (
            <Link
              to={aceAnalysisPageHref(dashboard.scope.requestedRunIds, nextTriageOffset)}
              className="rounded border border-slate-200 px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-50"
            >
              Next →
            </Link>
          ) : null}
        </header>
        {dashboard.triage.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-400">
            No high-confidence triage items in this run scope.
          </p>
        ) : (
          <div className="max-h-96 divide-y divide-slate-100 overflow-auto">
            {dashboard.triage.map((item) => (
              <Link
                key={item.traceUid}
                to={`/trace/${encodeURIComponent(item.traceUid)}?tab=evaluation`}
                className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2 text-xs hover:bg-slate-50 sm:grid-cols-[5rem_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,2fr)]"
              >
                <span className="font-semibold uppercase text-red-700">{item.severity}</span>
                <span className="truncate font-mono text-blue-700">{item.sourceTraceId}</span>
                <span className="truncate text-slate-500">{item.runId}</span>
                <span className="truncate text-slate-600">
                  {item.codes.join(', ') || 'judge disagreement'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default function AceAnalysisPage() {
  const [search, setSearch] = useSearchParams()
  const selectedRunIds = aceAnalysisRunIds(search)
  const triageOffset = aceAnalysisTriageOffset(search)
  const dashboard = useAceDashboard(selectedRunIds, { triageOffset })
  const detectorAnalysis = useAceAnalysis()
  const availableRunIds = dashboard.data?.scope.availableRuns.map((run) => run.runId) ?? []
  const effectiveRunIds = dashboard.data?.scope.selectedRunIds ?? selectedRunIds
  const defaultRunIds = dashboard.data?.scope.defaultRunIds ?? []
  const allMode = selectedRunIds.length === 0
  const [runSearch, setRunSearch] = useState('')
  const visibleRuns = useMemo(() => {
    const query = runSearch.trim().toLowerCase()
    const runs = dashboard.data?.scope.availableRuns ?? []
    return query
      ? runs.filter((run) =>
          [run.runId, run.runKind, run.lifecycle].some((value) =>
            value.toLowerCase().includes(query),
          ),
        )
      : runs
  }, [dashboard.data?.scope.availableRuns, runSearch])

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-4">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <Link to="/" className="text-xs text-blue-600 hover:underline">
            ← Traces
          </Link>
          <Link to="/ace" className="text-xs text-blue-600 hover:underline">
            ACE runs
          </Link>
          <Link to="/ace/tasks" className="text-xs text-blue-600 hover:underline">
            Task explorer
          </Link>
          <h1 className="text-base font-semibold text-slate-900">ACE aggregate analysis</h1>
          <span className="ml-auto text-[11px] text-slate-500">
            {allMode
              ? `${effectiveRunIds.length} formal/production runs`
              : `${selectedRunIds.length} requested runs`}
          </span>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <h2 className="text-xs font-semibold text-slate-800">Run scope</h2>
              <p className="text-[11px] text-slate-500">
                Default scope is formal scored + production only. Select one batch or combine exact
                run IDs; debug/counterfactual runs remain available but never leak into the default.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSearch(new URLSearchParams())}
              className={`ml-auto rounded border px-2 py-1 text-xs ${
                allMode
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Formal default
            </button>
          </div>
          <input
            type="search"
            value={runSearch}
            onChange={(event) => setRunSearch(event.target.value)}
            placeholder="Filter run IDs, kind, or lifecycle…"
            className="mt-3 w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {visibleRuns.map((run) => {
              const checked = effectiveRunIds.includes(run.runId)
              return (
                <div
                  key={run.runId}
                  className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                    checked
                      ? 'border-blue-300 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSearch(
                          aceAnalysisSearchParams(
                            toggleAceAnalysisRun(
                              effectiveRunIds,
                              availableRunIds,
                              run.runId,
                              defaultRunIds,
                            ),
                          ),
                        )
                      }
                    />
                    <span className="font-mono">{run.runId}</span>
                  </label>
                  <span className="rounded bg-white/70 px-1 text-[9px] uppercase opacity-70">
                    {run.runKind}
                  </span>
                  <span className="text-[10px] opacity-60">
                    {run.traces}/{run.scheduledEpisodes}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSearch(aceAnalysisSearchParams([run.runId]))}
                    className="rounded px-1 text-[10px] text-blue-700 hover:bg-white"
                  >
                    only
                  </button>
                </div>
              )
            })}
          </div>
          {dashboard.data?.scope.unmatchedRunIds.length ? (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
              No current traces for: {dashboard.data.scope.unmatchedRunIds.join(', ')}
            </p>
          ) : null}
        </section>

        {dashboard.isLoading ? (
          <LoadingState label="Loading ACE aggregate…" />
        ) : dashboard.error ? (
          <EmptyState
            title="Aggregate unavailable"
            hint={
              dashboard.error instanceof Error ? dashboard.error.message : String(dashboard.error)
            }
          />
        ) : dashboard.data ? (
          <>
            <AceAnalysisReport dashboard={dashboard.data} />
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <header className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800">
                Per-run comparison
              </header>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Run</th>
                      <th>Kind / lifecycle</th>
                      <th>Loaded / scheduled</th>
                      <th>Pass / fail</th>
                      <th>Invalid / runtime</th>
                      <th>Pass rate</th>
                      <th>Progress</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.data.scope.availableRuns
                      .filter((run) => effectiveRunIds.includes(run.runId))
                      .map((run) => (
                        <tr key={run.runId} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-mono">
                            <Link
                              className="text-blue-700 hover:underline"
                              to={`/ace?run=${encodeURIComponent(run.runId)}`}
                            >
                              {run.runId}
                            </Link>
                          </td>
                          <td>
                            {run.runKind} · {run.lifecycle}
                          </td>
                          <td>
                            {run.traces} / {run.scheduledEpisodes}
                          </td>
                          <td>
                            {run.pass} / {run.fail}
                          </td>
                          <td>
                            {run.invalid} / {run.runtimeError}
                          </td>
                          <td>{formatPercent(run.passRateExecuted)}</td>
                          <td>
                            {run.inProgressEpisodes} active · {run.awaitingTraceIngest} awaiting
                          </td>
                          <td>{run.costUsd === null ? '—' : `$${run.costUsd.toFixed(2)}`}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
            {effectiveRunIds.length === 2 ? (
              <AcePairedComparison runA={effectiveRunIds[0]} runB={effectiveRunIds[1]} />
            ) : null}
          </>
        ) : null}

        <footer className="text-[11px] text-slate-500">
          {detectorAnalysis.data ? (
            <>
              Canonical Python detector registry applied to {detectorAnalysis.data.appliedTraces}{' '}
              production traces · {String(detectorAnalysis.data.source.detector_count ?? '—')}{' '}
              detectors · {String(detectorAnalysis.data.aggregates.failures ?? '—')} findings
            </>
          ) : detectorAnalysis.isLoading ? (
            'Applying canonical production detectors…'
          ) : detectorAnalysis.error ? (
            'Canonical detector overlay is unavailable; grade/runtime aggregates remain visible.'
          ) : null}
        </footer>
      </div>
    </main>
  )
}
