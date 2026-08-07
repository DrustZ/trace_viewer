import { hasRecordedCheckpoint } from '@shared/schema/provenance'
import type { Trace } from '@shared/schema/types'
import { type ReactNode, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { type ListParams, useNeighbors } from '../../api/hooks'
import { formatDuration, formatNumber, formatPercent } from '../common/format'
import { ScoreBadge } from '../common/ScoreBadge'
import { StatusPill } from '../common/StatusPill'

export const TRACE_TABS = [
  'conversation',
  'evaluation',
  'review',
  'state',
  'replay',
  'metadata',
  'evolution',
  'playground',
  'raw',
] as const
export type TraceTab = (typeof TRACE_TABS)[number]

const TAB_LABELS: Record<TraceTab, string> = {
  conversation: 'Conversation',
  evaluation: 'Evaluation',
  review: 'Human Review',
  state: 'State & Tools',
  replay: 'Replay & Fork',
  metadata: 'Metadata',
  evolution: 'Evolution',
  playground: 'LLM-only continuation',
  raw: 'Raw',
}

const LIST_KEYS = ['split', 'step', 'component', 'status', 'filters', 'q', 'sort', 'order'] as const

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{children}</span>
  )
}

export function TraceHeader({
  trace,
  activeTab,
  onTabChange,
  variant = 'page',
  listSearch = '',
  onNavigate,
  onClose,
  blindReview = false,
}: {
  trace: Trace
  activeTab: TraceTab
  onTabChange: (tab: TraceTab) => void
  variant?: 'page' | 'drawer'
  /** List-view query string ('?split=…'); drives neighbors, back link, and Expand. */
  listSearch?: string
  /** Drawer only: Prev/Next switch the previewed trace instead of navigating. */
  onNavigate?: (traceId: string) => void
  onClose?: () => void
  /** Prevent automatic evaluation summaries leaking into an unlocked calibration review. */
  blindReview?: boolean
}) {
  const navigate = useNavigate()
  const { meta, stats } = trace
  const traceUid = meta.traceUid ?? meta.traceId
  const taskScenarioId = meta.corpusId === 'simulation' ? meta.instanceId : undefined

  const isImported = meta.runId === 'imported' || meta.extra?.run === 'imported'
  // Chat/message imports have no RL run/checkpoint/split — drop the synthetic
  // default badges (step 0, train) so they don't read as real metadata. (The
  // trace views themselves stay consistent with loaded-run traces.)
  const showStep = hasRecordedCheckpoint(meta)
  const showSplit = !(isImported && meta.sourceFormat !== 'native')

  // Cheap tab counts only: messages are already loaded. (Profiling spans now live
  // inside the Conversation view's Timeline sub-mode, not a standalone tab.)
  const tabCounts: Partial<Record<TraceTab, number>> = {
    conversation: trace.messages.length,
    evaluation: trace.evaluation?.failures.length,
    state: trace.evaluation
      ? trace.evaluation.worldDiff.length + trace.evaluation.ledger.length
      : undefined,
  }

  const backSearch = useMemo(() => {
    const p = new URLSearchParams(listSearch)
    p.delete('tab')
    p.delete('msg')
    const s = p.toString()
    return s ? `?${s}` : ''
  }, [listSearch])

  const listParams = useMemo(() => {
    const p = new URLSearchParams(listSearch)
    const params: ListParams = {}
    for (const key of LIST_KEYS) {
      const value = p.get(key)
      if (value !== null && value !== '') params[key] = value
    }
    return params
  }, [listSearch])

  const neighbors = useNeighbors(traceUid, listParams)

  const expandTo = useMemo(() => {
    const p = new URLSearchParams(listSearch)
    p.delete('peek') // drawer-only param — stale on the full trace page
    p.set('tab', activeTab)
    return { pathname: `/trace/${encodeURIComponent(traceUid)}`, search: `?${p.toString()}` }
  }, [listSearch, activeTab, traceUid])

  const goTo = (id: string | null) => {
    if (!id) return
    if (onNavigate) onNavigate(id)
    else navigate({ pathname: `/trace/${encodeURIComponent(id)}`, search: listSearch })
  }

  return (
    <header className="shrink-0 border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 pt-3">
        {variant === 'page' ? (
          <Link
            to={{ pathname: '/', search: backSearch }}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            ← Traces
          </Link>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Link
              to={expandTo}
              data-testid="drawer-expand"
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Expand ↗
            </Link>
            <button
              type="button"
              data-testid="drawer-close"
              aria-label="Close preview"
              onClick={onClose}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              ✕ Close
            </button>
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate font-mono text-lg font-semibold text-slate-900">
              {meta.sourceTraceId ?? meta.traceId}
            </h1>
            {blindReview ? (
              <Badge>blind calibration · automatic outcome hidden</Badge>
            ) : (
              <>
                <StatusPill status={meta.status} />
                {trace.evaluation?.lifecycle.pendingPhase && (
                  <Badge>pending · {trace.evaluation.lifecycle.pendingPhase}</Badge>
                )}
                <ScoreBadge score={stats.score} />
              </>
            )}
            <Badge>{meta.component}</Badge>
            {showStep && <Badge>step {meta.checkpointStep}</Badge>}
            {showSplit && <Badge>{meta.split}</Badge>}
            <Badge>{meta.sourceFormat}</Badge>
            {taskScenarioId && (
              <>
                <Link
                  to={`/ace/tasks/${encodeURIComponent(taskScenarioId)}`}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  View task definition
                </Link>
                <Link
                  to={`/ace/lab?${new URLSearchParams({ trace: traceUid }).toString()}`}
                  className="text-xs font-medium text-violet-600 hover:underline"
                >
                  Open in lab
                </Link>
              </>
            )}
          </div>
          {/* Prev/Next walk the loaded list — meaningless for a one-off import. */}
          {!isImported && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="trace-prev"
                onClick={() => goTo(neighbors.data?.prevId ?? null)}
                disabled={!neighbors.data?.prevId}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="font-mono text-xs text-slate-500">
                {neighbors.data ? `${neighbors.data.position}/${neighbors.data.total}` : '…'}
              </span>
              <button
                type="button"
                data-testid="trace-next"
                onClick={() => goTo(neighbors.data?.nextId ?? null)}
                disabled={!neighbors.data?.nextId}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {formatNumber(stats.turns)} turns · {formatNumber(stats.toolUses)} tool uses ·{' '}
          {formatNumber(stats.totalTokens)} tokens · {formatDuration(stats.durationMs)} · thinking{' '}
          {formatPercent(stats.thinkingPortion)}
        </div>
        <nav className="mt-3 flex gap-5">
          {TRACE_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={`border-b-2 pb-2 text-sm ${
                tab === activeTab
                  ? 'border-slate-800 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {TAB_LABELS[tab]}
              {!blindReview && tabCounts[tab] !== undefined && (
                <span className="ml-1 font-normal text-slate-400">
                  ({formatNumber(tabCounts[tab])})
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}
