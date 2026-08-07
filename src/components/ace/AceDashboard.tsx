import { encodeFilterSet } from '@shared/filter/parse'
import type { FilterCondition } from '@shared/filter/types'
import type {
  AceBatchSummary,
  AceBreakdownItem,
  AceDashboardScope,
  AceReliabilitySummary,
} from '@shared/schema/ace'
import { Link } from 'react-router-dom'
import { useAceAnalysis, useAceDashboard, useAceRuns } from '../../api/ace'
import { formatNumber, formatPercent } from '../common/format'
import { CollapsibleSection } from '../home/CollapsibleSection'

const METRIC_TONE = {
  slate: 'border-slate-200 bg-slate-50 text-slate-800 [&>div:first-child]:text-slate-500',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800 [&>div:first-child]:text-emerald-600',
  red: 'border-red-200 bg-red-50 text-red-800 [&>div:first-child]:text-red-600',
  amber: 'border-amber-200 bg-amber-50 text-amber-800 [&>div:first-child]:text-amber-600',
  violet: 'border-violet-200 bg-violet-50 text-violet-800 [&>div:first-child]:text-violet-600',
} as const

function Metric({
  label,
  value,
  tone = 'slate',
  detail,
}: {
  label: string
  value: string
  tone?: keyof typeof METRIC_TONE
  detail?: string
}) {
  return (
    <div className={`rounded-md border px-3 py-2 ${METRIC_TONE[tone]}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {detail ? <div className="mt-0.5 text-[10px] opacity-65">{detail}</div> : null}
    </div>
  )
}

export function ReliabilityCurves({ reliability }: { reliability: AceReliabilitySummary }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Formal reliability curves
        </div>
        <div className="text-[10px] text-slate-400">
          per-scenario C(successes,k) / C(trials,k), then macro-averaged
        </div>
      </div>
      {reliability.cells.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">No pair-keyed formal simulation cells.</p>
      ) : (
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          {reliability.cells.map((cell) => {
            const excluded = Object.values(cell.exclusions).reduce((sum, count) => sum + count, 0)
            return (
              <div
                key={`${cell.runId}:${cell.configDigest ?? 'unknown'}`}
                className="rounded border border-slate-100 bg-slate-50 p-2"
              >
                <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                  <span className="font-mono font-semibold text-slate-700">{cell.runId}</span>
                  <span className="font-mono text-[9px] text-slate-400">
                    config {cell.configDigest?.slice(0, 12) ?? 'unrecorded'}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {cell.curve.length > 0 ? (
                    cell.curve.map((point) => (
                      <span
                        key={point.k}
                        className="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-800"
                        title={`Macro-average denominator: ${point.scenarioDenominator} scenarios`}
                      >
                        Pass^{point.k} {formatPercent(point.value)}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-slate-400">No valid graded trials</span>
                  )}
                </div>
                <div className="mt-1 text-[9px] text-slate-500">
                  {cell.coverage.validTrialCount} unique trials ·{' '}
                  {cell.coverage.scenarioDenominator} scenario denominator ·{' '}
                  {cell.coverage.minTrialsPerScenario}–{cell.coverage.maxTrialsPerScenario} trials
                  /scenario · {excluded} excluded
                </div>
                <div className="mt-0.5 text-[9px] text-slate-400">
                  exclusions: invalid {cell.exclusions.invalid} · runtime{' '}
                  {cell.exclusions.runtimeError} · ungraded {cell.exclusions.ungraded} · missing
                  pair {cell.exclusions.missingPairKey} · duplicate-key rows{' '}
                  {cell.exclusions.duplicatePair}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {reliability.excludedNonFormalTraceCount > 0 ? (
        <p className="mt-2 text-[9px] text-slate-400">
          {reliability.excludedNonFormalTraceCount} production/exploratory trace(s) excluded from
          formal reliability.
        </p>
      ) : null}
    </div>
  )
}

function RunCard({ run }: { run: AceBatchSummary }) {
  const { totals } = run
  return (
    <Link
      to={`/ace?run=${encodeURIComponent(run.runId)}`}
      className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 hover:shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-mono text-sm font-semibold text-slate-800">{run.runId}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600">
          {run.runKind} · {run.lifecycle}
        </span>
        <span className="ml-auto text-xs text-slate-400">
          {String(run.spec.prompt ?? '—')} · {String(run.spec.transport ?? '—')}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
        <div>
          <b className="text-emerald-700">{totals.passed}</b>
          <br />
          <span className="text-slate-400">pass</span>
        </div>
        <div>
          <b className="text-red-700">{totals.failedGrade}</b>
          <br />
          <span className="text-slate-400">fail</span>
        </div>
        <div>
          <b className="text-amber-700">{totals.invalidUserSim}</b>
          <br />
          <span className="text-slate-400">invalid</span>
        </div>
        <div>
          <b className="text-violet-700">{totals.runtimeErrors}</b>
          <br />
          <span className="text-slate-400">runtime</span>
        </div>
      </div>
      {run.failureChecks.length > 0 && (
        <div className="mt-2 truncate text-[11px] text-slate-500">
          failures:{' '}
          {run.failureChecks
            .slice(0, 3)
            .map((item) => `${item.code} ${item.count}`)
            .join(' · ')}
          {run.failureChecks.length > 3 ? ` · +${run.failureChecks.length - 3} more` : ''}
        </div>
      )}
    </Link>
  )
}

function filterUrl(
  scope: AceDashboardScope,
  key: string,
  value: string,
  op: 'eq' | 'contains' = 'contains',
): string {
  const conditions: FilterCondition[] = [
    { key: 'corpus', op: 'in', value: ['production', 'simulation'] },
    { key: 'run', op: 'in', value: scope.selectedRunIds },
    { key, op, value },
  ]
  const filters = encodeFilterSet({ conditions })
  return `/?filters=${encodeURIComponent(filters)}`
}

function Breakdown({
  title,
  items,
  filterKey,
  scope,
  operation,
}: {
  title: string
  items: AceBreakdownItem[]
  filterKey: string
  scope: AceDashboardScope
  operation?: 'eq' | 'contains'
}) {
  if (items.length === 0) return null
  const visibleItems = items.slice(0, 8)
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[10px] uppercase tracking-wide text-slate-400">
        <span className="font-medium">{title}</span>
        <span className="normal-case tabular-nums">
          showing {visibleItems.length} of {items.length}
        </span>
        {visibleItems.length < items.length ? (
          <Link to="/ace/analysis" className="normal-case text-blue-600 hover:underline">
            view all
          </Link>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {visibleItems.map((item) => (
          <Link
            key={item.code}
            to={filterUrl(scope, filterKey, item.code, operation)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-blue-300 hover:text-blue-700"
          >
            {item.code} · {item.count}
          </Link>
        ))}
      </div>
    </div>
  )
}

export function AceDashboard() {
  const query = useAceRuns()
  const dashboard = useAceDashboard()
  const detectorAnalysis = useAceAnalysis()
  if (query.isLoading && dashboard.isLoading) {
    return null
  }
  const runs = query.data?.items ?? []
  const aggregate = dashboard.data
  if (runs.length === 0 && (!aggregate || aggregate.total === 0)) return null
  const formalEpisodes =
    aggregate?.formalScheduledEpisodes ??
    runs
      .filter((run) => run.runKind === 'scored')
      .reduce((sum, run) => sum + run.totals.episodes, 0)
  const passed = aggregate?.pass ?? runs.reduce((sum, run) => sum + run.totals.passed, 0)
  const failed = aggregate?.fail ?? runs.reduce((sum, run) => sum + run.totals.failedGrade, 0)
  const invalid =
    aggregate?.invalid ?? runs.reduce((sum, run) => sum + run.totals.invalidUserSim, 0)
  const runtime =
    aggregate?.runtimeError ?? runs.reduce((sum, run) => sum + run.totals.runtimeErrors, 0)
  const graded = aggregate?.executed ?? passed + failed
  const recordedCosts = runs
    .map((run) => run.totals.costUsd)
    .filter((cost): cost is number => cost !== null)
  const totalCost =
    aggregate?.totalCostUsd ??
    (recordedCosts.length > 0 ? recordedCosts.reduce((sum, cost) => sum + cost, 0) : null)

  return (
    <CollapsibleSection id="ace-cockpit" title="ACE evaluation cockpit" defaultOpen>
      <div className="space-y-3 p-3">
        {aggregate?.detectorAnalysisAvailable === false && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Detector analysis is unavailable (analysis bridge failed or did not stabilize).
            Detector tiers/families below reflect missing data, not zero findings.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Metric
            label="Scheduled (formal)"
            value={formatNumber(formalEpisodes)}
            detail={
              aggregate
                ? `${aggregate.scheduledEpisodes} scheduled episode(s) in selected scope`
                : 'Scored simulation runs only'
            }
          />
          <Metric
            label="Pass rate"
            value={formatPercent(graded ? passed / graded : null)}
            tone="emerald"
          />
          <Metric label="Grader fail" value={formatNumber(failed)} tone="red" />
          <Metric label="Invalid user" value={formatNumber(invalid)} tone="amber" />
          <Metric label="Runtime error" value={formatNumber(runtime)} tone="violet" />
          <Metric
            label="Recorded cost"
            value={totalCost === null ? '—' : `$${totalCost.toFixed(2)}`}
          />
        </div>
        {aggregate && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric
              label="Episode validity"
              value={formatPercent(aggregate.userSimEpisodeValidityRate)}
              detail={`${aggregate.userSimValidEpisodes} / ${aggregate.userSimEpisodeDenominator} loaded graded/void episode traces`}
            />
            <Metric
              label="Attempt validity"
              value={formatPercent(aggregate.userSimAttemptValidityRate)}
              detail={
                aggregate.userSimAttemptRunCount > 0
                  ? `${aggregate.userSimValidAttempts} / ${aggregate.userSimAttempts} recorded attempts`
                  : 'No batch attempt counters'
              }
            />
            <Metric
              label="Required escalation hit"
              value={formatPercent(aggregate.escalation.requiredHitRate)}
              detail={`${aggregate.escalation.requiredObserved} / ${aggregate.escalation.requiredDenominator} required opportunities`}
            />
            <Metric
              label="Unnecessary escalation rate"
              value={formatPercent(aggregate.escalation.unnecessaryEscalationRate)}
              detail={`${aggregate.escalation.notRequiredObserved} / ${aggregate.escalation.notRequiredDenominator} not-required opportunities`}
              tone="amber"
            />
          </div>
        )}
        {aggregate ? <ReliabilityCurves reliability={aggregate.reliability} /> : null}
        {aggregate && (
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-2 lg:grid-cols-3">
            <Breakdown
              title="Failed grading checks"
              items={aggregate.failureChecks}
              filterKey="failureCode"
              scope={aggregate.scope}
            />
            <Breakdown
              title="Failure origins"
              items={aggregate.failureOrigins}
              filterKey="failureOrigin"
              scope={aggregate.scope}
            />
            <Breakdown
              title="Detector tiers"
              items={aggregate.detectorTiers}
              filterKey="detectorTier"
              scope={aggregate.scope}
            />
            <Breakdown
              title="Detector families"
              items={aggregate.detectorFamilies}
              filterKey="detectorFamily"
              scope={aggregate.scope}
            />
            <Breakdown
              title="Tool errors"
              items={aggregate.toolErrors}
              filterKey="failureCode"
              scope={aggregate.scope}
            />
            <Breakdown
              title="Terminations"
              items={aggregate.terminations}
              filterKey="termination"
              scope={aggregate.scope}
            />
            <Breakdown
              title="Issues"
              items={aggregate.issues}
              filterKey="issue"
              scope={aggregate.scope}
            />
            <Breakdown
              title="Languages"
              items={aggregate.languages}
              filterKey="language"
              scope={aggregate.scope}
              operation="eq"
            />
            <Breakdown
              title="Prompts"
              items={aggregate.prompts}
              filterKey="prompt"
              scope={aggregate.scope}
              operation="eq"
            />
            <Breakdown
              title="Transports"
              items={aggregate.transports}
              filterKey="transport"
              scope={aggregate.scope}
              operation="eq"
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
          <span className="font-medium">Runs</span>
          <span className="normal-case tabular-nums">
            showing {Math.min(4, runs.length)} of {runs.length}
          </span>
          <Link to="/ace" className="normal-case text-blue-600 hover:underline">
            view all
          </Link>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          {runs.slice(0, 4).map((run) => (
            <RunCard key={run.runId} run={run} />
          ))}
        </div>
        {aggregate && aggregate.triage.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-700">
              High-confidence triage & judge disagreements · showing{' '}
              {Math.min(20, aggregate.triage.length)}
              {' of '}
              {aggregate.triageTotal}
              <Link
                to="/ace/analysis"
                className="ml-auto whitespace-nowrap text-blue-600 hover:underline"
              >
                view all
              </Link>
            </div>
            <div className="max-h-44 divide-y divide-slate-100 overflow-auto">
              {aggregate.triage.slice(0, 20).map((item) => (
                <Link
                  key={item.traceUid}
                  to={`/trace/${encodeURIComponent(item.traceUid)}?tab=evaluation`}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50"
                >
                  <span className="w-20 shrink-0 font-medium text-red-700">{item.severity}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-slate-700">
                    {item.sourceTraceId}
                  </span>
                  <span className="max-w-[45%] truncate text-slate-500">
                    {item.codes.join(', ') || 'judge disagreement'}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
        {detectorAnalysis.data && (
          <div className="text-[11px] text-slate-500">
            Canonical Python detector registry applied to {detectorAnalysis.data.appliedTraces}{' '}
            production traces
            {' · '}
            {String(detectorAnalysis.data.source.detector_count ?? '—')} detectors
            {' · '}
            {String(detectorAnalysis.data.aggregates.failures ?? '—')} findings
          </div>
        )}
        <div className="flex justify-end gap-3 text-right">
          <Link to="/ace/analysis" className="text-xs font-medium text-blue-600 hover:underline">
            Open aggregate analysis →
          </Link>
          <Link to="/ace" className="text-xs font-medium text-blue-600 hover:underline">
            Open runs, live control, and failure triage →
          </Link>
        </div>
      </div>
    </CollapsibleSection>
  )
}
