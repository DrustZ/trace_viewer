import type { GroupedTracesResponse, InstanceGroup, TracesListResponse } from '@shared/schema/api'
import { recordedCheckpoint } from '@shared/schema/provenance'
import type { TraceSummary } from '@shared/schema/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { type ListParams, useTraces } from '../../api/hooks'
import { activeRange, type ListParamPatch, rangePatch } from '../../state/filterParams'
import { EmptyState, ErrorState, LoadingState } from '../common/EmptyState'
import { formatDuration, formatNumber, formatTimestamp } from '../common/format'
import { RangeFilter } from '../common/RangeFilter'
import { ScoreBadge } from '../common/ScoreBadge'
import { StatusPill } from '../common/StatusPill'
import { useColumnWidths } from '../common/useColumnWidths'

const ROW_HEIGHT = 40
const COL_GAP = 8 // matches gap-x-2 on header + rows

const DEFAULT_WIDTHS: Record<string, number> = {
  traceId: 260,
  instance: 150,
  component: 130,
  score: 64,
  step: 56,
  split: 56,
  status: 90,
  err: 52,
  trunc: 64,
  turns: 56,
  tools: 56,
  outTok: 72,
  thinkTok: 76,
  duration: 80,
  time: 136,
}

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
  { id: 'err', label: 'Err', sortKey: 'hasError', align: 'right' },
  { id: 'trunc', label: 'Trunc', sortKey: 'truncated', align: 'right' },
  { id: 'turns', label: 'Turns', sortKey: 'turns', align: 'right' },
  { id: 'tools', label: 'Tools', sortKey: 'toolUses', align: 'right' },
  { id: 'outTok', label: 'Out Tok', sortKey: 'outputTokens', align: 'right' },
  { id: 'thinkTok', label: 'Think Tok', sortKey: 'thinkingTokens', align: 'right' },
  { id: 'duration', label: 'Duration', sortKey: 'durationMs', align: 'right' },
  { id: 'time', label: 'Time', sortKey: 'time' },
]

/** Numeric columns that support a header range-filter, mapped to their filter-DSL key. */
interface RangeCol {
  key: string
  accessor: (t: TraceSummary) => number | null | undefined
  step: number
  fixedDomain?: [number, number]
}
const RANGE_COLS: Record<string, RangeCol> = {
  score: { key: 'score', accessor: (t) => t.stats.score, step: 0.05, fixedDomain: [0, 1] },
  step: { key: 'step', accessor: (t) => recordedCheckpoint(t.meta) ?? undefined, step: 1 },
  turns: { key: 'turns', accessor: (t) => t.stats.turns, step: 1 },
  tools: { key: 'toolUses', accessor: (t) => t.stats.toolUses, step: 1 },
  outTok: { key: 'outputTokens', accessor: (t) => t.stats.outputTokens, step: 10 },
  thinkTok: { key: 'thinkingTokens', accessor: (t) => t.stats.thinkingTokens, step: 10 },
  duration: { key: 'durationMs', accessor: (t) => t.stats.durationMs, step: 100 },
}

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

function TruncBadge() {
  return (
    <span
      data-testid="trunc-badge"
      title="output truncated"
      className="shrink-0 rounded bg-orange-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-700"
    >
      TRUNC
    </span>
  )
}

function ErrorDot() {
  return (
    <span
      role="img"
      title="has tool/exec errors"
      aria-label="has tool/exec errors"
      className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500"
    />
  )
}

function TraceRow({
  trace,
  indent,
  selected,
  href,
  style,
  onSelect,
}: {
  trace: TraceSummary
  indent: boolean
  selected: boolean
  href: string
  style: React.CSSProperties
  onSelect: () => void
}) {
  const { meta, stats } = trace
  const checkpoint = recordedCheckpoint(meta)
  const num = 'text-right tabular-nums text-slate-600'
  return (
    // Real anchor keeps middle-click / cmd-click open-in-new-tab; plain click previews.
    <a
      href={href}
      data-testid="trace-row"
      aria-current={selected ? 'true' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        onSelect()
      }}
      style={style}
      className={`grid w-full cursor-pointer items-center gap-x-2 border-b border-slate-100 px-3 text-left text-xs ${
        selected ? 'bg-blue-50' : 'hover:bg-slate-50'
      }`}
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
      <span className={num} title={checkpoint === null ? 'Checkpoint unavailable' : undefined}>
        {checkpoint ?? '—'}
      </span>
      <span className="text-slate-600">{meta.split}</span>
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        <StatusPill status={meta.status} />
      </span>
      <span className="text-right">
        {stats.hasError ? <ErrorDot /> : <span className="text-slate-300">—</span>}
      </span>
      <span className="text-right">
        {stats.truncated ? <TruncBadge /> : <span className="text-slate-300">—</span>}
      </span>
      <span className={num}>{formatNumber(stats.turns)}</span>
      <span className={num}>{formatNumber(stats.toolUses)}</span>
      <span className={num}>{formatNumber(stats.outputTokens)}</span>
      <span className={num}>{formatNumber(stats.thinkingTokens)}</span>
      <span className={num}>{formatDuration(stats.durationMs)}</span>
      <span className="truncate text-slate-500">{formatTimestamp(meta.timestamp)}</span>
    </a>
  )
}

/** NaN-safe mean over the group's items; null when no item has a value. */
function avgOf(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => v !== null && v !== undefined)
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function round1(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10
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
  const items = group.items
  const num = 'text-right tabular-nums text-slate-600'
  const avgTurns = round1(avgOf(items.map((t) => t.stats.turns)))
  const avgTools = round1(avgOf(items.map((t) => t.stats.toolUses)))
  const avgOutTok = avgOf(items.map((t) => t.stats.outputTokens))
  const avgThinkTok = avgOf(items.map((t) => t.stats.thinkingTokens))
  const avgDuration = avgOf(items.map((t) => t.stats.durationMs))
  const checkpointValues = items.flatMap((t) => {
    const step = recordedCheckpoint(t.meta)
    return step === null ? [] : [step]
  })
  const steps = new Set(checkpointValues)
  const orderedSteps = [...steps].sort((a, b) => a - b)
  const minStep = orderedSteps[0]
  const maxStep = orderedSteps[orderedSteps.length - 1]
  const unavailableCheckpoints = items.length - checkpointValues.length
  const splits = new Set(items.map((t) => t.meta.split))
  const statuses = new Set(items.map((t) => t.meta.status))
  const anyTruncated = items.some((t) => t.stats.truncated)
  const anyError = items.some((t) => t.stats.hasError)
  const first = items[0]
  const stepChip =
    'shrink-0 rounded border border-slate-300 bg-white px-1 py-px text-[10px] font-medium text-slate-600'

  return (
    <button
      type="button"
      data-testid="group-row"
      aria-expanded={expanded}
      onClick={onToggle}
      style={style}
      className="grid w-full items-center gap-x-2 border-b border-slate-200 bg-slate-50 px-3 text-left text-xs font-medium hover:bg-slate-100"
    >
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={`inline-block shrink-0 text-slate-400 transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        >
          ▸
        </span>
        <span className="truncate font-mono text-slate-700">{group.instanceId}</span>
        <span className="shrink-0 font-normal text-slate-400">({group.count})</span>
      </span>
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        {minStep === undefined || maxStep === undefined ? (
          <span className="truncate font-normal text-[10px] text-slate-400">
            checkpoint unavailable
          </span>
        ) : (
          <>
            <span className={stepChip}>S{minStep}</span>
            <span className="shrink-0 text-slate-400">→</span>
            <span className={stepChip}>S{maxStep}</span>
            <span
              title={`${steps.size} checkpoint${steps.size === 1 ? '' : 's'}${
                unavailableCheckpoints > 0 ? `; ${unavailableCheckpoints} unavailable` : ''
              }`}
              className="truncate whitespace-nowrap font-normal text-[10px] text-slate-400"
            >
              {steps.size} checkpoint{steps.size === 1 ? '' : 's'}
              {unavailableCheckpoints > 0 ? ` + ${unavailableCheckpoints} unavailable` : ''}
            </span>
          </>
        )}
      </span>
      <span className="min-w-0">
        <ComponentBadge component={group.component} />
      </span>
      <span>
        <ScoreBadge score={group.avgScore} />
      </span>
      <span className={num}>
        {steps.size === 0 ? '—' : steps.size === 1 ? orderedSteps[0] : `${steps.size} steps`}
      </span>
      <span className="text-slate-600">
        {splits.size === 1 && first ? first.meta.split : 'mixed'}
      </span>
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        {statuses.size === 1 && first ? (
          <StatusPill status={first.meta.status} />
        ) : (
          <span className="font-normal text-slate-500">mixed</span>
        )}
      </span>
      <span className="text-right">
        {anyError ? <ErrorDot /> : <span className="text-slate-300">—</span>}
      </span>
      <span className="text-right">
        {anyTruncated ? <TruncBadge /> : <span className="text-slate-300">—</span>}
      </span>
      <span className={num}>{formatNumber(avgTurns)}</span>
      <span className={num}>{formatNumber(avgTools)}</span>
      <span className={num}>{formatNumber(avgOutTok === null ? null : Math.round(avgOutTok))}</span>
      <span className={num}>
        {formatNumber(avgThinkTok === null ? null : Math.round(avgThinkTok))}
      </span>
      <span className={num}>{formatDuration(avgDuration)}</span>
      <span />
    </button>
  )
}

export function TraceTable({
  params,
  setParams,
  selectedId,
  onSelect,
}: {
  params: ListParams
  setParams: (patch: ListParamPatch) => void
  selectedId?: string
  onSelect: (traceId: string) => void
}) {
  const query = useTraces({ ...params, limit: params.limit ?? 2000 })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rangeCol, setRangeCol] = useState<string | null>(null)
  const location = useLocation()
  const parentRef = useRef<HTMLDivElement>(null)
  const { widths, startResize, resetCol } = useColumnWidths('traces', DEFAULT_WIDTHS)

  // Close the open range-filter popover on Escape.
  useEffect(() => {
    if (!rangeCol) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRangeCol(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rangeCol])

  const columnHasRange = (colId: string) => {
    const cfg = RANGE_COLS[colId]
    if (!cfg) return false
    const r = activeRange(params, cfg.key)
    return r.min !== undefined || r.max !== undefined
  }

  const sort = params.sort ?? 'time'
  const order = params.order ?? 'desc'

  const colWidth = (id: string) => widths[id] ?? DEFAULT_WIDTHS[id] ?? 60
  const gridTemplate = COLUMNS.map((c) => `${colWidth(c.id)}px`).join(' ')
  const minWidth =
    COLUMNS.reduce((s, c) => s + colWidth(c.id), 0) + COL_GAP * (COLUMNS.length - 1) + 24

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
  // Range-slider domains come from the loaded rows (score is a fixed [0,1]).
  const allTraces: TraceSummary[] = isGrouped(data)
    ? data.groups.flatMap((g) => g.items)
    : data.items
  const domainFor = (colId: string): [number, number] => {
    const cfg = RANGE_COLS[colId]
    if (cfg.fixedDomain) return cfg.fixedDomain
    const vals = allTraces.map(cfg.accessor).filter((v): v is number => v != null)
    if (vals.length === 0) return [0, cfg.step]
    const lo = Math.floor(Math.min(...vals))
    const hi = Math.ceil(Math.max(...vals))
    return lo === hi ? [lo, lo + cfg.step] : [lo, hi]
  }
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
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      {/* Backdrop that dismisses an open range popover on outside click. */}
      {rangeCol && (
        <button
          type="button"
          aria-label="Close range filter"
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setRangeCol(null)}
        />
      )}
      <p className="shrink-0 text-xs text-slate-500">{countLine}</p>
      {rows.length === 0 ? (
        <EmptyState
          title="No traces match the current filters"
          hint="Try removing a filter or clearing them all."
        />
      ) : (
        <div
          className={`min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white ${
            query.isPlaceholderData ? 'opacity-60' : ''
          }`}
        >
          <div ref={parentRef} className="h-full overflow-auto">
            <div style={{ minWidth }}>
              <div
                style={{ gridTemplateColumns: gridTemplate }}
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
                  const base = `max-w-full truncate text-[11px] font-medium uppercase tracking-wide ${
                    active ? 'text-slate-800' : 'text-slate-500'
                  } ${col.align === 'right' ? 'text-right' : 'text-left'}`
                  return (
                    <div
                      key={col.id}
                      className={`relative flex h-8 items-center py-2 ${
                        col.align === 'right' ? 'justify-end' : ''
                      }`}
                    >
                      {col.sortKey ? (
                        <button
                          type="button"
                          onClick={() => onSort(col.sortKey as string)}
                          className={`${base} cursor-pointer hover:text-slate-800`}
                        >
                          {label}
                        </button>
                      ) : (
                        <span className={base}>{label}</span>
                      )}
                      {RANGE_COLS[col.id] && (
                        <button
                          type="button"
                          data-testid={`range-toggle-${col.id}`}
                          aria-label={`Filter ${col.label} by range`}
                          title={`Filter ${col.label} by range`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setRangeCol(rangeCol === col.id ? null : col.id)
                          }}
                          className={`ml-0.5 shrink-0 ${
                            columnHasRange(col.id)
                              ? 'text-blue-600'
                              : 'text-slate-300 hover:text-slate-600'
                          }`}
                        >
                          <svg
                            viewBox="0 0 16 16"
                            aria-hidden="true"
                            className="h-2.5 w-2.5"
                            fill="currentColor"
                          >
                            <path d="M1.5 3h13l-5 6v4.5l-3 1.2V9l-5-6z" />
                          </svg>
                        </button>
                      )}
                      {rangeCol === col.id &&
                        RANGE_COLS[col.id] &&
                        (() => {
                          const [dMin, dMax] = domainFor(col.id)
                          const cfg = RANGE_COLS[col.id]
                          return (
                            <div className="absolute top-full right-0 z-30 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg">
                              <RangeFilter
                                label={col.label}
                                domainMin={dMin}
                                domainMax={dMax}
                                step={cfg.step}
                                value={activeRange(params, cfg.key)}
                                onApply={(mn, mx) => {
                                  setParams(rangePatch(params, cfg.key, mn, mx, dMin, dMax))
                                  setRangeCol(null)
                                }}
                                onClear={() => {
                                  setParams(rangePatch(params, cfg.key, dMin, dMax, dMin, dMax))
                                  setRangeCol(null)
                                }}
                              />
                            </div>
                          )
                        })()}
                      <div
                        data-testid={`col-resize-${col.id}`}
                        aria-hidden="true"
                        title="Drag to resize · double-click to reset"
                        onPointerDown={(e) => startResize(col.id, e)}
                        onDoubleClick={() => resetCol(col.id)}
                        className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize touch-none hover:bg-blue-300"
                      />
                    </div>
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
                    gridTemplateColumns: gridTemplate,
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
                  const traceId = row.trace.meta.traceId
                  return (
                    <TraceRow
                      key={traceId}
                      trace={row.trace}
                      indent={row.indent}
                      selected={traceId === selectedId}
                      href={`/trace/${encodeURIComponent(traceId)}${location.search}`}
                      style={style}
                      onSelect={() => onSelect(traceId)}
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
