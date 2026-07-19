import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '../common/format'
import { type RenderUnit, stepHasToolCalls, unitDurationMs } from './unitize'

type BarKind = 'user' | 'neutral' | 'toolCall' | 'toolResult' | 'toolError' | 'final'

// Mirrors the card colors for continuity.
function barKind(unit: RenderUnit): BarKind {
  if (unit.kind === 'step') return stepHasToolCalls(unit) ? 'toolCall' : 'final'
  const m = unit.message
  if (m.role === 'tool') return m.toolResult?.isError ? 'toolError' : 'toolResult'
  if (m.role === 'user') return 'user'
  return 'neutral' // system/developer
}

// Base (unfocused) and focused fills per kind.
const BAR: Record<BarKind, string> = {
  user: 'bg-blue-400',
  neutral: 'bg-slate-300',
  toolCall: 'bg-indigo-400',
  toolResult: 'bg-sky-300',
  toolError: 'bg-red-400',
  final: 'bg-emerald-400',
}
const BAR_FOCUS: Record<BarKind, string> = {
  user: 'bg-blue-600',
  neutral: 'bg-slate-500',
  toolCall: 'bg-indigo-600',
  toolResult: 'bg-sky-500',
  toolError: 'bg-red-600',
  final: 'bg-emerald-600',
}

function kindLabel(unit: RenderUnit): string {
  if (unit.kind === 'step') return stepHasToolCalls(unit) ? 'step (tools)' : 'step (final)'
  return unit.message.role
}

const SAMPLE_CAP = 400
const GAP = 1
const MIN_ROW = 4
const MAX_ROW = 14

function sampleIndices(count: number, cap: number): number[] {
  if (count <= cap) return Array.from({ length: count }, (_, i) => i)
  return Array.from({ length: cap }, (_, i) => Math.floor((i * count) / cap))
}

// Log-scaled so sub-second steps stay visible next to minute-long tool runs.
function widthPct(durationMs: number | undefined, maxMs: number): number {
  if (durationMs === undefined || durationMs <= 0 || maxMs <= 0) return 22
  return 22 + 78 * (Math.log10(durationMs + 1) / Math.log10(maxMs + 1))
}

/**
 * Right-edge vertical minimap: one fixed-height row per render unit in trace
 * order (same sequence + colors as the conversation), each row a horizontal bar
 * whose LENGTH encodes that unit's duration. The unit at the viewport center is
 * darkened + bordered; clicking a row scrolls to it.
 */
export function Minimap({
  units,
  totalDurationMs,
  scrollOffset,
  viewportHeight,
  totalSize,
  scrollMargin,
  onJump,
}: {
  units: RenderUnit[]
  totalDurationMs: number | undefined
  scrollOffset: number
  viewportHeight: number
  totalSize: number
  scrollMargin: number
  onJump: (index: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackHeight, setTrackHeight] = useState(0)

  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const update = () => setTrackHeight(el.clientHeight)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const sampled = useMemo(() => sampleIndices(units.length, SAMPLE_CAP), [units.length])
  const n = sampled.length
  const maxMs = useMemo(() => {
    let max = 0
    for (const u of units) {
      const d = unitDurationMs(u)
      if (d !== undefined && d > max) max = d
    }
    return max
  }, [units])

  // Even fixed row height that fills the track (clamped so it stays clickable).
  const rowHeight =
    n > 0 && trackHeight > 0
      ? Math.min(MAX_ROW, Math.max(MIN_ROW, Math.floor((trackHeight - (n - 1) * GAP) / n)))
      : MIN_ROW

  // Focus = viewport-center unit over the reachable scroll range (0 top … 1 end),
  // so the last unit is focused when scrolled to the very bottom.
  const maxScroll = Math.max(totalSize - viewportHeight, 1)
  const progress = Math.min(Math.max((scrollOffset - scrollMargin) / maxScroll, 0), 1)
  const focusedUnit = units.length > 0 ? Math.round(progress * (units.length - 1)) : 0
  const focusedIdx =
    n === units.length
      ? focusedUnit
      : Math.min(Math.floor((focusedUnit / units.length) * n), Math.max(n - 1, 0))

  return (
    <div
      data-testid="timeline-minimap"
      className="absolute top-2 right-3 bottom-20 z-10 flex w-28 flex-col"
    >
      <div className="mb-1 flex shrink-0 items-center justify-between px-0.5">
        <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">
          timeline
        </span>
        <span className="font-mono text-[8px] text-slate-500">
          {formatDuration(totalDurationMs)}
        </span>
      </div>
      <div className="min-h-0 flex-1 rounded-lg border border-slate-200/80 bg-slate-50 p-1">
        <div ref={trackRef} className="relative h-full">
          {sampled.map((index, i) => {
            const unit = units[index]
            const d = unitDurationMs(unit)
            const kind = barKind(unit)
            const focused = i === focusedIdx
            return (
              <button
                key={unit.id}
                type="button"
                onClick={() => onJump(index)}
                title={`#${index + 1} · ${kindLabel(unit)} · ${formatDuration(d)}`}
                aria-label={`Jump to unit ${index + 1}`}
                aria-current={focused ? 'true' : undefined}
                className="absolute inset-x-0 flex items-center"
                style={{ top: i * (rowHeight + GAP), height: rowHeight }}
              >
                <span
                  className={`block rounded-[2px] transition-colors ${
                    focused
                      ? `${BAR_FOCUS[kind]} opacity-100 ring-1 ring-slate-700`
                      : `${BAR[kind]} opacity-60`
                  }`}
                  style={{ width: `${widthPct(d, maxMs)}%`, height: Math.max(rowHeight - 1, 2) }}
                />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
