import { useEffect, useState } from 'react'

const DEBOUNCE_MS = 250

function ToggleButton({
  pressed,
  onClick,
  testId,
  disabled = false,
  children,
}: {
  pressed: boolean
  onClick: () => void
  testId: string
  disabled?: boolean
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`h-7 rounded border px-2 text-xs font-medium transition-colors disabled:opacity-40 ${
        pressed
          ? 'border-slate-700 bg-slate-800 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

function ActionButton({
  onClick,
  testId,
  disabled = false,
  children,
}: {
  onClick: () => void
  testId: string
  disabled?: boolean
  children: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** Slim non-scrolling bar above the message list: in-trace search + view toggles. */
export function ConversationToolbar({
  onQueryChange,
  matchCount,
  matchPos,
  onPrevMatch,
  onNextMatch,
  onExpandAll,
  onCollapseAll,
  timelineOpen,
  onToggleTimeline,
  timelineAvailable = true,
  compact,
  onToggleCompact,
}: {
  /** Receives the debounced query; must be referentially stable (e.g. a setState). */
  onQueryChange: (query: string) => void
  matchCount: number
  /** 0-based index of the current match. */
  matchPos: number
  onPrevMatch: () => void
  onNextMatch: () => void
  /** Expands every step card and system/developer fold; leaves reasoning widgets as they are. */
  onExpandAll: () => void
  /** Collapses every step card and system/developer fold, and closes all reasoning widgets. */
  onCollapseAll: () => void
  timelineOpen: boolean
  onToggleTimeline: () => void
  /** Whether the trace has real timing (spans or message timestamps); hides Timeline when not. */
  timelineAvailable?: boolean
  /** Compact three-pane reading mode; search/expand/timeline controls are disabled while on. */
  compact: boolean
  onToggleCompact: () => void
}) {
  const [value, setValue] = useState('')

  useEffect(() => {
    const t = setTimeout(() => onQueryChange(value), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value, onQueryChange])

  const navCls =
    'h-7 w-7 rounded border border-slate-200 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40'

  // Both focus modes replace the searchable virtualized list, so search + expand
  // controls are inert there.
  const busy = compact || timelineOpen

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (e.shiftKey) onPrevMatch()
            else onNextMatch()
          }}
          placeholder="Search in trace…"
          data-testid="trace-search"
          disabled={busy}
          title={busy ? 'Search is unavailable in this view' : undefined}
          className="h-7 w-64 max-w-full rounded border border-slate-200 px-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none disabled:bg-slate-50 disabled:opacity-50"
        />
        {value !== '' && !busy && (
          <>
            <span
              data-testid="search-count"
              className="font-mono text-[11px] text-slate-500 tabular-nums"
            >
              {matchCount === 0 ? '0/0' : `${matchPos + 1}/${matchCount}`}
            </span>
            <button
              type="button"
              onClick={onPrevMatch}
              disabled={matchCount === 0}
              aria-label="Previous match"
              data-testid="search-prev"
              className={navCls}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={onNextMatch}
              disabled={matchCount === 0}
              aria-label="Next match"
              data-testid="search-next"
              className={navCls}
            >
              ↓
            </button>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <ActionButton onClick={onExpandAll} testId="expand-all" disabled={busy}>
          Expand all
        </ActionButton>
        <ActionButton onClick={onCollapseAll} testId="collapse-all" disabled={busy}>
          Collapse all
        </ActionButton>
        <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden="true" />
        {timelineAvailable && (
          <ToggleButton
            pressed={timelineOpen}
            onClick={onToggleTimeline}
            testId="toggle-timeline"
            disabled={compact}
          >
            Timeline
          </ToggleButton>
        )}
        <ToggleButton
          pressed={compact}
          onClick={onToggleCompact}
          testId="toggle-compact"
          disabled={timelineOpen}
        >
          Compact
        </ToggleButton>
      </div>
    </div>
  )
}
