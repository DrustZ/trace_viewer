import type { GroupedTracesResponse, InstanceGroup, TracesListResponse } from '@shared/schema/api'
import type { TraceSummary } from '@shared/schema/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { type ListParams, useTraces } from '../../api/hooks'
import type { ListParamPatch } from '../../state/filterParams'
import { EmptyState, ErrorState, LoadingState } from '../common/EmptyState'
import { formatDuration, formatNumber, formatTimestamp } from '../common/format'
import { ScoreBadge } from '../common/ScoreBadge'
import { StatusPill } from '../common/StatusPill'

const ROW_HEIGHT = 40
const GRID =
  'minmax(150px,1.3fr) minmax(120px,1fr) minmax(110px,0.9fr) 64px 56px 56px 96px 56px 56px 72px 76px 80px 136px'

interface Column {
  id: string
  label: string
  sortKey?: string
  align?: 'right'
}

const COLUMNS: Column[] = [
  { id: 'traceId', label: 'Trace ID' },
  { id: 'instance', label: 'Instance' },
  { id: 'component', label: 'Component' },
  { id: 'score', label: 'Score', sortKey: 'score' },
  { id: 'step', label: 'Step', sortKey: 'step', align: 'right' },
  { id: 'split', label: 'Split' },
  { id: 'status', label: 'Status' },
  { id: 'turns', label: 'Turns', sortKey: 'turns', align: 'right' },
  { id: 'tools', label: 'Tools', sortKey: 'toolUses', align: 'right' },
  { id: 'outTok', label: 'Out Tok', sortKey: 'outputTokens', align: 'right' },
  { id: 'thinkTok', label: 'Think Tok', sortKey: 'thinkingTokens', align: 'right' },
  { id: 'duration', label: 'Duration', sortKey: 'durationMs', align: 'right' },
  { id: 'time', label: 'Time', sortKey: 'time' },
]

type Row =
  | { kind: 'trace'; trace: TraceSummary; indent: boolean }
  | { kind: 'group'; group: InstanceGroup }

function isGrouped(d: TracesListResponse | GroupedTracesResponse): d is GroupedTracesResponse {
  return 'groups' in d
}

function ComponentBadge({ component }: { component: string }) {
  const short = component.split('/').pop() ?? component
  return (
    <span
      title={component}
      className="inline-block max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
    >
      {short}
    </span>
  )
}

function TraceRow({
  trace,
  indent,
  style,
  onClick,
}: {
  trace: TraceSummary
  indent: boolean
  style: React.CSSProperties
  onClick: () => void
}) {
  const { meta, stats } = trace
  const num = 'text-right tabular-nums text-slate-600'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...style, gridTemplateColumns: GRID }}
      className="grid w-full items-center gap-x-2 border-b border-slate-100 px-3 text-left text-xs hover:bg-slate-50"
    >
      <span className={`truncate font-mono text-blue-600 ${indent ? 'pl-6' : ''}`}>
        {meta.traceId}
      </span>
      <span className="truncate text-slate-600">{meta.instanceId}</span>
      <span className="min-w-0">
        <ComponentBadge component={meta.component} />
      </span>
      <span>
        <ScoreBadge score={stats.score} />
      </span>
      <span className={num}>{meta.checkpointStep}</span>
      <span className="text-slate-600">{meta.split}</span>
      <span>
        <StatusPill status={meta.status} />
      </span>
      <span className={num}>{formatNumber(stats.turns)}</span>
      <span className={num}>{formatNumber(stats.toolUses)}</span>
      <span className={num}>{formatNumber(stats.outputTokens)}</span>
      <span className={num}>{formatNumber(stats.thinkingTokens)}</span>
      <span className={num}>{formatDuration(stats.durationMs)}</span>
      <span className="truncate text-slate-500">{formatTimestamp(meta.timestamp)}</span>
    </button>
  )
}

function GroupRow({
  group,
  expanded,
  style,
  onToggle,
}: {
  group: InstanceGroup
  expanded: boolean
  style: React.CSSProperties
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={style}
      className="flex w-full items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 text-left text-xs hover:bg-slate-100"
    >
      <span
        className={`inline-block text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
      >
        ▸
      </span>
      <span className="truncate font-mono font-medium text-slate-700">{group.instanceId}</span>
      <ComponentBadge component={group.component} />
      <span className="text-slate-400">
        {group.count} rollout{group.count === 1 ? '' : 's'}
      </span>
      <span className="ml-auto flex items-center gap-1 text-slate-400">
        avg <ScoreBadge score={group.avgScore} />
      </span>
    </button>
  )
}

export function TraceTable({
  params,
  setParams,
}: {
  params: ListParams
  setParams: (patch: ListParamPatch) => void
}) {
  const query = useTraces({ ...params, limit: params.limit ?? 2000 })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const navigate = useNavigate()
  const location = useLocation()
  const parentRef = useRef<HTMLDivElement>(null)

  const sort = params.sort ?? 'time'
  const order = params.order ?? 'desc'

  const rows = useMemo<Row[]>(() => {
    const data = query.data
    if (!data) return []
    if (isGrouped(data)) {
      const out: Row[] = []
      for (const group of data.groups) {
        out.push({ kind: 'group', group })
        if (expanded.has(group.instanceId)) {
          for (const trace of group.items) out.push({ kind: 'trace', trace, indent: true })
        }
      }
      return out
    }
    return data.items.map((trace) => ({ kind: 'trace', trace, indent: false }))
  }, [query.data, expanded])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  if (query.error) return <ErrorState message={`Failed to load traces: ${query.error.message}`} />
  if (query.isLoading || !query.data) return <LoadingState label="Loading traces…" />

  const data = query.data
  const shown = isGrouped(data)
    ? data.groups.reduce((n, g) => n + g.items.length, 0)
    : data.items.length
  const countLine = isGrouped(data)
    ? `${formatNumber(shown)} of ${formatNumber(data.total)} traces · ${formatNumber(data.groups.length)} instances`
    : `${formatNumber(shown)} of ${formatNumber(data.total)} traces`

  const toggleGroup = (instanceId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(instanceId)) next.delete(instanceId)
      else next.add(instanceId)
      return next
    })

  const onSort = (key: string) => {
    if (sort === key) setParams({ sort: key, order: order === 'desc' ? 'asc' : 'desc' })
    else setParams({ sort: key, order: 'desc' })
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <p className="text-xs text-slate-500">{countLine}</p>
      {rows.length === 0 ? (
        <EmptyState
          title="No traces match the current filters"
          hint="Try removing a filter or clearing them all."
        />
      ) : (
        <div
          className={`overflow-hidden rounded-lg border border-slate-200 bg-white ${
            query.isPlaceholderData ? 'opacity-60' : ''
          }`}
        >
          <div ref={parentRef} className="h-[calc(100vh-330px)] min-h-[320px] overflow-auto">
            <div className="min-w-[1140px]">
              <div
                style={{ gridTemplateColumns: GRID }}
                className="sticky top-0 z-10 grid items-center gap-x-2 border-b border-slate-200 bg-slate-50 px-3"
              >
                {COLUMNS.map((col) => {
                  const active = col.sortKey === sort
                  const label = (
                    <>
                      {col.label}
                      {active && (
                        <span className="ml-0.5 text-slate-400">
                          {order === 'desc' ? '▼' : '▲'}
                        </span>
                      )}
                    </>
                  )
                  const base = `h-8 truncate py-2 text-[11px] font-medium uppercase tracking-wide ${
                    active ? 'text-slate-800' : 'text-slate-500'
                  } ${col.align === 'right' ? 'text-right' : 'text-left'}`
                  return col.sortKey ? (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => onSort(col.sortKey as string)}
                      className={`${base} cursor-pointer hover:text-slate-800`}
                    >
                      {label}
                    </button>
                  ) : (
                    <span key={col.id} className={base}>
                      {label}
                    </span>
                  )
                })}
              </div>
              <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index]
                  if (!row) return null
                  const style: React.CSSProperties = {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }
                  if (row.kind === 'group') {
                    return (
                      <GroupRow
                        key={`g:${row.group.instanceId}`}
                        group={row.group}
                        expanded={expanded.has(row.group.instanceId)}
                        style={style}
                        onToggle={() => toggleGroup(row.group.instanceId)}
                      />
                    )
                  }
                  return (
                    <TraceRow
                      key={row.trace.meta.traceId}
                      trace={row.trace}
                      indent={row.indent}
                      style={style}
                      onClick={() =>
                        navigate(
                          `/trace/${encodeURIComponent(row.trace.meta.traceId)}${location.search}`,
                        )
                      }
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
