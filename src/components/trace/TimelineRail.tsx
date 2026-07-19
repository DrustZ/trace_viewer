import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '../common/format'
import { type RenderUnit, stepHasToolCalls, unitDurationMs } from './unitize'

type BarKind = 'user' | 'neutral' | 'toolCall' | 'toolResult' | 'toolError' | 'final'

// Mirrors the card colors for continuity: a step's bar takes the color of its
// response (indigo when it calls tools, emerald for a final answer).
function barKind(unit: RenderUnit): BarKind {
  if (unit.kind === 'step') return stepHasToolCalls(unit) ? 'toolCall' : 'final'
  const m = unit.message
  if (m.role === 'tool') return m.toolResult?.isError ? 'toolError' : 'toolResult'
  if (m.role === 'user') return 'user'
  return 'neutral' // system/developer
}

const BAR: Record<BarKind, string> = {
  user: 'bg-blue-400',
  neutral: 'bg-slate-300',
  toolCall: 'bg-indigo-500',
  toolResult: 'bg-cyan-400',
  toolError: 'bg-red-400',
  final: 'bg-emerald-500',
}

function kindLabel(unit: RenderUnit): string {
  if (unit.kind === 'step') return stepHasToolCalls(unit) ? 'step (tools)' : 'step (final)'
  return unit.message.role
}

// Log scale keeps sub-second generation steps visible next to minute-long tool runs.
function durationFrac(durationMs: number | undefined, maxDurationMs: number): number {
  if (durationMs === undefined || durationMs <= 0 || maxDurationMs <= 0) return 0
  return Math.log10(durationMs + 1) / Math.log10(maxDurationMs + 1)
}

const SAMPLE_CAP = 400
const GAP = 1
const MIN_BAR = 2
const MAX_BAR = 8
/** Bars at max height fit the 8px label; below that the text would clip. */
const LABEL_MIN_BAR = 8

function sampleIndices(count: number, cap: number): number[] {
  if (count <= cap) return Array.from({ length: count }, (_, i) => i)
  return Array.from({ length: cap }, (_, i) => Math.floor((i * count) / cap))
}

/**
 * Editor-style vertical minimap pinned to the right edge of the conversation
 * scroll area: one thin horizontal bar per render unit (color = kind,
 * width/opacity = log-scaled duration) stacked from the top, a draggable
 * translucent overlay marking the visible window, and click-to-jump on bars.
 */
export function Minimap({
  units,
  maxDurationMs,
  totalDurationMs,
  scrollOffset,
  viewportHeight,
  totalSize,
  scrollMargin,
  onJump,
  onScrollTo,
}: {
  units: RenderUnit[]
  maxDurationMs: number
  totalDurationMs: number | undefined
  /** Virtualizer scrollOffset (px, from the top of the scroll container). */
  scrollOffset: number
  /** Scroll container clientHeight (px). */
  viewportHeight: number
  /** Virtualizer total list size (px). */
  totalSize: number
  /** Virtualizer scrollMargin — list offset inside the scroll container (px). */
  scrollMargin: number
  onJump: (index: number) => void
  /** Scrolls the conversation container to the given scrollTop (px). */
  onScrollTo: (offset: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackHeight, setTrackHeight] = useState(0)
  // Pointer-capture drag on the window overlay; tooltip follows the cursor.
  const dragStart = useRef<{ pointerY: number; scrollOffset: number } | null>(null)
  const [dragY, setDragY] = useState<number | null>(null)

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

  // Cumulative duration before each unit — drives the drag tooltip ('+42s').
  const cumMs = useMemo(() => {
    const out = new Array<number>(units.length + 1)
    out[0] = 0
    for (let i = 0; i < units.length; i++) out[i + 1] = out[i] + (unitDurationMs(units[i]) ?? 0)
    return out
  }, [units])
  const hasDurations = cumMs[units.length] > 0

  // Bars stack from the top: with few units the map is a compact block, not
  // full-height chunks. Heights clamp to [2px, 8px] with a 1px gap.
  const barHeight =
    n > 0 && trackHeight > 0
      ? Math.min(MAX_BAR, Math.max(MIN_BAR, Math.floor((trackHeight - (n - 1) * GAP) / n)))
      : MIN_BAR
  const blockHeight = n > 0 ? n * barHeight + (n - 1) * GAP : 0

  // Map the visible pixel window onto the top-stacked bar block.
  const clampScroll = (v: number) => Math.min(Math.max(v, 0), totalSize)
  const winTop = clampScroll(scrollOffset - scrollMargin)
  const winBottom = clampScroll(scrollOffset - scrollMargin + viewportHeight)
  const windowHeight =
    totalSize > 0 ? Math.max(((winBottom - winTop) / totalSize) * blockHeight, 6) : blockHeight
  const windowTop =
    totalSize > 0
      ? Math.min((winTop / totalSize) * blockHeight, Math.max(blockHeight - windowHeight, 0))
      : 0

  const tooltipLabel = (y: number): string => {
    const i = Math.min(Math.max(Math.floor(y / (barHeight + GAP)), 0), n - 1)
    return `+${formatDuration(cumMs[sampled[i] ?? 0])}`
  }

  const moveTooltip = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (rect) setDragY(Math.min(Math.max(clientY - rect.top, 0), blockHeight))
  }

  const onWindowPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = { pointerY: e.clientY, scrollOffset }
    moveTooltip(e.clientY)
  }

  const onWindowPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    if (!start || blockHeight <= 0) return
    // dy in minimap-space → scroll offset (scale = total scroll size / map block px).
    const dy = e.clientY - start.pointerY
    onScrollTo(start.scrollOffset + dy * (totalSize / blockHeight))
    moveTooltip(e.clientY)
  }

  const onWindowPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = null
    setDragY(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      data-testid="timeline-minimap"
      className="absolute top-2 right-1 bottom-2 z-10 flex w-8 flex-col"
    >
      <div
        className="shrink-0 pb-1 text-center font-mono text-[8px] leading-none text-slate-500"
        title="Total duration"
      >
        {formatDuration(totalDurationMs)}
      </div>
      <div className="min-h-0 flex-1 rounded-md border border-slate-200 bg-slate-100/60 p-1">
        <div ref={trackRef} className="relative h-full">
          <div className="flex flex-col gap-px">
            {sampled.map((index) => {
              const unit = units[index]
              const d = unitDurationMs(unit)
              const frac = durationFrac(d, maxDurationMs)
              const showLabel = d !== undefined && d > 0 && barHeight >= LABEL_MIN_BAR
              return (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => onJump(index)}
                  title={`#${index + 1} · ${kindLabel(unit)} · ${formatDuration(d)}`}
                  aria-label={`Jump to unit ${index + 1}`}
                  className="relative block w-full shrink-0"
                  style={{ height: barHeight }}
                >
                  <span
                    className={`block h-full rounded-[1px] hover:opacity-100 ${BAR[barKind(unit)]}`}
                    style={{ width: `${30 + 70 * frac}%`, opacity: 0.45 + 0.55 * frac }}
                  />
                  {showLabel && (
                    <span
                      className={`pointer-events-none absolute inset-y-0 right-px flex items-center font-mono text-[8px] leading-none ${
                        frac > 0.55 ? 'text-white/90' : 'text-slate-600'
                      }`}
                    >
                      {formatDuration(d)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div
            data-testid="minimap-window"
            onPointerDown={onWindowPointerDown}
            onPointerMove={onWindowPointerMove}
            onPointerUp={onWindowPointerEnd}
            onPointerCancel={onWindowPointerEnd}
            className={`absolute inset-x-0 touch-none rounded border border-slate-400/40 bg-slate-500/25 ${
              dragY !== null ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            style={{ top: windowTop, height: windowHeight }}
          />
          {dragY !== null && hasDurations && (
            <div
              className="pointer-events-none absolute right-full z-20 mr-1.5 -translate-y-1/2 whitespace-nowrap rounded bg-slate-800 px-1 py-0.5 font-mono text-[9px] leading-none text-white shadow-sm"
              style={{ top: dragY }}
            >
              {tooltipLabel(dragY)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
