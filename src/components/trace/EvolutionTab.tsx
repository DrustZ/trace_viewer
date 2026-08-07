import { hasRecordedCheckpoint } from '@shared/schema/provenance'
import type { Trace, TraceSummary } from '@shared/schema/types'
import { type ReactNode, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'
import { ApiError } from '../../api/client'
import { useEvolution, useSiblings } from '../../api/hooks'
import { EmptyState, ErrorState, LoadingState } from '../common/EmptyState'
import { formatDuration, formatNumber, formatPercent, formatScore } from '../common/format'
import { ScoreBadge } from '../common/ScoreBadge'
import { StatusPill } from '../common/StatusPill'

// Categorical slot 1 (blue) from the dataviz reference palette — same series color as
// RewardCurveChart. The current-trace reference dot uses a darker step of the same ramp.
const SERIES_COLOR = '#2a78d6'
const CURRENT_COLOR = '#1c5cab'
// slate-400: individual rollout dots sit visually behind the avg line.
const DOT_COLOR = '#94a3b8'

interface ChartRow {
  step: number
  /** undefined ⇒ no rollout at this step is scored; the line skips the point. */
  avgScore?: number
  min?: number
  max?: number
  /** [min, max] band for the range Area; undefined ⇒ gap. */
  range?: [number, number]
  count: number
}

interface ScatterDatum {
  /**
   * Exact checkpoint step. Keeping data x on-step keeps the axis tooltip ticks clean;
   * the anti-overplot jitter is applied in pixel space by the custom dot shape instead.
   */
  step: number
  score: number
  /** Deterministic per-rollout horizontal offset in px, applied by the dot shape. */
  jitterPx: number
  /** Owning chart row — lets the shared tooltip resolve scatter hovers to step stats. */
  row: ChartRow
}

/** The tooltip payload may lead with a jittered scatter point; follow it back to its row. */
function resolveRow(payload: TooltipContentProps['payload']): ChartRow | undefined {
  for (const entry of payload) {
    const p = entry.payload as ChartRow | ScatterDatum | undefined
    if (!p) continue
    return 'row' in p ? p.row : p
  }
  return undefined
}

/** 'leetcode-i09-s25-r01' → 'r01'; falls back to the full id for foreign formats. */
function rolloutLabel(traceId: string): string {
  const m = /(r\d+)$/i.exec(traceId)
  return m?.[1] ?? traceId
}

function traceAddress(trace: TraceSummary): string {
  return trace.meta.traceUid ?? trace.meta.traceId
}

/** Variant-aware jump: drawer swaps the previewed trace, page navigates keeping the query. */
function TraceLink({
  traceId,
  onNavigate,
  testId,
  className,
  children,
}: {
  traceId: string
  onNavigate?: (traceId: string) => void
  testId: string
  className: string
  children: ReactNode
}) {
  const location = useLocation()
  if (onNavigate) {
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={() => onNavigate(traceId)}
        className={className}
      >
        {children}
      </button>
    )
  }
  return (
    <Link
      to={{ pathname: `/trace/${encodeURIComponent(traceId)}`, search: location.search }}
      data-testid={testId}
      className={className}
    >
      {children}
    </Link>
  )
}

function EvolutionTooltip({ active, payload }: TooltipContentProps) {
  if (!active || payload.length === 0) return null
  const row = resolveRow(payload)
  if (!row) return null
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
      <div className="font-medium text-slate-700">step {row.step}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span
          className="inline-block h-0.5 w-3 rounded-full"
          style={{ backgroundColor: SERIES_COLOR }}
        />
        <span className="font-semibold tabular-nums text-slate-900">
          {formatScore(row.avgScore)}
        </span>
        <span className="text-slate-400">avg · n={row.count}</span>
      </div>
      {row.min !== undefined && row.max !== undefined && (
        <div className="mt-0.5 tabular-nums text-slate-400">
          min {formatScore(row.min)} · max {formatScore(row.max)}
        </div>
      )}
    </div>
  )
}

function RolloutRow({
  rollout,
  currentTraceId,
  onNavigate,
}: {
  rollout: TraceSummary
  currentTraceId: string
  onNavigate?: (traceId: string) => void
}) {
  const { meta, stats } = rollout
  const traceUid = traceAddress(rollout)
  const isCurrent = traceUid === currentTraceId
  const body = (
    <>
      <span className="truncate font-mono text-sm text-slate-800">{meta.traceId}</span>
      <ScoreBadge score={stats.score} />
      <StatusPill status={meta.status} />
      <span className="text-xs text-slate-500">
        {formatNumber(stats.turns)} turns · {formatNumber(stats.totalTokens)} tokens ·{' '}
        {formatDuration(stats.durationMs)}
      </span>
      {meta.rewardDetails &&
        Object.entries(meta.rewardDetails).map(([key, value]) => (
          <span
            key={key}
            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500"
          >
            {key}: {value}
          </span>
        ))}
      {isCurrent && (
        <span className="ml-auto rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
          current
        </span>
      )}
    </>
  )
  const base = 'flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-left'
  if (isCurrent) {
    return (
      <li
        data-testid={`evolution-rollout-${meta.traceId}`}
        aria-current="true"
        className={`${base} border-blue-300 bg-blue-50/50`}
      >
        {body}
      </li>
    )
  }
  return (
    <li>
      <TraceLink
        traceId={traceUid}
        onNavigate={onNavigate}
        testId={`evolution-rollout-${meta.traceId}`}
        className={`${base} border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50`}
      >
        {body}
      </TraceLink>
    </li>
  )
}

/**
 * Instance evolution: avg-score-vs-checkpoint curve for this trace's instance, the
 * rollouts at a selected step, and a same-step siblings strip for quick jumps.
 */
interface EvolutionTabProps {
  trace: Trace
  /** Drawer only: jump to another rollout in place instead of navigating. */
  onNavigate?: (traceId: string) => void
}

export function EvolutionTab(props: EvolutionTabProps) {
  if (!hasRecordedCheckpoint(props.trace.meta)) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6" data-testid="evolution-empty">
        <EmptyState
          title="Checkpoint unavailable"
          hint="The source trace did not record a checkpoint, so checkpoint evolution and same-step siblings cannot be computed."
        />
      </div>
    )
  }
  return <RecordedCheckpointEvolutionTab {...props} />
}

function RecordedCheckpointEvolutionTab({ trace, onNavigate }: EvolutionTabProps) {
  const { traceId, instanceId, checkpointStep } = trace.meta
  const traceUid = trace.meta.traceUid ?? traceId
  const evolution = useEvolution(
    instanceId,
    trace.meta.runId ??
      (typeof trace.meta.extra?.run === 'string' ? trace.meta.extra.run : 'run-a'),
  )
  const siblings = useSiblings(traceUid)
  // Tagging the selection with its trace lets a stale selection from a previous trace
  // fall back to the new trace's own checkpoint without an effect.
  const [selection, setSelection] = useState<{ traceId: string; step: number } | null>(null)
  const selectedStep = selection?.traceId === traceUid ? selection.step : checkpointStep

  const rows = useMemo<ChartRow[]>(
    () =>
      (evolution.data?.points ?? []).map((p) => {
        const scores = p.rollouts.map((r) => r.stats.score).filter((s): s is number => s !== null)
        const min = scores.length > 0 ? Math.min(...scores) : undefined
        const max = scores.length > 0 ? Math.max(...scores) : undefined
        return {
          step: p.step,
          avgScore: p.avgScore ?? undefined,
          min,
          max,
          range:
            min !== undefined && max !== undefined ? ([min, max] as [number, number]) : undefined,
          count: p.rollouts.length,
        }
      }),
    [evolution.data],
  )

  // One dot per scored rollout, fanned out around its step by a deterministic
  // per-index pixel offset (avoids overplotting without polluting the x-axis ticks).
  const scatterPoints = useMemo<ScatterDatum[]>(() => {
    const points = evolution.data?.points ?? []
    const rowByStep = new Map(rows.map((r) => [r.step, r]))
    const out: ScatterDatum[] = []
    for (const p of points) {
      const row = rowByStep.get(p.step)
      if (!row) continue
      const n = p.rollouts.length
      const spreadPx = Math.min(26, (n - 1) * 6)
      p.rollouts.forEach((rollout, i) => {
        const score = rollout.stats.score
        if (score === null) return
        const jitterPx = n > 1 ? (i / (n - 1) - 0.5) * spreadPx : 0
        out.push({ step: p.step, score, jitterPx, row })
      })
    }
    return out
  }, [evolution.data, rows])

  // Instance-level summary over every rollout in the series (all checkpoints).
  const summary = useMemo(() => {
    const all = (evolution.data?.points ?? []).flatMap((p) => p.rollouts)
    const scores = all.map((r) => r.stats.score).filter((s): s is number => s !== null)
    const durations = all
      .map((r) => r.stats.durationMs)
      .filter((d): d is number => typeof d === 'number')
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    return {
      count: all.length,
      avg: scores.length > 0 ? mean(scores) : null,
      min: scores.length > 0 ? Math.min(...scores) : null,
      max: scores.length > 0 ? Math.max(...scores) : null,
      successRate: scores.length > 0 ? scores.filter((s) => s > 0).length / scores.length : null,
      avgDurationMs: durations.length > 0 ? mean(durations) : null,
    }
  }, [evolution.data])

  const totalRollouts = summary.count
  const selectedPoint = evolution.data?.points.find((p) => p.step === selectedStep)

  if (evolution.isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <LoadingState label="Loading evolution…" />
      </div>
    )
  }
  if (evolution.isError || !evolution.data) {
    // 404 = the instance is unknown to the evolution index (typical for imports).
    const notFound = evolution.error instanceof ApiError && evolution.error.status === 404
    return (
      <div className="mx-auto max-w-5xl px-4 py-6" data-testid="evolution-empty">
        {notFound ? (
          <EmptyState
            title="No evolution data"
            hint={`This trace's instance (${instanceId}) has no other rollouts (imported traces are single-rollout).`}
          />
        ) : (
          <ErrorState message={`Could not load evolution data for instance '${instanceId}'.`} />
        )}
      </div>
    )
  }

  // A lone imported/one-off rollout has nothing to plot — keep the tiles and the
  // rollout list, but swap the chart for a short note instead of a one-dot plot.
  const singlePoint = rows.length === 1 && totalRollouts === 1

  return (
    <div data-testid="evolution-tab" className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-slate-900">{instanceId}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
          {evolution.data.component}
        </span>
        <span className="text-xs text-slate-500">
          {formatNumber(totalRollouts)} rollouts across {formatNumber(rows.length)} checkpoints
        </span>
      </div>

      <div
        data-testid="evolution-summary"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5"
      >
        {[
          { label: 'Avg reward', value: formatScore(summary.avg) },
          {
            label: 'Min – Max',
            value:
              summary.min !== null && summary.max !== null
                ? `${formatScore(summary.min)} – ${formatScore(summary.max)}`
                : '—',
          },
          { label: 'Success rate', value: formatPercent(summary.successRate) },
          { label: 'Rollouts', value: formatNumber(summary.count) },
          { label: 'Avg duration', value: formatDuration(summary.avgDurationMs) },
        ].map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg border border-emerald-200/70 bg-emerald-50/60 px-3 py-2"
          >
            <div className="text-[11px] font-medium text-emerald-700">{tile.label}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-950">
              {tile.value}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-sm font-medium text-slate-700">Avg score by checkpoint</h2>
            {!singlePoint && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-0.5 w-3 rounded-full"
                    style={{ backgroundColor: SERIES_COLOR }}
                  />
                  Avg reward
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-3 rounded-[2px]"
                    style={{ backgroundColor: SERIES_COLOR, opacity: 0.2 }}
                  />
                  Min/max range
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: DOT_COLOR, opacity: 0.55 }}
                  />
                  Individual rollouts
                </span>
              </div>
            )}
          </div>
          {!singlePoint && (
            <span className="text-xs text-slate-400">click a point to inspect its rollouts</span>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-xs text-slate-400">
            No checkpoints recorded for this instance
          </div>
        ) : singlePoint ? (
          <p data-testid="evolution-chart-note" className="text-xs text-slate-500">
            Only one checkpoint — nothing to plot yet
          </p>
        ) : (
          <div
            data-testid="evolution-chart"
            className={`h-[220px] ${evolution.isFetching ? 'opacity-60' : ''}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 18, right: 16, bottom: 0, left: 0 }}
                style={{ cursor: 'pointer' }}
                onClick={(state) => {
                  const x = Number(state?.activeLabel)
                  if (!Number.isFinite(x)) return
                  // Scatter jitter can make the active label sit between checkpoints —
                  // snap the selection to the nearest real step.
                  let step: number | undefined
                  for (const r of rows) {
                    if (step === undefined || Math.abs(r.step - x) < Math.abs(step - x)) {
                      step = r.step
                    }
                  }
                  if (step !== undefined) setSelection({ traceId: traceUid, step })
                }}
              >
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="step"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  ticks={rows.length <= 14 ? rows.map((r) => r.step) : undefined}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                />
                <YAxis
                  domain={[0, 1]}
                  ticks={[0, 0.25, 0.5, 0.75, 1]}
                  width={32}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={EvolutionTooltip}
                  cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                />
                <ReferenceLine x={selectedStep} stroke="#cbd5e1" />
                <Area
                  type="monotone"
                  dataKey="range"
                  name="Min/max range"
                  stroke="none"
                  fill={SERIES_COLOR}
                  fillOpacity={0.15}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Scatter
                  data={scatterPoints}
                  dataKey="score"
                  name="Individual rollouts"
                  tooltipType="none"
                  isAnimationActive={false}
                  shape={(props: { cx?: number; cy?: number; payload?: ScatterDatum }) => (
                    <circle
                      cx={(props.cx ?? 0) + (props.payload?.jitterPx ?? 0)}
                      cy={props.cy}
                      r={3}
                      fill={DOT_COLOR}
                      fillOpacity={0.55}
                    />
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="avgScore"
                  name="Avg reward"
                  stroke={SERIES_COLOR}
                  strokeWidth={2}
                  dot={{ r: 4, fill: SERIES_COLOR, stroke: '#ffffff', strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                  connectNulls
                  isAnimationActive={false}
                />
                {trace.stats.score !== null && (
                  <ReferenceDot
                    x={checkpointStep}
                    y={trace.stats.score}
                    r={6}
                    fill={CURRENT_COLOR}
                    stroke="#ffffff"
                    strokeWidth={2}
                    label={{ value: 'this trace', position: 'top', fontSize: 10, fill: '#64748b' }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">
          Rollouts at step {selectedStep}
          {selectedPoint && (
            <span className="ml-2 font-normal text-slate-400">
              avg {formatScore(selectedPoint.avgScore)}
            </span>
          )}
        </h2>
        {!selectedPoint || selectedPoint.rollouts.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No rollouts at this step" />
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {selectedPoint.rollouts.map((rollout) => (
              <RolloutRow
                key={traceAddress(rollout)}
                rollout={rollout}
                currentTraceId={traceUid}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">
          Sibling rollouts{' '}
          <span className="font-normal text-slate-400">same instance · step {checkpointStep}</span>
        </h2>
        {siblings.isLoading ? (
          <div className="mt-2 text-xs text-slate-400">Loading…</div>
        ) : !siblings.data || siblings.data.length === 0 ? (
          <div className="mt-2 text-xs text-slate-400">No other rollouts at this checkpoint</div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {siblings.data.map((sibling) => (
              <TraceLink
                key={traceAddress(sibling)}
                traceId={traceAddress(sibling)}
                onNavigate={onNavigate}
                testId={`evolution-sibling-${sibling.meta.traceId}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs hover:border-slate-300 hover:bg-slate-50"
              >
                <span className="font-mono text-slate-700">
                  {rolloutLabel(sibling.meta.traceId)}
                </span>
                <span className="font-mono tabular-nums text-slate-500">
                  {formatScore(sibling.stats.score)}
                </span>
              </TraceLink>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
