import type { Trace } from '@shared/schema/types'
import { useCallback, useMemo, useRef, useState } from 'react'
import { EmptyState } from '../common/EmptyState'
import { useResizableWidth } from '../common/useResizableWidth'
import { failuresByMessage } from './failureSource'
import { MessageCard } from './MessageCard'
import { StepCard } from './StepCard'
import { TraceMetricsPanel } from './TraceMetricsPanel'
import { TurnRail } from './TurnRail'
import { unitFlags } from './unitFlags'
import { buildUnits } from './unitize'

function toggleIn(prev: Map<string, boolean>, id: string, fallback: boolean): Map<string, boolean> {
  return new Map(prev).set(id, !(prev.get(id) ?? fallback))
}

/**
 * S2-style focused reading mode: rail of units on the left, the selected unit
 * rendered with the normal card components in the center (everything expanded
 * by default), whole-trace metrics on the right. Replaces the virtualized list
 * while the toolbar's Compact toggle is on.
 */
export function CompactMode({ trace }: { trace: Trace }) {
  const centerRef = useRef<HTMLDivElement>(null)
  const { width, startResize, reset } = useResizableWidth('compact-rail', {
    default: 240,
    min: 160,
    max: 480,
  })
  const units = useMemo(() => buildUnits(trace.messages), [trace.messages])
  const flags = useMemo(() => units.map((unit) => unitFlags(unit, trace)), [units, trace])
  const failureIndex = useMemo(() => failuresByMessage(trace), [trace])
  const [selected, setSelected] = useState(0)
  // Expand overrides, keyed by unit id. Compact mode defaults everything OPEN
  // (step body, reasoning, system/developer folds) — cards stay collapsible.
  const [stepOpen, setStepOpen] = useState<Map<string, boolean>>(new Map())
  const [reasoningOpen, setReasoningOpen] = useState<Map<string, boolean>>(new Map())
  const [foldOpen, setFoldOpen] = useState<Map<string, boolean>>(new Map())

  const index = Math.min(selected, Math.max(0, units.length - 1))
  const unit = units[index]

  const goto = useCallback(
    (i: number) => {
      setSelected(Math.max(0, Math.min(units.length - 1, i)))
      // New selection reads from the top.
      centerRef.current?.scrollTo(0, 0)
    },
    [units.length],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goto(index - 1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goto(index + 1)
      }
    },
    [goto, index],
  )

  if (unit === undefined) {
    return (
      <div className="p-4">
        <EmptyState title="No messages in this trace" />
      </div>
    )
  }

  const navCls =
    'h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40'

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: focus target for ←/→ unit navigation
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard nav wrapper; rail cells/buttons are the accessible path
    <div data-testid="compact-mode" className="flex h-full" onKeyDown={onKeyDown} tabIndex={0}>
      <div
        style={{ width }}
        className="relative flex shrink-0 [&>[data-testid=turn-rail]]:!h-full [&>[data-testid=turn-rail]]:!w-full"
      >
        <TurnRail units={units} flags={flags} selected={index} onSelect={goto} />
        <div
          data-testid="pane-resize-compact"
          aria-hidden="true"
          title="Drag to resize · double-click to reset"
          onPointerDown={startResize}
          onDoubleClick={reset}
          className="absolute top-0 right-0 z-10 h-full w-1.5 translate-x-1/2 cursor-col-resize touch-none hover:bg-blue-300"
        />
      </div>
      <div ref={centerRef} className="min-w-0 flex-1 overflow-y-auto px-4">
        <div className="flex items-center gap-2 py-2">
          <button
            type="button"
            data-testid="compact-prev"
            onClick={() => goto(index - 1)}
            disabled={index === 0}
            className={navCls}
          >
            ← Prev
          </button>
          <button
            type="button"
            data-testid="compact-next"
            onClick={() => goto(index + 1)}
            disabled={index === units.length - 1}
            className={navCls}
          >
            Next →
          </button>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            {index + 1} / {units.length}
          </span>
        </div>
        <div className="pb-4" data-testid="compact-center">
          {unit.kind === 'step' ? (
            <StepCard
              unit={unit}
              expanded={stepOpen.get(unit.id) ?? true}
              onToggle={() => setStepOpen((prev) => toggleIn(prev, unit.id, true))}
              reasoningOpen={reasoningOpen.get(unit.id) ?? true}
              onToggleReasoning={() => setReasoningOpen((prev) => toggleIn(prev, unit.id, true))}
              failureIndex={failureIndex}
            />
          ) : (
            <MessageCard
              message={unit.message}
              bodyExpanded={foldOpen.get(unit.id) ?? true}
              onToggleBody={() => setFoldOpen((prev) => toggleIn(prev, unit.id, true))}
              failures={failureIndex.get(unit.message.id)}
            />
          )}
        </div>
      </div>
      <TraceMetricsPanel trace={trace} />
    </div>
  )
}
