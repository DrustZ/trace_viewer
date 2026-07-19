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

/** Label ink per segment color: white on the saturated fills, slate on the light ones. */
const LABEL_INK: Record<BarKind, string> = {
  user: 'text-slate-700',
  neutral: 'text-slate-600',
  toolCall: 'text-white/90',
  toolResult: 'text-slate-700',
  toolError: 'text-white/90',
  final: 'text-white/90',
}

function kindLabel(unit: RenderUnit): string {
  if (unit.kind === 'step') return stepHasToolCalls(unit) ? 'step (tools)' : 'step (final)'
  return unit.message.role
}

const SAMPLE_CAP = 400
const GAP = 1
const MIN_SEG = 3
const LABEL_MIN_SEG = 12

function sampleIndices(count: number, cap: number): number[] {
  if (count <= cap) return Array.from({ length: count }, (_, i) => i)
  return Array.from({ length: cap }, (_, i) => Math.floor((i * count) / cap))
}

/**
 * Time-proportional vertical timeline pinned to the right edge of the
 * conversation scroll area. The strip always fills the available height;
 * each unit's segment height is its share of the total wall-clock time
 * (min 3px so instant steps stay visible), color = unit kind. A draggable
 * translucent overlay marks the visible window; clicking a segment jumps.
 */
export function Minimap({
  units,
  totalDurationMs,
  scrollOffset,
  viewportHeight,
  totalSize,
  scrollMargin,
  onJump,
  onScrollTo,
}: {
  units: RenderUnit[]
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
  const dragging = useRef(false)
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

  // Segment heights: proportional to each unit's share of total time, filling
  // the whole track. Min 3px keeps instant steps visible; a final scale pass
  // re-fits the clamped heights to the track exactly.
  const segHeights = useMemo(() => {
    if (n === 0 || trackHeight <= 0) return []
    const usable = Math.max(trackHeight - (n - 1) * GAP, n * MIN_SEG)
    const total = cumMs[units.length]
    let raw: number[]
    if (total > 0) {
      raw = sampled.map((index) => {
        const d = unitDurationMs(units[index]) ?? 0
        return Math.max(MIN_SEG, (d / total) * usable)
      })
    } else {
      raw = sampled.map(() => usable / n)
    }
    const sum = raw.reduce((a, b) => a + b, 0)
    const scale = usable / sum
    return raw.map((h) => Math.max(MIN_SEG, h * scale))
  }, [n, trackHeight, sampled, units, cumMs])

  const segTops = useMemo(() => {
    const tops = new Array<number>(segHeights.length + 1)
    tops[0] = 0
    for (let i = 0; i < segHeights.length; i++) tops[i + 1] = tops[i] + segHeights[i] + GAP
    return tops
  }, [segHeights])
  const blockHeight = segTops[segHeights.length] ?? 0

  // Visible window: unit range from content-scroll space, projected onto the
  // time-proportional segment pixels.
  const clampScroll = (v: number) => Math.min(Math.max(v, 0), totalSize)
  const winTop = clampScroll(scrollOffset - scrollMargin)
  const winBottom = clampScroll(scrollOffset - scrollMargin + viewportHeight)
  const firstIdx = totalSize > 0 ? Math.min(n - 1, Math.floor((winTop / totalSize) * n)) : 0
  const lastIdx =
    totalSize > 0 ? Math.min(n - 1, Math.ceil((winBottom / totalSize) * n) - 1) : n - 1
  const windowTop = segTops[Math.max(firstIdx, 0)] ?? 0
  const windowHeight = Math.max(
    (segTops[Math.max(lastIdx, 0)] ?? 0) + (segHeights[Math.max(lastIdx, 0)] ?? 0) - windowTop,
    8,
  )

  const yToIndex = (y: number): number => {
    for (let i = 0; i < segHeights.length; i++) {
      if (y < segTops[i + 1]) return i
    }
    return Math.max(segHeights.length - 1, 0)
  }

  const moveTooltip = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (rect) setDragY(Math.min(Math.max(clientY - rect.top, 0), blockHeight))
  }

  const onWindowPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    moveTooltip(e.clientY)
  }

  const onWindowPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || blockHeight <= 0 || n === 0) return
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const y = Math.min(Math.max(e.clientY - rect.top, 0), blockHeight)
    // Pointer position in segment space → unit index → content scroll offset,
    // centering the viewport on the pointed-at unit.
    const i = yToIndex(y)
    const target = ((i + 0.5) / n) * totalSize + scrollMargin - viewportHeight / 2
    onScrollTo(Math.max(target, 0))
    moveTooltip(e.clientY)
  }

  const onWindowPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false
    setDragY(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const tooltipLabel = (y: number): string => `+${formatDuration(cumMs[sampled[yToIndex(y)] ?? 0])}`

  return (
    <div
      data-testid="timeline-minimap"
      className="absolute top-2 right-1 bottom-2 z-10 flex w-9 flex-col"
    >
      <div
        className="shrink-0 pb-1 text-center font-mono text-[8px] leading-none text-slate-500"
        title="Total duration"
      >
        {formatDuration(totalDurationMs)}
      </div>
      <div className="min-h-0 flex-1 rounded-md border border-slate-200 bg-slate-100/60 p-1">
        <div ref={trackRef} className="relative h-full">
          {sampled.map((index, i) => {
            const unit = units[index]
            const d = unitDurationMs(unit)
            const kind = barKind(unit)
            const h = segHeights[i] ?? MIN_SEG
            const showLabel = d !== undefined && d > 0 && h >= LABEL_MIN_SEG
            return (
              <button
                key={unit.id}
                type="button"
                onClick={() => onJump(index)}
                title={`#${index + 1} · ${kindLabel(unit)} · ${formatDuration(d)}`}
                aria-label={`Jump to unit ${index + 1}`}
                className="absolute inset-x-0 block"
                style={{ top: segTops[i], height: h }}
              >
                <span
                  className={`block h-full w-full rounded-[1px] opacity-80 hover:opacity-100 ${BAR[kind]}`}
                />
                {showLabel && (
                  <span
                    className={`pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[8px] leading-none ${LABEL_INK[kind]}`}
                  >
                    {formatDuration(d)}
                  </span>
                )}
              </button>
            )
          })}
          <div
            data-testid="minimap-window"
            onPointerDown={onWindowPointerDown}
            onPointerMove={onWindowPointerMove}
            onPointerUp={onWindowPointerEnd}
            onPointerCancel={onWindowPointerEnd}
            className={`absolute inset-x-0 touch-none rounded border border-slate-500/50 bg-slate-500/25 ${
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
