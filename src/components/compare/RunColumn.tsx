import { encodeFilterSet } from '@shared/filter/parse'
import type { TraceSummary } from '@shared/schema/types'
import { useEffect, useMemo, useState } from 'react'
import { useTrace, useTraces } from '../../api/hooks'
import { EmptyState, LoadingState } from '../common/EmptyState'
import { formatNumber, formatScore } from '../common/format'
import { ScoreBadge } from '../common/ScoreBadge'
import { StatusPill } from '../common/StatusPill'
import type { TraceTab } from '../trace/TraceHeader'
import { TraceView } from '../trace/TraceView'

const PER_RUN_LIMIT = 1000

interface StepGroup {
  step: number
  count: number
  avgScore: number | null
  rollouts: TraceSummary[]
}

/** Group one run's rollouts by checkpoint step, ascending; avg over scored rollouts only. */
export function groupByStep(items: readonly TraceSummary[]): StepGroup[] {
  const byStep = new Map<number, TraceSummary[]>()
  for (const s of items) {
    const g = byStep.get(s.meta.checkpointStep)
    if (g) g.push(s)
    else byStep.set(s.meta.checkpointStep, [s])
  }
  return [...byStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, rollouts]) => {
      const scores = rollouts.map((r) => r.stats.score).filter((v): v is number => v !== null)
      return {
        step,
        count: rollouts.length,
        avgScore: scores.length > 0 ? scores.reduce((a, v) => a + v, 0) / scores.length : null,
        rollouts,
      }
    })
}

function itemsOf(data: unknown): TraceSummary[] {
  return data && typeof data === 'object' && 'items' in data
    ? (data as { items: TraceSummary[] }).items
    : []
}
function totalOf(data: unknown): number {
  return data && typeof data === 'object' && 'total' in data
    ? Number((data as { total: number }).total)
    : 0
}

function RolloutRow({
  rollout,
  run,
  selected,
  onSelect,
}: {
  rollout: TraceSummary
  run: string
  selected: boolean
  onSelect: (id: string) => void
}) {
  const { meta, stats } = rollout
  return (
    <button
      type="button"
      data-testid={`rollout-${run}-${meta.traceId}`}
      aria-current={selected}
      onClick={() => onSelect(meta.traceId)}
      className={`flex w-full flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs ${
        selected
          ? 'border-blue-300 bg-blue-50'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <span className="truncate font-mono text-slate-800">{meta.traceId}</span>
      <ScoreBadge score={stats.score} />
      <StatusPill status={meta.status} />
      <span className="ml-auto text-slate-500">
        {formatNumber(stats.turns)}t · {formatNumber(stats.totalTokens)} tok
      </span>
    </button>
  )
}

/**
 * One side of the diff: a run's rollouts for an instance, grouped by checkpoint
 * step (collapsible), plus the full TraceView of the selected rollout below.
 */
export function RunColumn({
  run,
  instanceId,
  selectedTraceId,
  onSelect,
}: {
  run: string
  instanceId: string
  selectedTraceId: string
  onSelect: (id: string) => void
}) {
  const filters = encodeFilterSet({
    conditions: [
      { key: 'instanceId', op: 'eq', value: instanceId },
      { key: 'run', op: 'eq', value: run },
    ],
  })
  const query = useTraces({ filters, limit: PER_RUN_LIMIT })
  const items = itemsOf(query.data)
  const total = totalOf(query.data)
  const groups = useMemo(() => groupByStep(items), [items])

  const selectedStep = items.find((s) => s.meta.traceId === selectedTraceId)?.meta.checkpointStep
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  // Auto-expand the group holding the current selection (default: all collapsed).
  useEffect(() => {
    if (selectedStep !== undefined) {
      setOpen((s) => (s.has(selectedStep) ? s : new Set(s).add(selectedStep)))
    }
  }, [selectedStep])

  const [tab, setTab] = useState<TraceTab>('conversation')
  const [showRollouts, setShowRollouts] = useState(!selectedTraceId)
  // Once a trace is picked, collapse the rollout list so the trace view fills
  // the column (reopen via the run header to switch rollouts).
  useEffect(() => {
    if (selectedTraceId) setShowRollouts(false)
  }, [selectedTraceId])
  const trace = useTrace(selectedTraceId || undefined)

  return (
    <section
      className="flex h-full min-w-0 flex-1 basis-0 flex-col gap-2"
      data-testid={`run-column-${run}`}
    >
      <button
        type="button"
        onClick={() => setShowRollouts((v) => !v)}
        data-testid={`rollouts-toggle-${run}`}
        className="flex items-center gap-2 text-left text-sm"
      >
        <span className={`text-slate-400 transition-transform ${showRollouts ? 'rotate-90' : ''}`}>
          ▸
        </span>
        <span className="font-semibold text-slate-800">{run}</span>
        <span className="text-xs text-slate-500">{formatNumber(total)} rollouts</span>
      </button>

      {showRollouts && total > items.length && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          showing first {items.length} of {total} rollouts
        </p>
      )}

      {showRollouts &&
        (query.isLoading ? (
          <LoadingState label={`Loading ${run}…`} />
        ) : groups.length === 0 ? (
          <EmptyState
            title={`No rollouts for ${run}`}
            hint="This run has no rollouts for the instance."
          />
        ) : (
          // Once a trace is open it's the focus below; cap the list into a
          // scrollable strip so it doesn't split the column in half.
          <ul
            className={`flex flex-col gap-1.5 overflow-y-auto ${
              selectedTraceId ? 'max-h-56 shrink-0' : 'min-h-0 flex-1'
            }`}
          >
            {groups.map((g) => {
              const isOpen = open.has(g.step)
              return (
                <li key={g.step} className="rounded-md border border-slate-200 bg-white">
                  <button
                    type="button"
                    data-testid={`step-header-${run}-${g.step}`}
                    onClick={() =>
                      setOpen((s) => {
                        const next = new Set(s)
                        if (next.has(g.step)) next.delete(g.step)
                        else next.add(g.step)
                        return next
                      })
                    }
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <span className="text-slate-400">{isOpen ? '▾' : '▸'}</span>
                    Step {g.step}
                    <span className="text-slate-400">· avg {formatScore(g.avgScore)}</span>
                    <span className="ml-auto text-slate-400">({g.count})</span>
                  </button>
                  {isOpen && (
                    <div className="flex flex-col gap-1 border-t border-slate-100 p-1.5">
                      {g.rollouts.map((r) => (
                        <RolloutRow
                          key={r.meta.traceId}
                          rollout={r}
                          run={run}
                          selected={r.meta.traceId === selectedTraceId}
                          onSelect={onSelect}
                        />
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ))}

      {selectedTraceId && (
        <div
          data-testid={`trace-view-${run}`}
          className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          {trace.isLoading ? (
            <div className="p-4">
              <LoadingState label="Loading trace…" />
            </div>
          ) : trace.data ? (
            <TraceView
              trace={trace.data}
              tab={tab}
              onTabChange={setTab}
              variant="drawer"
              listSearch=""
              onNavigate={onSelect}
              onClose={() => onSelect('')}
            />
          ) : (
            <div className="p-4 text-xs text-red-600">Failed to load trace.</div>
          )}
        </div>
      )}
    </section>
  )
}
