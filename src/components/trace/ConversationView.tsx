import type { Trace } from '@shared/schema/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ConversationToolbar } from './ConversationToolbar'
import { MessageCard } from './MessageCard'
import { TimelineRailCell, TimelineRailHeader } from './TimelineRail'
import { TraceSummaryPanel } from './TraceSummaryPanel'

const TIMELINE_KEY = 'tv.timeline.open'
const MATCH_CAP = 500
const NO_MATCHES: number[] = []

function readTimelineOpen(): boolean {
  try {
    return localStorage.getItem(TIMELINE_KEY) === '1'
  } catch {
    return false
  }
}

export function ConversationView({ trace }: { trace: Trace }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const railHeadRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Body fold state (system/developer/reasoning) lives here, keyed by message id —
  // never inside recycled rows. Default is collapsed for those kinds.
  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map())
  // Offset of the virtualized list inside the scroll container (summary panel height).
  // Fed to the virtualizer as scrollMargin, else visible ranges drift by that height.
  const [listOffset, setListOffset] = useState(0)
  const [query, setQuery] = useState('')
  const [matchPos, setMatchPos] = useState(0)
  const [showLogprobs, setShowLogprobs] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(readTimelineOpen)
  const messages = trace.messages

  const firstOfStep = useMemo(() => {
    const seen = new Set<number>()
    const ids = new Set<string>()
    for (const m of messages) {
      if (m.stepIndex !== undefined && !seen.has(m.stepIndex)) {
        seen.add(m.stepIndex)
        ids.add(m.id)
      }
    }
    return ids
  }, [messages])

  // Message indices matching the in-trace search (content + toolCall arguments).
  const matches = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return NO_MATCHES
    const found: number[] = []
    for (let i = 0; i < messages.length && found.length < MATCH_CAP; i++) {
      const m = messages[i]
      if (
        m.content.toLowerCase().includes(q) ||
        m.toolCalls?.some((c) => c.arguments.toLowerCase().includes(q))
      ) {
        found.push(i)
      }
    }
    return found
  }, [messages, query])

  const maxDurationMs = useMemo(() => {
    let max = 0
    for (const m of messages) {
      if (m.durationMs !== undefined && m.durationMs > max) max = m.durationMs
    }
    return max
  }, [messages])

  const totalDurationMs = useMemo(() => {
    if (trace.stats.durationMs !== undefined) return trace.stats.durationMs
    let sum = 0
    let seen = false
    for (const m of messages) {
      if (m.durationMs !== undefined) {
        sum += m.durationMs
        seen = true
      }
    }
    return seen ? sum : undefined
  }, [trace.stats.durationMs, messages])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Map(prev)
      next.set(id, !prev.get(id))
      return next
    })
  }, [])

  const toggleTimeline = useCallback(() => {
    setTimelineOpen((v) => {
      const next = !v
      try {
        localStorage.setItem(TIMELINE_KEY, next ? '1' : '0')
      } catch {
        // private mode etc. — state still works for this session
      }
      return next
    })
  }, [])

  // The summary panel collapses/expands with local state, so track its size directly.
  // The rail header wrapper stays mounted (empty when closed) so one observer covers both.
  useLayoutEffect(() => {
    const update = () => setListOffset(listRef.current?.offsetTop ?? 0)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    if (headRef.current) observer.observe(headRef.current)
    if (railHeadRef.current) observer.observe(railHeadRef.current)
    return () => observer.disconnect()
  }, [])

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
    scrollMargin: listOffset,
  })

  const gotoMatch = useCallback(
    (pos: number) => {
      setMatchPos(pos)
      const index = matches[pos]
      if (index !== undefined) virtualizer.scrollToIndex(index, { align: 'center' })
    },
    [matches, virtualizer],
  )

  // New query ⇒ jump to its first match.
  useEffect(() => {
    setMatchPos(0)
    if (matches.length > 0) virtualizer.scrollToIndex(matches[0], { align: 'center' })
  }, [matches, virtualizer])

  const nextMatch = useCallback(() => {
    if (matches.length > 0) gotoMatch((matchPos + 1) % matches.length)
  }, [matches, matchPos, gotoMatch])

  const prevMatch = useCallback(() => {
    if (matches.length > 0) gotoMatch((matchPos - 1 + matches.length) % matches.length)
  }, [matches, matchPos, gotoMatch])

  const currentMatchIndex = matches[matchPos]
  // Track T3 owns adding 'showLogprobs' to MessageCard's props; spread keeps this compiling
  // until it lands.
  const cardExtra = { showLogprobs } as Record<string, unknown>

  return (
    <div className="flex h-full flex-col">
      <ConversationToolbar
        onQueryChange={setQuery}
        matchCount={matches.length}
        matchPos={matchPos}
        onPrevMatch={prevMatch}
        onNextMatch={nextMatch}
        showLogprobs={showLogprobs}
        onToggleLogprobs={() => setShowLogprobs((v) => !v)}
        timelineOpen={timelineOpen}
        onToggleTimeline={toggleTimeline}
      />
      {/* relative so listRef.offsetTop measures against the scroll container */}
      <div ref={parentRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <div ref={headRef}>
            <TraceSummaryPanel trace={trace} />
          </div>
          <div
            ref={railHeadRef}
            className={`sticky top-2 z-10 ml-auto w-[200px] ${timelineOpen ? 'mt-3' : ''}`}
          >
            {timelineOpen && (
              <TimelineRailHeader
                messages={messages}
                maxDurationMs={maxDurationMs}
                totalDurationMs={totalDurationMs}
                onJump={(index) => virtualizer.scrollToIndex(index, { align: 'center' })}
              />
            )}
          </div>
          <div
            ref={listRef}
            className="relative mt-3"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const message = messages[item.index]
              const isCurrentMatch = currentMatchIndex === item.index
              return (
                <div
                  key={message.id}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 flex w-full"
                  style={{
                    transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <div
                    data-highlight={isCurrentMatch ? 'true' : undefined}
                    className={`min-w-0 flex-1 ${isCurrentMatch ? 'rounded-lg ring-2 ring-amber-400' : ''}`}
                  >
                    <MessageCard
                      {...cardExtra}
                      message={message}
                      isFirstOfStep={firstOfStep.has(message.id)}
                      bodyExpanded={expanded.get(message.id) ?? false}
                      onToggleBody={() => toggle(message.id)}
                    />
                  </div>
                  <div
                    className={`shrink-0 overflow-hidden transition-[width] duration-200 ${
                      timelineOpen ? 'w-[200px]' : 'w-0'
                    }`}
                  >
                    <TimelineRailCell message={message} maxDurationMs={maxDurationMs} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
