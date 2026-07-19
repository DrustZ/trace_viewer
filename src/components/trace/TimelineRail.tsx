import { useMemo } from 'react'
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

function sampleIndices(count: number, cap: number): number[] {
  if (count <= cap) return Array.from({ length: count }, (_, i) => i)
  return Array.from({ length: cap }, (_, i) => Math.floor((i * count) / cap))
}

/**
 * Vertical minimap slider pinned to the right edge of the conversation scroll
 * area: one horizontal bar per render unit (color = kind, width/opacity =
 * log-scaled duration), a translucent overlay marking the visible window, and
 * click-to-jump. Bars stack to fill the strip's height exactly.
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
}) {
  const sampled = useMemo(() => sampleIndices(units.length, SAMPLE_CAP), [units.length])

  // Map the visible pixel window onto unit-index space (linear over list height).
  const clamp = (v: number) => Math.min(Math.max(v, 0), totalSize)
  const winTop = clamp(scrollOffset - scrollMargin)
  const winBottom = clamp(scrollOffset - scrollMargin + viewportHeight)
  const topPct = totalSize > 0 ? (winTop / totalSize) * 100 : 0
  const heightPct = totalSize > 0 ? ((winBottom - winTop) / totalSize) * 100 : 0

  return (
    <div
      data-testid="timeline-minimap"
      className="absolute top-2 right-1 bottom-2 z-10 flex w-[64px] flex-col rounded-md border border-slate-200 bg-white/95 shadow-sm"
    >
      <div
        className="shrink-0 border-b border-slate-100 px-1 py-0.5 text-center font-mono text-[9px] text-slate-500"
        title="Total duration"
      >
        {formatDuration(totalDurationMs)}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden p-1">
        <div className="flex h-full flex-col gap-[1px]">
          {sampled.map((index) => {
            const unit = units[index]
            const d = unitDurationMs(unit)
            const frac = durationFrac(d, maxDurationMs)
            return (
              <button
                key={unit.id}
                type="button"
                onClick={() => onJump(index)}
                title={`#${index + 1} · ${kindLabel(unit)} · ${formatDuration(d)}`}
                aria-label={`Jump to unit ${index + 1}`}
                className="min-h-[2px] w-full flex-1"
              >
                <span
                  className={`block h-full rounded-[1px] ${BAR[barKind(unit)]}`}
                  style={{ width: `${25 + 75 * frac}%`, opacity: 0.45 + 0.55 * frac }}
                />
              </button>
            )
          })}
        </div>
        <div
          data-testid="minimap-window"
          className="pointer-events-none absolute inset-x-0 rounded bg-slate-500/20"
          style={{ top: `${topPct}%`, height: `${Math.max(heightPct, 1.5)}%` }}
        />
      </div>
    </div>
  )
}
