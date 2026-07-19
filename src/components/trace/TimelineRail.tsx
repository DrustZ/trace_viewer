import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '../common/format'
import { type RenderUnit, stepHasToolCalls, unitDurationMs } from './unitize'

type BarKind = 'user' | 'neutral' | 'toolCall' | 'toolResult' | 'toolError' | 'final'

// Mirrors the card colors for continuity: assistant reads green like the cards.
function barKind(unit: RenderUnit): BarKind {
  if (unit.kind === 'step') return 'final'
  const m = unit.message
  if (m.role === 'tool') return m.toolResult?.isError ? 'toolError' : 'toolResult'
  if (m.role === 'user') return 'user'
  return 'neutral' // system/developer
}

const BAR: Record<BarKind, string> = {
  user: 'bg-blue-400',
  neutral: 'bg-slate-200',
  toolCall: 'bg-emerald-400',
  toolResult: 'bg-sky-300',
  toolError: 'bg-red-400',
  final: 'bg-emerald-400',
}

/** Label ink per segment color: readable on each fill. */
const LABEL_INK: Record<BarKind, string> = {
  user: 'text-blue-950/70',
  neutral: 'text-slate-500',
  toolCall: 'text-emerald-950/70',
  toolResult: 'text-sky-950/70',
  toolError: 'text-white/90',
  final: 'text-emerald-950/70',
}

function kindLabel(unit: RenderUnit): string {
  if (unit.kind === 'step') return stepHasToolCalls(unit) ? 'step (tools)' : 'step (final)'
  return unit.message.role
}

const SAMPLE_CAP = 400
const GAP = 1
/** Every segment stays clickable; no single segment swallows the track. */
const MIN_SEG = 6
const MAX_SEG_SHARE = 0.35
const LABEL_MIN_SEG = 14

function sampleIndices(count: number, cap: number): number[] {
  if (count <= cap) return Array.from({ length: count }, (_, i) => i)
  return Array.from({ length: cap }, (_, i) => Math.floor((i * count) / cap))
}

/**
 * Time-proportional vertical timeline beside the conversation. The strip fills
 * the available height; each unit's segment height is its share of total
 * wall-clock time (clamped to [6px, 35% of track] so everything stays
 * clickable and nothing swallows the strip), color = unit kind. The unit at
 * the viewport center gets a dock-style zoom + ring instead of a scroll thumb
 * (a thumb lies once segments are time-proportional while scrolling is
 * content-proportional). Clicking a segment jumps to its unit.
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
  /** Virtualizer scrollOffset (px, from the top of the scroll container). */
  scrollOffset: number
  /** Scroll container clientHeight (px). */
  viewportHeight: number
  /** Virtualizer total list size (px). */
  totalSize: number
  /** Virtualizer scrollMargin — list offset inside the scroll container (px). */
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

  const cumMs = useMemo(() => {
    const out = new Array<number>(units.length + 1)
    out[0] = 0
    for (let i = 0; i < units.length; i++) out[i + 1] = out[i] + (unitDurationMs(units[i]) ?? 0)
    return out
  }, [units])

  // Segment heights: proportional to time share, clamped, re-fit to the track.
  const segHeights = useMemo(() => {
    if (n === 0 || trackHeight <= 0) return []
    const usable = Math.max(trackHeight - (n - 1) * GAP, n * MIN_SEG)
    const total = cumMs[units.length]
    let raw: number[]
    if (total > 0) {
      raw = sampled.map((index) => {
        const d = unitDurationMs(units[index]) ?? 0
        return Math.min(Math.max(MIN_SEG, (d / total) * usable), usable * MAX_SEG_SHARE)
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

  // Dock-style focus: the unit at the viewport center, mapped through sampling.
  const centerPx = scrollOffset - scrollMargin + viewportHeight / 2
  const focusedUnit =
    totalSize > 0 && units.length > 0
      ? Math.min(Math.max(Math.floor((centerPx / totalSize) * units.length), 0), units.length - 1)
      : 0
  const focusedIdx =
    n === units.length
      ? focusedUnit
      : Math.min(Math.floor((focusedUnit / units.length) * n), Math.max(n - 1, 0))

  return (
    <div
      data-testid="timeline-minimap"
      className="absolute top-2 right-3 bottom-20 z-10 flex w-6 flex-col"
    >
      <div
        className="shrink-0 pb-1 text-center font-mono text-[8px] leading-none text-slate-500"
        title="Total duration"
      >
        {formatDuration(totalDurationMs)}
      </div>
      <div className="min-h-0 flex-1 rounded-lg border border-slate-200/80 bg-slate-50 p-0.5">
        <div ref={trackRef} className="relative h-full">
          {sampled.map((index, i) => {
            const unit = units[index]
            const d = unitDurationMs(unit)
            const kind = barKind(unit)
            const h = segHeights[i] ?? MIN_SEG
            const focused = i === focusedIdx
            const showLabel = d !== undefined && d > 0 && h >= LABEL_MIN_SEG
            return (
              <button
                key={unit.id}
                type="button"
                onClick={() => onJump(index)}
                title={`#${index + 1} · ${kindLabel(unit)} · ${formatDuration(d)}`}
                aria-label={`Jump to unit ${index + 1}`}
                aria-current={focused ? 'true' : undefined}
                className={`absolute inset-x-0 block ${focused ? 'z-10' : ''}`}
                style={{ top: segTops[i], height: h }}
              >
                <span
                  className={`block h-full w-full rounded-[3px] transition-all duration-150 hover:opacity-100 ${BAR[kind]} ${
                    focused ? 'scale-x-[1.6] opacity-100 ring-1 ring-slate-500/50' : 'opacity-75'
                  }`}
                  style={focused ? { transformOrigin: 'right' } : undefined}
                />
                {showLabel && (
                  <span
                    className={`pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[7px] leading-none ${LABEL_INK[kind]}`}
                  >
                    {formatDuration(d)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
