import { useEffect, useState } from 'react'

const DEBOUNCE_MS = 250

export type LogprobMode = 'off' | 'tokens' | 'probs'

const LOGPROB_OPTIONS: ReadonlyArray<{ value: LogprobMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'tokens', label: 'Tokens' },
  { value: 'probs', label: 'Probs' },
]

function ToggleButton({
  pressed,
  onClick,
  testId,
  children,
}: {
  pressed: boolean
  onClick: () => void
  testId: string
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      className={`h-7 rounded border px-2 text-xs font-medium transition-colors ${
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
  children,
}: {
  onClick: () => void
  testId: string
  children: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
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
  logprobMode,
  onLogprobModeChange,
  timelineOpen,
  onToggleTimeline,
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
  logprobMode: LogprobMode
  onLogprobModeChange: (mode: LogprobMode) => void
  timelineOpen: boolean
  onToggleTimeline: () => void
}) {
  const [value, setValue] = useState('')

  useEffect(() => {
    const t = setTimeout(() => onQueryChange(value), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value, onQueryChange])

  const navCls =
    'h-7 w-7 rounded border border-slate-200 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40'

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
          className="h-7 w-64 max-w-full rounded border border-slate-200 px-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
        />
        {value !== '' && (
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
        <ActionButton onClick={onExpandAll} testId="expand-all">
          Expand all
        </ActionButton>
        <ActionButton onClick={onCollapseAll} testId="collapse-all">
          Collapse all
        </ActionButton>
        <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden="true" />
        <div
          data-testid="logprob-mode"
          className="flex h-7 items-stretch overflow-hidden rounded border border-slate-200 bg-white"
        >
          <span className="flex items-center pr-1 pl-2 text-xs font-medium text-slate-400">
            LP:
          </span>
          {LOGPROB_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={logprobMode === value}
              data-testid={`logprob-mode-${value}`}
              onClick={() => onLogprobModeChange(value)}
              className={`px-2 text-xs font-medium transition-colors ${
                logprobMode === value
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <ToggleButton pressed={timelineOpen} onClick={onToggleTimeline} testId="toggle-timeline">
          Timeline
        </ToggleButton>
      </div>
    </div>
  )
}
