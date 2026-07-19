import type { Trace } from '@shared/schema/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '../common/format'
import { buildSpanTree, flattenVisible, type SpanRow } from './profSpans'
import { AxisGrid, SpanBar } from './SpanBar'
import { SpanDetailPanel } from './SpanDetailPanel'

/** Above this span count, plain mapping janks — switch to a virtualized list. */
const VIRTUAL_LIMIT = 300
/** Stack the detail panel below the gantt when the container is narrower than this. */
const NARROW_PX = 900

/** 'Start · 25% · 50% · 75% · End' labels aligned to the gantt cell. */
function AxisHeader() {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-1">
      <div className="w-52 shrink-0 text-[9px] uppercase tracking-wide text-slate-400">Span</div>
      <div className="relative h-4 min-w-0 flex-1 text-[9px] text-slate-400">
        <AxisGrid />
        <span className="absolute left-0">Start</span>
        {[25, 50, 75].map((pct) => (
          <span key={pct} className="absolute -translate-x-1/2" style={{ left: `${pct}%` }}>
            {pct}%
          </span>
        ))}
        <span className="absolute right-0">End</span>
      </div>
      <div className="w-20 shrink-0" />
    </div>
  )
}

function VirtualRows({
  rows,
  renderRow,
}: {
  rows: SpanRow[]
  renderRow: (row: SpanRow) => ReactElement
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 20,
  })
  return (
    <div ref={parentRef} className="max-h-[65vh] overflow-y-auto">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={rows[item.index].span.id}
            ref={virtualizer.measureElement}
            data-index={item.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {renderRow(rows[item.index])}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Profiling timeline: span tree + proportional gantt on a shared axis + detail panel. */
export function TimelineTab({ trace }: { trace: Trace }) {
  const { spans, derived } = useMemo(() => buildSpanTree(trace), [trace])
  const root = useMemo(() => spans.find((s) => s.parentId === null) ?? spans[0], [spans])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const rows = useMemo(() => flattenVisible(spans, collapsed), [spans, collapsed])
  const selected = spans.find((s) => s.id === selectedId) ?? root ?? null

  const containerRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? NARROW_PX
      setNarrow(width < NARROW_PX)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!root) {
    return (
      <div className="px-6 py-10 text-center text-sm text-slate-400">
        No spans to display for this trace.
      </div>
    )
  }

  const totalMs = Math.max(root.startMs + root.durationMs, 1)
  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const renderRow = (row: SpanRow) => (
    <SpanBar
      key={row.span.id}
      row={row}
      totalMs={totalMs}
      isRoot={row.span.id === root.id}
      selected={selected?.id === row.span.id}
      collapsed={collapsed.has(row.span.id)}
      onSelect={() => setSelectedId(row.span.id)}
      onToggle={() => toggle(row.span.id)}
    />
  )

  return (
    <div ref={containerRef} className="mx-auto max-w-7xl px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-800">
          Execution timeline · {spans.length} spans
        </h2>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
          {formatDuration(root.durationMs)}
        </span>
        {derived && <span className="text-xs italic text-slate-400">derived from messages</span>}
      </div>
      <div className={`flex gap-4 ${narrow ? 'flex-col' : ''}`}>
        <div className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white">
          <AxisHeader />
          {spans.length > VIRTUAL_LIMIT ? (
            <VirtualRows rows={rows} renderRow={renderRow} />
          ) : (
            rows.map(renderRow)
          )}
        </div>
        <div className={narrow ? '' : 'w-80 shrink-0'}>
          <SpanDetailPanel span={selected} traceStartIso={trace.meta.timestamp} />
        </div>
      </div>
    </div>
  )
}
