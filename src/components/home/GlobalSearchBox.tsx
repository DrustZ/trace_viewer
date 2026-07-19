import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSearch } from '../../api/hooks'
import { ScoreBadge } from '../common/ScoreBadge'

const MAX_HITS = 12
const DEBOUNCE_MS = 300

/** Wraps case-insensitive matches of q in the snippet with an amber highlight. */
function Snippet({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase()
  if (needle === '') return <>{text}</>
  const lower = text.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  while (cursor < text.length) {
    const idx = lower.indexOf(needle, cursor)
    if (idx === -1) {
      parts.push(text.slice(cursor))
      break
    }
    if (idx > cursor) parts.push(text.slice(cursor, idx))
    const match = text.slice(idx, idx + needle.length)
    parts.push(
      <span key={`${idx}-${match}`} className="font-medium text-amber-700">
        {match}
      </span>,
    )
    cursor = idx + needle.length
  }
  return <>{parts}</>
}

export function GlobalSearchBox() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [, setSearchParams] = useSearchParams()

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [q])

  const search = useSearch(debounced)
  const hits = (search.data ?? []).slice(0, MAX_HITS)
  const showPanel = open && debounced.length >= 2

  const selectHit = (traceId: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('peek', traceId)
        return next
      },
      { replace: true },
    )
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus-tracking wrapper, not interactive
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <input
        ref={inputRef}
        type="search"
        data-testid="global-search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            e.currentTarget.blur()
          }
        }}
        placeholder="Search traces…"
        className="w-56 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      {showPanel && (
        <div className="absolute right-0 top-full z-40 mt-1 max-h-96 w-[28rem] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">
              {search.isFetching ? 'Searching…' : 'No matches'}
            </p>
          ) : (
            hits.map((hit) => (
              <button
                key={hit.traceId}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectHit(hit.traceId)}
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="flex items-center gap-2">
                  <span className="truncate font-mono text-xs text-slate-800">{hit.traceId}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                    {hit.component}
                  </span>
                  <ScoreBadge score={hit.score} />
                </span>
                <span className="line-clamp-2 text-xs text-slate-500">
                  <Snippet text={hit.snippet} q={debounced} />
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
