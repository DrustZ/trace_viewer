import type { Trace } from '@shared/schema/types'
import { type ReactNode, useMemo } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { type ListParams, useNeighbors } from '../../api/hooks'
import { formatDuration, formatNumber, formatPercent } from '../common/format'
import { ScoreBadge } from '../common/ScoreBadge'
import { StatusPill } from '../common/StatusPill'

export const TRACE_TABS = ['conversation', 'timeline', 'metadata', 'evolution', 'raw'] as const
export type TraceTab = (typeof TRACE_TABS)[number]

const TAB_LABELS: Record<TraceTab, string> = {
  conversation: 'Conversation',
  timeline: 'Timeline',
  metadata: 'Metadata',
  evolution: 'Evolution',
  raw: 'Raw',
}

const LIST_KEYS = ['split', 'step', 'component', 'status', 'filters', 'q', 'sort', 'order'] as const

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{children}</span>
  )
}

export function TraceHeader({ trace, activeTab }: { trace: Trace; activeTab: TraceTab }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { meta, stats } = trace

  const backSearch = useMemo(() => {
    const p = new URLSearchParams(location.search)
    p.delete('tab')
    p.delete('msg')
    const s = p.toString()
    return s ? `?${s}` : ''
  }, [location.search])

  const listParams = useMemo(() => {
    const p = new URLSearchParams(location.search)
    const params: ListParams = {}
    for (const key of LIST_KEYS) {
      const value = p.get(key)
      if (value !== null && value !== '') params[key] = value
    }
    return params
  }, [location.search])

  const neighbors = useNeighbors(meta.traceId, listParams)

  const goTo = (id: string | null) => {
    if (id) navigate({ pathname: `/trace/${id}`, search: location.search })
  }

  const selectTab = (tab: TraceTab) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }

  return (
    <header className="shrink-0 border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 pt-3">
        <Link
          to={{ pathname: '/', search: backSearch }}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          ← Traces
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate font-mono text-lg font-semibold text-slate-900">
              {meta.traceId}
            </h1>
            <StatusPill status={meta.status} />
            <ScoreBadge score={stats.score} />
            <Badge>{meta.component}</Badge>
            <Badge>step {meta.checkpointStep}</Badge>
            <Badge>{meta.split}</Badge>
            <Badge>{meta.sourceFormat}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
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
              onClick={() => goTo(neighbors.data?.nextId ?? null)}
              disabled={!neighbors.data?.nextId}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </div>
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
              onClick={() => selectTab(tab)}
              className={`border-b-2 pb-2 text-sm ${
                tab === activeTab
                  ? 'border-slate-800 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}
