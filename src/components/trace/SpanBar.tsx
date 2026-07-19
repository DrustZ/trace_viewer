import { formatDuration } from '../common/format'
import type { SpanKind, SpanRow } from './profSpans'

const KIND_TEXT: Record<SpanKind, string> = {
  trace: 'text-blue-600',
  io: 'text-slate-500',
  model: 'text-violet-600',
  sandbox: 'text-orange-600',
  grader: 'text-emerald-600',
}

const KIND_BAR: Record<SpanKind, string> = {
  trace: 'bg-blue-400',
  io: 'bg-slate-400',
  model: 'bg-violet-400',
  sandbox: 'bg-orange-400',
  grader: 'bg-emerald-400',
}

/** Indent per tree level, px. */
const INDENT = 12
/** Row horizontal padding (matches px-2), px. */
const PAD_X = 8

/** Vertical gridlines at 25/50/75% of the shared axis. */
export function AxisGrid() {
  return (
    <>
      {[25, 50, 75].map((pct) => (
        <div
          key={pct}
          className="absolute inset-y-0 border-l border-slate-100"
          style={{ left: `${pct}%` }}
        />
      ))}
    </>
  )
}

/** One span row: indented name + kind label, proportional gantt bar, duration + status dot. */
export function SpanBar({
  row,
  totalMs,
  isRoot,
  selected,
  collapsed,
  onSelect,
  onToggle,
}: {
  row: SpanRow
  totalMs: number
  isRoot: boolean
  selected: boolean
  collapsed: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  const { span, depth, hasChildren } = row
  const left = Math.min((span.startMs / totalMs) * 100, 100)
  const width = Math.max(Math.min((span.durationMs / totalMs) * 100, 100 - left), 0)
  return (
    <div className="relative border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        data-testid="span-row"
        aria-pressed={selected}
        onClick={onSelect}
        className={`flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left ${
          selected ? 'bg-blue-50' : 'hover:bg-slate-50'
        }`}
      >
        {/* Compact name column so the gantt bar (the point of this view) dominates.
            kind is a small inline prefix rather than a second line. */}
        <div className="w-36 min-w-0 shrink-0" style={{ paddingLeft: depth * INDENT + 16 }}>
          <div className="truncate text-xs font-medium text-slate-800" title={span.name}>
            {span.name}
          </div>
          <div className={`text-[9px] uppercase tracking-wide ${KIND_TEXT[span.kind]}`}>
            {span.kind}
          </div>
        </div>
        <div className="relative h-7 min-w-0 flex-1">
          <AxisGrid />
          <div
            className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm ${
              isRoot ? 'bg-blue-500' : KIND_BAR[span.kind]
            }`}
            style={{ left: `${left}%`, width: `max(2px, ${width}%)` }}
          />
        </div>
        <div className="flex w-20 shrink-0 items-center justify-end gap-1.5">
          <span className="font-mono text-[10px] text-slate-500">
            {formatDuration(span.durationMs)}
          </span>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              span.status === 'error' ? 'bg-red-500' : 'bg-emerald-500'
            }`}
          />
        </div>
      </button>
      {hasChildren && (
        <button
          type="button"
          data-testid="span-toggle"
          aria-label={collapsed ? 'Expand span' : 'Collapse span'}
          onClick={onToggle}
          className="absolute top-1/2 w-4 -translate-y-1/2 text-center text-[10px] text-slate-400 hover:text-slate-700"
          style={{ left: PAD_X + depth * INDENT }}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      )}
    </div>
  )
}
