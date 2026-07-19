import type { Trace } from '@shared/schema/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CompactMode } from './CompactMode'
import { ConversationToolbar } from './ConversationToolbar'
import { buildCallNameMap, MessageCard } from './MessageCard'
import { StepCard } from './StepCard'
import { TimelineMode } from './TimelineMode'
import { TraceSummaryPanel } from './TraceSummaryPanel'
import { buildUnits } from './unitize'

const TIMELINE_KEY = 'tv.timeline.open'
const COMPACT_KEY = 'tv.compact'
const MATCH_CAP = 500
const NO_MATCHES: number[] = []

function readTimelineOpen(): boolean {
  try {
    return localStorage.getItem(TIMELINE_KEY) === '1'
  } catch {
    return false
  }
}

function readCompact(): boolean {
  try {
    return localStorage.getItem(COMPACT_KEY) === '1'
  } catch {
    return false
  }
}

export function ConversationView({ trace }: { trace: Trace }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // All expand state lives here, keyed by unit id (= first message id) — never
  // inside recycled rows.
  // - system/developer body folds: `foldOpen.get(id) ?? foldDefault`
  // - step cards: `stepOverrides.get(id) ?? stepDefault`
  //   Expand/Collapse all just resets the overrides and flips the defaults.
  // - reasoningOpen: nested reasoning widgets (default collapsed, always)
  const [foldOpen, setFoldOpen] = useState<Map<string, boolean>>(new Map())
  const [foldDefault, setFoldDefault] = useState(false)
  // Standalone tool-result body folds. Separate default from system/developer: tool
  // results read open by default, but Collapse all clamps them like everything else.
  const [toolOpen, setToolOpen] = useState<Map<string, boolean>>(new Map())
  const [toolDefault, setToolDefault] = useState(true)
  const [stepOverrides, setStepOverrides] = useState<Map<string, boolean>>(new Map())
  const [stepDefault, setStepDefault] = useState(true)
  const [reasoningOpen, setReasoningOpen] = useState<Map<string, boolean>>(new Map())
  // Offset of the virtualized list inside the scroll container (summary panel height).
  // Fed to the virtualizer as scrollMargin, else visible ranges drift by that height.
  const [listOffset, setListOffset] = useState(0)
  const [query, setQuery] = useState('')
  const [matchPos, setMatchPos] = useState(0)
  const [timelineOpen, setTimelineOpen] = useState(readTimelineOpen)
  const [compact, setCompact] = useState(readCompact)
  const messages = trace.messages

  // Timeline profiling is only meaningful with real timing: explicit profiling
  // spans, or per-message timestamps/durations. Without any, the span tree falls
  // back to synthetic 1s ticks — fabricated numbers we don't want to present
  // (e.g. an imported chat trace). Hide the toggle in that case.
  const hasTiming = useMemo(() => {
    const spans = trace.meta.extra?.spans
    if (Array.isArray(spans) && spans.length > 0) return true
    return messages.some((m) => typeof m.durationMs === 'number' || typeof m.timestamp === 'string')
  }, [trace.meta.extra, messages])

  const units = useMemo(() => buildUnits(messages), [messages])

  // callId → tool name, so a standalone tool result can label its chip and pick the
  // highlight language (python/bash/…) for its Rich view.
  const callNames = useMemo(() => buildCallNameMap(messages), [messages])

  // messages[i] belongs to units[unitOfMessage[i]] — units partition messages in order.
  const unitOfMessage = useMemo(() => {
    const map = new Array<number>(messages.length)
    let mi = 0
    units.forEach((unit, ui) => {
      const size = unit.kind === 'step' ? unit.messages.length : 1
      for (let k = 0; k < size; k++) map[mi++] = ui
    })
    return map
  }, [units, messages.length])

  // Message indices matching the in-trace search. Diagnostic fields are
  // searchable too: tool names, malformed-JSON parse errors, judge output —
  // what the page visibly renders must be findable.
  const matches = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return NO_MATCHES
    const found: number[] = []
    for (let i = 0; i < messages.length && found.length < MATCH_CAP; i++) {
      const m = messages[i]
      if (
        m.content.toLowerCase().includes(q) ||
        m.judgeOutput?.toLowerCase().includes(q) ||
        m.toolCalls?.some(
          (c) =>
            c.arguments.toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q) ||
            c.parseError?.toLowerCase().includes(q) ||
            (c.parseError !== undefined && 'malformed json'.includes(q)),
        )
      ) {
        found.push(i)
      }
    }
    return found
  }, [messages, query])

  const toggleFold = useCallback(
    (id: string) => {
      setFoldOpen((prev) => {
        const next = new Map(prev)
        next.set(id, !(prev.get(id) ?? foldDefault))
        return next
      })
    },
    [foldDefault],
  )

  const toggleTool = useCallback(
    (id: string) => {
      setToolOpen((prev) => {
        const next = new Map(prev)
        next.set(id, !(prev.get(id) ?? toolDefault))
        return next
      })
    },
    [toolDefault],
  )

  const toggleStep = useCallback(
    (id: string) => {
      setStepOverrides((prev) => {
        const next = new Map(prev)
        next.set(id, !(prev.get(id) ?? stepDefault))
        return next
      })
    },
    [stepDefault],
  )

  const toggleReasoning = useCallback((id: string) => {
    setReasoningOpen((prev) => {
      const next = new Map(prev)
      next.set(id, !prev.get(id))
      return next
    })
  }, [])

  // Expand all: every step card AND every system/developer fold open; reasoning
  // widgets untouched (open ones stay open, closed ones stay closed). Long-text
  // clamps inside cards keep their local state and are not covered.
  const expandAll = useCallback(() => {
    setStepDefault(true)
    setStepOverrides(new Map())
    setFoldDefault(true)
    setFoldOpen(new Map())
    setToolDefault(true)
    setToolOpen(new Map())
  }, [])

  // Collapse all: every step card and system/developer fold closed AND every
  // reasoning widget closed.
  const collapseAll = useCallback(() => {
    setStepDefault(false)
    setStepOverrides(new Map())
    setFoldDefault(false)
    setFoldOpen(new Map())
    setToolDefault(false)
    setToolOpen(new Map())
    setReasoningOpen(new Map())
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

  const toggleCompact = useCallback(() => {
    setCompact((v) => {
      const next = !v
      try {
        localStorage.setItem(COMPACT_KEY, next ? '1' : '0')
      } catch {
        // private mode etc. — state still works for this session
      }
      return next
    })
  }, [])

  // The summary panel collapses/expands with local state, so track its size directly.
  // Re-runs when compact mode toggles: the list DOM unmounts/remounts across the switch.
  useLayoutEffect(() => {
    if (compact) return
    const update = () => setListOffset(listRef.current?.offsetTop ?? 0)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    if (headRef.current) observer.observe(headRef.current)
    return () => observer.disconnect()
  }, [compact])

  const virtualizer = useVirtualizer({
    count: units.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
    scrollMargin: listOffset,
  })

  // Scroll a matched message's unit into view. A collapsed step card auto-expands;
  // when the match is inside analysis content, its reasoning widget opens too.
  const revealMatch = useCallback(
    (msgIndex: number) => {
      const unitIndex = unitOfMessage[msgIndex]
      if (unitIndex === undefined) return
      const unit = units[unitIndex]
      if (unit.kind === 'step') {
        setStepOverrides((prev) => {
          if (prev.get(unit.id) ?? stepDefault) return prev
          return new Map(prev).set(unit.id, true)
        })
        if (messages[msgIndex]?.channel === 'analysis') {
          setReasoningOpen((prev) => (prev.get(unit.id) ? prev : new Map(prev).set(unit.id, true)))
        }
      }
      virtualizer.scrollToIndex(unitIndex, { align: 'center' })
    },
    [unitOfMessage, units, messages, stepDefault, virtualizer],
  )

  const gotoMatch = useCallback(
    (pos: number) => {
      setMatchPos(pos)
      const index = matches[pos]
      if (index !== undefined) revealMatch(index)
    },
    [matches, revealMatch],
  )

  // New query ⇒ jump to its first match.
  useEffect(() => {
    setMatchPos(0)
    if (matches.length > 0) revealMatch(matches[0])
  }, [matches, revealMatch])

  const nextMatch = useCallback(() => {
    if (matches.length > 0) gotoMatch((matchPos + 1) % matches.length)
  }, [matches, matchPos, gotoMatch])

  const prevMatch = useCallback(() => {
    if (matches.length > 0) gotoMatch((matchPos - 1 + matches.length) % matches.length)
  }, [matches, matchPos, gotoMatch])

  const currentMatchMsg = matches[matchPos]
  const currentMatchUnit =
    currentMatchMsg !== undefined ? unitOfMessage[currentMatchMsg] : undefined

  return (
    <div className="flex h-full flex-col">
      <ConversationToolbar
        onQueryChange={setQuery}
        matchCount={matches.length}
        matchPos={matchPos}
        onPrevMatch={prevMatch}
        onNextMatch={nextMatch}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        timelineOpen={timelineOpen}
        onToggleTimeline={toggleTimeline}
        timelineAvailable={hasTiming}
        compact={compact}
        onToggleCompact={toggleCompact}
      />
      <div className="relative min-h-0 flex-1">
        {compact ? (
          <CompactMode trace={trace} />
        ) : timelineOpen && hasTiming ? (
          <TimelineMode trace={trace} />
        ) : (
          <>
            {/* relative so listRef.offsetTop measures against the scroll container */}
            <div ref={parentRef} className="relative h-full overflow-y-auto">
              <div className="mx-auto max-w-5xl px-4 py-4">
                <div ref={headRef}>
                  <TraceSummaryPanel trace={trace} />
                </div>
                <div
                  ref={listRef}
                  className="relative mt-3"
                  style={{ height: virtualizer.getTotalSize() }}
                >
                  {virtualizer.getVirtualItems().map((item) => {
                    const unit = units[item.index]
                    const isCurrentMatch = currentMatchUnit === item.index
                    return (
                      // Chat-style alignment: assistant steps right, everything else left.
                      <div
                        key={unit.id}
                        data-index={item.index}
                        ref={virtualizer.measureElement}
                        className={`absolute top-0 left-0 flex w-full ${'justify-start'}`}
                        style={{
                          transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                        }}
                      >
                        <div
                          data-highlight={isCurrentMatch ? 'true' : undefined}
                          className={`w-full ${
                            isCurrentMatch ? 'rounded-lg ring-2 ring-amber-400' : ''
                          }`}
                        >
                          {unit.kind === 'step' ? (
                            <StepCard
                              unit={unit}
                              expanded={stepOverrides.get(unit.id) ?? stepDefault}
                              onToggle={() => toggleStep(unit.id)}
                              reasoningOpen={reasoningOpen.get(unit.id) ?? false}
                              onToggleReasoning={() => toggleReasoning(unit.id)}
                            />
                          ) : unit.message.role === 'tool' ? (
                            <MessageCard
                              message={unit.message}
                              bodyExpanded={toolOpen.get(unit.id) ?? toolDefault}
                              onToggleBody={() => toggleTool(unit.id)}
                              toolName={callNames.get(unit.message.toolResult?.toolCallId ?? '')}
                            />
                          ) : (
                            <MessageCard
                              message={unit.message}
                              bodyExpanded={foldOpen.get(unit.id) ?? foldDefault}
                              onToggleBody={() => toggleFold(unit.id)}
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
