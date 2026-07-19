import type { Trace } from '@shared/schema/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MessageCard } from './MessageCard'
import { TraceSummaryPanel } from './TraceSummaryPanel'

export function ConversationView({ trace }: { trace: Trace }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Body fold state (system/developer/reasoning) lives here, keyed by message id —
  // never inside recycled rows. Default is collapsed for those kinds.
  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map())
  // Offset of the virtualized list inside the scroll container (summary panel height).
  // Fed to the virtualizer as scrollMargin, else visible ranges drift by that height.
  const [listOffset, setListOffset] = useState(0)
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

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Map(prev)
      next.set(id, !prev.get(id))
      return next
    })
  }, [])

  // The summary panel collapses/expands with local state, so track its size directly.
  useLayoutEffect(() => {
    const update = () => setListOffset(listRef.current?.offsetTop ?? 0)
    update()
    const head = headRef.current
    if (!head || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(head)
    return () => observer.disconnect()
  }, [])

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
    scrollMargin: listOffset,
  })

  return (
    <div className="flex h-full flex-col">
      {/* relative so listRef.offsetTop measures against the scroll container */}
      <div ref={parentRef} className="relative min-h-0 flex-1 overflow-y-auto">
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
              const message = messages[item.index]
              return (
                <div
                  key={message.id}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <MessageCard
                    message={message}
                    isFirstOfStep={firstOfStep.has(message.id)}
                    bodyExpanded={expanded.get(message.id) ?? false}
                    onToggleBody={() => toggle(message.id)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
