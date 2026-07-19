import { useMemo } from 'react'
import { formatDuration } from '../common/format'
import { type RenderUnit, stepHasToolCalls, unitDurationMs } from './unitize'

type BarKind = 'user' | 'neutral' | 'toolCall' | 'toolResult' | 'toolError' | 'final'

// Mirrors the card colors for continuity: assistant reads green like the cards,
// indigo once a step fires tools.
function barKind(unit: RenderUnit): BarKind {
  if (unit.kind === 'step') return stepHasToolCalls(unit) ? 'toolCall' : 'final'
  const m = unit.message
  if (m.role === 'tool') return m.toolResult?.isError ? 'toolError' : 'toolResult'
  if (m.role === 'user') return 'user'
  return 'neutral' // system/developer
}

/** Resting fill per kind — dimmed to opacity-60 in the strip. */
const BAR: Record<BarKind, string> = {
  user: 'bg-blue-400',
  neutral: 'bg-slate-300',
  toolCall: 'bg-indigo-400',
  toolResult: 'bg-sky-300',
  toolError: 'bg-red-400',
  final: 'bg-emerald-400',
}

/** Focused fill: a darker shade at full opacity so the current unit pops. */
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
/** Log-scaled duration keeps big gaps legible; this is the floor so nothing vanishes. */
const MIN_SEG = 4

function sampleIndices(count: number, cap: number): number[] {
  if (count <= cap) return Array.from({ length: count }, (_, i) => i)
  return Array.from({ length: cap }, (_, i) => Math.floor((i * count) / cap))
}

/**
 * Horizontal time strip sitting sticky at the top of the conversation scroll
 * area. One segment per render unit, left→right in trace order; segment width is
 * its log-scaled share of total wall-clock time (min 4px so everything stays
 * clickable), color = unit kind. The unit at the viewport center is the focus:
 * darkened + a slate-700 ring instead of a scroll thumb (a thumb lies once
 * segments are time-proportional while scrolling is content-proportional).
 * Clicking a segment jumps to its unit.
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
  const sampled = useMemo(() => sampleIndices(units.length, SAMPLE_CAP), [units.length])
  const n = sampled.length

  // Log-scaled duration weights drive flex-grow; 0-duration units fall back to
  // their MIN_SEG floor. When no duration is known, everything shares equally.
  const weights = useMemo(
    () =>
      sampled.map((index) => {
        const d = unitDurationMs(units[index]) ?? 0
        return d > 0 ? Math.log1p(d) : 0
      }),
    [sampled, units],
  )
  const anyWeight = weights.some((w) => w > 0)

  // Focus mapped over the REACHABLE scroll range (0 = top, 1 = end), so the last
  // unit gets focus at the bottom — the viewport center alone never reaches the
  // end of the content.
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
      className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-slate-200 border-b bg-white/95 px-2 py-1 backdrop-blur-sm"
    >
      <div className="flex min-w-0 flex-1 items-stretch gap-px overflow-hidden">
        {sampled.map((index, i) => {
          const unit = units[index]
          const d = unitDurationMs(unit)
          const kind = barKind(unit)
          const focused = i === focusedIdx
          return (
            <button
              key={unit.id}
              type="button"
              data-testid={`timeline-seg-${index}`}
              onClick={() => onJump(index)}
              title={`#${index + 1} · ${kindLabel(unit)} · ${formatDuration(d)}`}
              aria-label={`Jump to unit ${index + 1}`}
              aria-current={focused ? 'true' : undefined}
              className={`h-7 rounded-[2px] transition-opacity hover:opacity-100 ${
                focused
                  ? `${BAR_FOCUS[kind]} opacity-100 ring-[1.5px] ring-slate-700`
                  : `${BAR[kind]} opacity-60`
              }`}
              style={{ flexGrow: anyWeight ? weights[i] : 1, flexBasis: 0, minWidth: MIN_SEG }}
            />
          )
        })}
      </div>
      <div className="shrink-0 font-mono text-[10px] text-slate-500" title="Total duration">
        {formatDuration(totalDurationMs)}
      </div>
    </div>
  )
}
