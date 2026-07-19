import type { Message } from '@shared/schema/types'
import { FoldSection, type FoldTone } from '../common/CollapsibleText'
import { formatDuration, formatTimestamp } from '../common/format'
import { ScoreBadge } from '../common/ScoreBadge'
import { ToolResultBlock } from './ToolResultBlock'

/** Content above this length is clamped behind the fold control. */
const CLAMP = 2500

/**
 * Standalone (non-step) card kinds. Assistant messages render inside StepCard;
 * 'final' remains only as a defensive fallback should one ever reach this component.
 */
type Kind = 'system' | 'developer' | 'user' | 'final' | 'toolResult' | 'toolError'

function kindOf(message: Message): Kind {
  switch (message.role) {
    case 'system':
      return 'system'
    case 'developer':
      return 'developer'
    case 'user':
      return 'user'
    case 'tool':
      return message.toolResult?.isError ? 'toolError' : 'toolResult'
    default:
      return 'final'
  }
}

const CHIP: Record<Kind, { label: string; cls: string }> = {
  system: { label: 'SYSTEM', cls: 'bg-slate-200 text-slate-700' },
  developer: { label: 'DEVELOPER', cls: 'bg-amber-100 text-amber-800' },
  user: { label: 'USER', cls: 'bg-blue-100 text-blue-700' },
  final: { label: 'ASSISTANT', cls: 'bg-emerald-100 text-emerald-700' },
  toolResult: { label: 'TOOL RESULT', cls: 'bg-cyan-100 text-cyan-700' },
  toolError: { label: 'TOOL RESULT', cls: 'bg-red-100 text-red-700' },
}

// Left accent (border-l-4) + tinted background per message type. Tool results carry
// their own card inside ToolResultBlock (cyan, or red on error).
const CARD: Record<Kind, string> = {
  system: 'border-slate-200 border-l-slate-400 bg-slate-50',
  developer: 'border-amber-200 border-l-amber-300 bg-amber-50/50',
  user: 'border-blue-200 border-l-blue-400 bg-blue-50',
  final: 'border-emerald-200 border-l-emerald-400 bg-white',
  toolResult: '',
  toolError: '',
}

/** Shared fold tones — StepCard reuses analysis/toolCall/final for its nested pieces. */
export const FOLD_TONES = {
  system: { label: 'text-slate-600', chevron: 'text-slate-400', hover: 'hover:bg-slate-100' },
  developer: {
    label: 'text-amber-700',
    chevron: 'text-amber-400',
    hover: 'hover:bg-amber-100/70',
  },
  analysis: {
    label: 'text-violet-700',
    chevron: 'text-violet-400',
    hover: 'hover:bg-violet-100/70',
  },
  user: { label: 'text-blue-700', chevron: 'text-blue-400', hover: 'hover:bg-blue-100/70' },
  final: { label: 'text-emerald-700', chevron: 'text-emerald-400', hover: 'hover:bg-emerald-50' },
  toolCall: {
    label: 'text-indigo-700',
    chevron: 'text-indigo-400',
    hover: 'hover:bg-indigo-100/70',
  },
} satisfies Record<string, FoldTone>

/** Always-expanded content; only long text gets the fold control (clamped, expandable). */
export function LongText({ text, label, tone }: { text: string; label: string; tone: FoldTone }) {
  if (text.length <= CLAMP) {
    return <div className="whitespace-pre-wrap break-words px-1.5 py-0.5 text-sm">{text}</div>
  }
  return <FoldSection label={label} text={text} tone={tone} blockPreview previewChars={CLAMP} />
}

/** Amber LLM-as-judge explanation attached to a message. */
export function JudgeCallout({ text }: { text: string }) {
  return (
    <div className="mt-2 rounded-lg border border-amber-200 border-l-4 border-l-amber-400 bg-amber-50 px-3 py-2">
      <p className="text-[10px] font-semibold tracking-wide text-amber-700">JUDGE</p>
      <p className="whitespace-pre-wrap break-words text-sm text-amber-900">{text}</p>
    </div>
  )
}

/** Per-message meta row: logprobs hint, timestamp, duration, score. */
export function MessageMeta({
  message,
  showLogprobs,
  light = false,
}: {
  message: Message
  showLogprobs: boolean
  /** Smaller type for rows nested inside a StepCard. */
  light?: boolean
}) {
  const hasTokens = message.tokens !== undefined && message.tokens.length > 0
  return (
    <div
      className={`mt-1 flex items-center justify-end gap-2 text-slate-400 ${
        light ? 'text-[10px]' : 'text-xs'
      }`}
    >
      {hasTokens && !showLogprobs && (
        <span
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
          title="Per-token logprobs available — enable the logprobs toggle to view"
          data-testid="logprobs-available"
        >
          logprobs
        </span>
      )}
      <span>{formatTimestamp(message.timestamp)}</span>
      {message.durationMs !== undefined && <span>· {formatDuration(message.durationMs)}</span>}
      {message.score !== undefined && <ScoreBadge score={message.score} />}
    </div>
  )
}

function Body({
  message,
  kind,
  expanded,
  onToggle,
}: {
  message: Message
  kind: Kind
  expanded: boolean
  onToggle: () => void
}) {
  const card = `rounded-lg border border-l-4 px-2 py-1.5 ${CARD[kind]}`
  switch (kind) {
    case 'system':
    case 'developer':
      return (
        <div className={card}>
          <FoldSection
            label={kind === 'system' ? 'SYSTEM PROMPT' : 'DEVELOPER'}
            text={message.content}
            tone={FOLD_TONES[kind]}
            mono
            expanded={expanded}
            onToggle={onToggle}
          />
        </div>
      )
    case 'user':
      return (
        <div className={card}>
          <LongText text={message.content} label="USER MESSAGE" tone={FOLD_TONES.user} />
        </div>
      )
    case 'final':
      return (
        <div className={card}>
          <LongText text={message.content} label="ASSISTANT RESPONSE" tone={FOLD_TONES.final} />
        </div>
      )
    default:
      return <ToolResultBlock message={message} />
  }
}

/** Standalone card for user/system/developer/tool messages. Assistant steps use StepCard. */
export function MessageCard({
  message,
  bodyExpanded,
  onToggleBody,
  showLogprobs = false,
}: {
  message: Message
  bodyExpanded: boolean
  onToggleBody: () => void
  showLogprobs?: boolean
}) {
  const kind = kindOf(message)
  const chip = CHIP[kind]
  return (
    <div className="flex gap-3 py-1.5" data-testid="message-card" data-kind={kind}>
      <div className="flex w-24 shrink-0 flex-col items-end gap-1 pt-1.5">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chip.cls}`}
        >
          {chip.label}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <Body message={message} kind={kind} expanded={bodyExpanded} onToggle={onToggleBody} />
        {message.judgeOutput && <JudgeCallout text={message.judgeOutput} />}
        <MessageMeta message={message} showLogprobs={showLogprobs} />
      </div>
    </div>
  )
}
