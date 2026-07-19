import type { Trace } from '@shared/schema/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '../common/EmptyState'
import { formatDuration } from '../common/format'
import { useResizableWidth } from '../common/useResizableWidth'
import { MessageCard } from './MessageCard'
import { buildSpanTree, flattenVisible, type ProfSpan } from './profSpans'
import { SpanBar } from './SpanBar'
import { SpanDetailPanel } from './SpanDetailPanel'
import { buildResultErrorMap, StepCard } from './StepCard'
import { buildUnits } from './unitize'

function toggleIn(prev: Map<string, boolean>, id: string, fallback: boolean): Map<string, boolean> {
  return new Map(prev).set(id, !(prev.get(id) ?? fallback))
}

/**
 * Two-pane focus mode replacing the virtualized list while the toolbar's Timeline
 * toggle is on: LEFT is the full profiling span tree (buildSpanTree → flattenVisible
 * → SpanBar rows: name + kind label + proportional gantt bar + duration + status
 * dot, collapsible turn containers). RIGHT shows the selected span's profiling
 * detail (SpanDetailPanel) stacked above the render unit for the message that span
 * links to. Container spans (turn/root/grader wrappers with no messageId) resolve
 * to the first descendant leaf that carries one. No metadata list beyond the span
 * detail — the point is: click a span, read its message.
 */
export function TimelineMode({ trace }: { trace: Trace }) {
  const centerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Wide by default: the gantt bars are the point, so give them room (the name
  // column is compact). Key bumped to reset any stale narrow persisted width.
  const { width, startResize, reset } = useResizableWidth('timeline-v2', {
    default: 620,
    min: 340,
    max: 1000,
  })

  const { spans, derived, synthetic } = useMemo(() => buildSpanTree(trace), [trace])
  const root = useMemo(() => spans.find((s) => s.parentId === null) ?? spans[0], [spans])
  const units = useMemo(() => buildUnits(trace.messages), [trace.messages])
  const resultErrorByCallId = useMemo(() => buildResultErrorMap(trace.messages), [trace.messages])

  const spanById = useMemo(() => new Map(spans.map((s) => [s.id, s])), [spans])

  // messageId ('m-<idx>') → index of the render unit that message belongs to.
  const unitByMessageId = useMemo(() => {
    const map = new Map<string, number>()
    units.forEach((u, i) => {
      if (u.kind === 'step') for (const m of u.messages) map.set(m.id, i)
      else map.set(u.message.id, i)
    })
    return map
  }, [units])

  // parentId → children (startMs order), for descendant messageId resolution.
  const childrenById = useMemo(() => {
    const map = new Map<string, ProfSpan[]>()
    for (const s of spans) {
      if (s.parentId === null || s.parentId === s.id) continue
      const list = map.get(s.parentId)
      if (list) list.push(s)
      else map.set(s.parentId, [s])
    }
    for (const list of map.values()) list.sort((a, b) => a.startMs - b.startMs)
    return map
  }, [spans])

  // A span's message: its own messageId, else the first descendant (DFS, startMs
  // order) that links to a unit — so clicking a turn/root container still reads.
  const resolveMessageId = useCallback(
    (span: ProfSpan | undefined): string | undefined => {
      const visit = (s: ProfSpan): string | undefined => {
        if (s.messageId !== undefined && unitByMessageId.has(s.messageId)) return s.messageId
        for (const kid of childrenById.get(s.id) ?? []) {
          const found = visit(kid)
          if (found !== undefined) return found
        }
        return undefined
      }
      return span ? visit(span) : undefined
    },
    [childrenById, unitByMessageId],
  )

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const rows = useMemo(() => flattenVisible(spans, collapsed), [spans, collapsed])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = (selectedId !== null ? spanById.get(selectedId) : undefined) ?? root

  // Right-card expand overrides, keyed by unit id — everything defaults OPEN.
  const [stepOpen, setStepOpen] = useState<Map<string, boolean>>(new Map())
  const [reasoningOpen, setReasoningOpen] = useState<Map<string, boolean>>(new Map())
  const [foldOpen, setFoldOpen] = useState<Map<string, boolean>>(new Map())

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 16,
  })

  const currentRow = Math.max(
    0,
    rows.findIndex((r) => r.span.id === selected?.id),
  )

  const select = useCallback((id: string) => {
    setSelectedId(id)
    centerRef.current?.scrollTo(0, 0)
  }, [])

  const gotoRow = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(rows.length - 1, i))
      const row = rows[clamped]
      if (!row) return
      setSelectedId(row.span.id)
      centerRef.current?.scrollTo(0, 0)
      virtualizer.scrollToIndex(clamped, { align: 'auto' })
    },
    [rows, virtualizer],
  )

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        gotoRow(currentRow - 1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        gotoRow(currentRow + 1)
      }
    },
    [gotoRow, currentRow],
  )

  // Keep the selected row visible after keyboard navigation / tree changes.
  useEffect(() => {
    virtualizer.scrollToIndex(currentRow, { align: 'auto' })
  }, [currentRow, virtualizer])

  if (!root) {
    return (
      <div className="p-4">
        <EmptyState title="No spans to display for this trace" />
      </div>
    )
  }

  const totalMs = Math.max(root.startMs + root.durationMs, 1)
  const resolvedId = resolveMessageId(selected)
  const unitIndex = resolvedId !== undefined ? unitByMessageId.get(resolvedId) : undefined
  const unit = unitIndex !== undefined ? units[unitIndex] : undefined

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: focus target for ←/→ span navigation
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard nav wrapper; span rows are the accessible path
    <div data-testid="timeline-mode" className="flex h-full" onKeyDown={onKeyDown} tabIndex={0}>
      <div
        data-testid="timeline-mode-rail"
        style={{ width }}
        className="relative flex shrink-0 flex-col border-r border-slate-200 bg-white"
      >
        <div
          data-testid="pane-resize-timeline"
          aria-hidden="true"
          title="Drag to resize · double-click to reset"
          onPointerDown={startResize}
          onDoubleClick={reset}
          className="absolute top-0 right-0 z-10 h-full w-1.5 translate-x-1/2 cursor-col-resize touch-none hover:bg-blue-300"
        />
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-2 py-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
            timeline
          </span>
          {!synthetic && (
            <span className="font-mono text-[10px] text-slate-500">
              {formatDuration(root.durationMs)}
            </span>
          )}
          <span className="text-[10px] text-slate-400">{spans.length} spans</span>
          {synthetic ? (
            <span
              className="text-[10px] italic text-slate-400"
              title="no timing data in this trace"
            >
              order only · no timing
            </span>
          ) : (
            derived && <span className="text-[10px] italic text-slate-400">derived</span>
          )}
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              return (
                <div
                  key={row.span.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <SpanBar
                    row={row}
                    totalMs={totalMs}
                    isRoot={row.span.id === root.id}
                    synthetic={synthetic}
                    selected={selected?.id === row.span.id}
                    collapsed={collapsed.has(row.span.id)}
                    onSelect={() => select(row.span.id)}
                    onToggle={() => toggle(row.span.id)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div ref={centerRef} className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-3">
          <SpanDetailPanel
            span={selected}
            traceStartIso={trace.meta.timestamp}
            synthetic={synthetic}
          />
        </div>
        <div className="pb-4" data-testid="timeline-center">
          {unit === undefined ? (
            <div
              data-testid="timeline-no-message"
              className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-xs text-slate-400"
            >
              This span has no associated message.
            </div>
          ) : unit.kind === 'step' ? (
            <StepCard
              unit={unit}
              expanded={stepOpen.get(unit.id) ?? true}
              onToggle={() => setStepOpen((prev) => toggleIn(prev, unit.id, true))}
              reasoningOpen={reasoningOpen.get(unit.id) ?? true}
              onToggleReasoning={() => setReasoningOpen((prev) => toggleIn(prev, unit.id, true))}
              resultErrorByCallId={resultErrorByCallId}
            />
          ) : (
            <MessageCard
              message={unit.message}
              bodyExpanded={foldOpen.get(unit.id) ?? true}
              onToggleBody={() => setFoldOpen((prev) => toggleIn(prev, unit.id, true))}
            />
          )}
        </div>
      </div>
    </div>
  )
}
