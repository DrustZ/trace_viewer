import type { Trace } from '@shared/schema/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useMemo, useRef, useState } from 'react'
import { MessageCard } from './MessageCard'

export function ConversationView({ trace }: { trace: Trace }) {
  const parentRef = useRef<HTMLDivElement>(null)
  // Reasoning expand state lives here, keyed by message id — never inside recycled rows.
  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map())
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

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
  })

  return (
    <div className="flex h-full flex-col">
      {trace.warnings && trace.warnings.length > 0 && (
        <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            <p className="font-medium">
              {trace.warnings.length} warning{trace.warnings.length > 1 ? 's' : ''} during parsing
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {trace.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-4">
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const message = messages[item.index]
              return (
                <div
                  key={message.id}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <MessageCard
                    message={message}
                    isFirstOfStep={firstOfStep.has(message.id)}
                    reasoningExpanded={expanded.get(message.id) ?? false}
                    onToggleReasoning={() => toggle(message.id)}
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
