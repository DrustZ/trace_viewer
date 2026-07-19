import { useEffect, useMemo, useRef } from 'react'
import type { RenderUnit, StepUnit } from './unitize'

const LABEL_CHARS = 40

/** Flags that read as failures render red; the rest are amber warnings. */
const RED_FLAGS = new Set(['timeout', 'malformed JSON'])

function clip(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > LABEL_CHARS ? `${t.slice(0, LABEL_CHARS)}…` : t
}

/** Intent label: first ~40 chars of analysis, else the final text, else the tool call. */
function stepLabel(unit: StepUnit): string {
  const analysis = unit.analysis.find((m) => m.content)?.content
  if (analysis) return clip(analysis)
  const finalText = unit.responses.find((m) => !m.toolCalls?.length && m.content)?.content
  if (finalText) return clip(finalText)
  for (const m of unit.responses) {
    const call = m.toolCalls?.[0]
    if (call) return `TOOL CALL · ${call.name}`
  }
  return '(empty step)'
}

function StepCell({ unit }: { unit: StepUnit }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {unit.analysis.length > 0 && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400"
          title="Has reasoning"
          data-testid="rail-reasoning-dot"
        />
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{stepLabel(unit)}</span>
    </span>
  )
}

/**
 * Left pane of the compact mode: one slim cell per render unit, clicking a cell
 * selects it in the center reader. Warning badges come from unitFlags.
 */
export function TurnRail({
  units,
  flags,
  selected,
  onSelect,
}: {
  units: RenderUnit[]
  /** flags[i] belongs to units[i] (precomputed once per trace). */
  flags: string[][]
  selected: number
  onSelect: (index: number) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)

  // toolCallId → tool name, so result cells can show which tool produced them.
  const toolNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const unit of units) {
      if (unit.kind !== 'step') continue
      for (const m of unit.responses) {
        for (const call of m.toolCalls ?? []) map.set(call.id, call.name)
      }
    }
    return map
  }, [units])

  // Keep the selected cell visible during keyboard navigation.
  useEffect(() => {
    railRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div
      ref={railRef}
      data-testid="turn-rail"
      className="w-[240px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white"
    >
      {units.map((unit, i) => {
        const cellFlags = flags[i] ?? []
        let body: React.ReactNode
        if (unit.kind === 'step') {
          body = <StepCell unit={unit} />
        } else if (unit.message.role === 'tool') {
          const m = unit.message
          const name = m.toolResult ? toolNames.get(m.toolResult.toolCallId) : undefined
          body = (
            <span
              className={`block truncate font-mono text-[11px] ${
                m.toolResult?.isError ? 'text-red-600' : 'text-cyan-700'
              }`}
            >
              {m.content.split('\n').length} lines · {name ?? 'tool'}
            </span>
          )
        } else {
          body = (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-slate-400">
                {unit.message.role === 'user' ? '›' : '⚙'}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                {clip(unit.message.content) || `(${unit.message.role})`}
              </span>
            </span>
          )
        }
        return (
          <button
            key={unit.id}
            type="button"
            data-testid="turn-rail-cell"
            data-index={i}
            aria-current={i === selected ? 'true' : undefined}
            onClick={() => onSelect(i)}
            className={`block w-full border-l-2 px-2 py-1.5 text-left ${
              i === selected ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:bg-slate-50'
            }`}
          >
            {body}
            {cellFlags.length > 0 && (
              <span className="mt-0.5 flex flex-wrap gap-1">
                {cellFlags.map((flag) => (
                  <span
                    key={flag}
                    data-testid="unit-flag"
                    className={`rounded px-1 py-px text-[9px] font-medium ${
                      RED_FLAGS.has(flag)
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {flag}
                  </span>
                ))}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
