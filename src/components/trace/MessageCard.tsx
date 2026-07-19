import type { Message, Role } from '@shared/schema/types'
import { CollapsibleText } from '../common/CollapsibleText'
import { formatDuration, formatTimestamp } from '../common/format'
import { ScoreBadge } from '../common/ScoreBadge'
import { ToolCallBlock } from './ToolCallBlock'
import { ToolResultBlock } from './ToolResultBlock'

const ROLE_CHIP: Record<Role, string> = {
  system: 'bg-slate-100 text-slate-600',
  developer: 'bg-slate-100 text-slate-600',
  user: 'bg-blue-100 text-blue-700',
  assistant: 'bg-violet-100 text-violet-700',
  tool: 'bg-emerald-100 text-emerald-700',
}

/** Reasoning above this size is cut off in-card — full text lives in the Raw tab. */
const REASONING_CAP = 200_000

function ReasoningCard({
  message,
  expanded,
  onToggle,
}: {
  message: Message
  expanded: boolean
  onToggle: () => void
}) {
  const chars = message.content.length
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs text-violet-400">{expanded ? '▾' : '▸'}</span>
        <span className="text-xs font-semibold tracking-wide text-violet-700">
          REASONING · {chars.toLocaleString()} chars
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <div className="whitespace-pre-wrap break-words text-sm text-violet-900">
            {chars > REASONING_CAP ? message.content.slice(0, REASONING_CAP) : message.content}
          </div>
          {chars > REASONING_CAP && (
            <p className="mt-1 text-xs text-violet-400 italic">
              (truncated view — use Raw tab for full text)
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Body({
  message,
  expanded,
  onToggle,
}: {
  message: Message
  expanded: boolean
  onToggle: () => void
}) {
  const card = 'rounded-lg border px-3 py-2'
  if (message.role === 'system' || message.role === 'developer') {
    return (
      <div className={`${card} border-slate-200 bg-slate-50`}>
        <CollapsibleText text={message.content} mono />
      </div>
    )
  }
  if (message.role === 'user') {
    return (
      <div className={`${card} border-blue-200 bg-blue-50`}>
        <CollapsibleText text={message.content} />
      </div>
    )
  }
  if (message.role === 'tool') {
    return <ToolResultBlock message={message} />
  }
  // assistant — absent channel is treated as 'final'
  if ((message.channel ?? 'final') === 'analysis') {
    return <ReasoningCard message={message} expanded={expanded} onToggle={onToggle} />
  }
  if (message.toolCalls?.length) {
    return (
      <div className="space-y-2">
        {message.content && (
          <div className={`${card} border-slate-200 bg-white`}>
            <CollapsibleText text={message.content} />
          </div>
        )}
        {message.toolCalls.map((call) => (
          <ToolCallBlock key={call.id} call={call} />
        ))}
      </div>
    )
  }
  return (
    <div className={`${card} border-slate-200 bg-white`}>
      <CollapsibleText text={message.content} />
    </div>
  )
}

export function MessageCard({
  message,
  isFirstOfStep,
  reasoningExpanded,
  onToggleReasoning,
}: {
  message: Message
  isFirstOfStep: boolean
  reasoningExpanded: boolean
  onToggleReasoning: () => void
}) {
  return (
    <div className="flex gap-3 py-1.5">
      <div className="flex w-24 shrink-0 flex-col items-end gap-1 pt-1.5">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ROLE_CHIP[message.role]}`}
        >
          {message.role}
        </span>
        {isFirstOfStep && message.stepIndex !== undefined && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white">
            Step {message.stepIndex}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Body message={message} expanded={reasoningExpanded} onToggle={onToggleReasoning} />
        {message.judgeOutput && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[10px] font-semibold tracking-wide text-amber-700">JUDGE</p>
            <p className="whitespace-pre-wrap break-words text-sm text-amber-900">
              {message.judgeOutput}
            </p>
          </div>
        )}
        <div className="mt-1 flex items-center justify-end gap-2 text-xs text-slate-400">
          <span>{formatTimestamp(message.timestamp)}</span>
          {message.durationMs !== undefined && <span>· {formatDuration(message.durationMs)}</span>}
          {message.score !== undefined && <ScoreBadge score={message.score} />}
        </div>
      </div>
    </div>
  )
}
