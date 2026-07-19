import type { Message } from '@shared/schema/types'
import { useMemo } from 'react'
import { formatDuration } from '../common/format'

type RailKind = 'neutral' | 'reasoning' | 'toolCall' | 'toolResult' | 'toolError' | 'final'

// Mirrors MessageCard's kind buckets for color continuity (T1 must not edit that file).
function railKind(message: Message): RailKind {
  switch (message.role) {
    case 'user':
    case 'system':
    case 'developer':
      return 'neutral'
    case 'tool':
      return message.toolResult?.isError ? 'toolError' : 'toolResult'
    default: {
      if ((message.channel ?? 'final') === 'analysis') return 'reasoning'
      if (message.toolCalls?.length) return 'toolCall'
      return 'final'
    }
  }
}

const BAR: Record<RailKind, string> = {
  neutral: 'bg-slate-300',
  reasoning: 'bg-violet-300',
  toolCall: 'bg-indigo-300',
  toolResult: 'bg-cyan-400',
  toolError: 'bg-red-400',
  final: 'bg-emerald-400',
}

// Log scale keeps sub-second generation steps visible next to minute-long tool runs.
function widthPct(durationMs: number, maxDurationMs: number): number {
  if (maxDurationMs <= 0) return 0
  return (Math.log10(durationMs + 1) / Math.log10(maxDurationMs + 1)) * 100
}

/** Per-row rail cell: duration bar + label, physically aligned with its message card. */
export function TimelineRailCell({
  message,
  maxDurationMs,
}: {
  message: Message
  maxDurationMs: number
}) {
  const d = message.durationMs
  return (
    <div className="w-[200px] pt-4 pr-1 pl-3">
      <div className="flex items-center gap-1.5">
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-sm bg-slate-100">
          {d !== undefined && (
            <div
              className={`h-full rounded-sm ${BAR[railKind(message)]}`}
              style={{ width: `${widthPct(d, maxDurationMs)}%`, minWidth: 2 }}
            />
          )}
        </div>
        <span className="w-11 shrink-0 text-right text-[10px] text-slate-400">
          {formatDuration(d)}
        </span>
      </div>
    </div>
  )
}

const MINIMAP_CAP = 120

function sampleIndices(count: number, cap: number): number[] {
  if (count <= cap) return Array.from({ length: count }, (_, i) => i)
  return Array.from({ length: cap }, (_, i) => Math.floor((i * count) / cap))
}

/** Rail top: total duration + clickable per-message minimap. Sticky in the scroll container. */
export function TimelineRailHeader({
  messages,
  maxDurationMs,
  totalDurationMs,
  onJump,
}: {
  messages: Message[]
  maxDurationMs: number
  totalDurationMs: number | undefined
  onJump: (index: number) => void
}) {
  const sampled = useMemo(() => sampleIndices(messages.length, MINIMAP_CAP), [messages.length])
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
          Total
        </span>
        <span className="text-[10px] font-medium text-slate-600">
          {formatDuration(totalDurationMs)}
        </span>
      </div>
      <div data-testid="timeline-minimap" className="mt-1.5 max-h-60 overflow-y-auto">
        {sampled.map((index) => {
          const m = messages[index]
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onJump(index)}
              title={`#${index + 1} · ${formatDuration(m.durationMs)}`}
              aria-label={`Jump to message ${index + 1}`}
              className="block h-[3px] w-full hover:bg-slate-100"
            >
              <span
                className={`block h-full ${BAR[railKind(m)]}`}
                style={{ width: `${widthPct(m.durationMs ?? 0, maxDurationMs)}%`, minWidth: 2 }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
