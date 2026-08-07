import type { Message } from '@shared/schema/types'
import { FoldSection, type FoldTone } from '../common/CollapsibleText'
import { formatDuration, formatTimestamp } from '../common/format'
import { MarkdownContent } from '../common/MarkdownContent'
import { ScoreBadge } from '../common/ScoreBadge'
import type { UnifiedFailure } from './failureSource'
import {
  MessageViewHeader,
  RawMessageJson,
  TokenInspector,
  useMessageViewTab,
} from './TokenInspector'
import { ToolResultBlock } from './ToolResultBlock'

/** Content above this length is clamped behind the fold control. */
const CLAMP = 2500

/** toolCallId → tool name, built from the assistant messages' toolCalls of a whole trace. */
export function buildCallNameMap(messages: readonly Message[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of messages) {
    if (m.toolCalls === undefined) continue
    for (const c of m.toolCalls) map.set(c.id, c.name)
  }
  return map
}

/** Message id 'm-<idx>' (assigned by finalizeTrace) → 1-based '#<n>'; unknown ids omit it. */
export function messageNumber(id: string): number | undefined {
  const match = /^m-(\d+)$/.exec(id)
  if (!match) return undefined
  return Number(match[1]) + 1
}

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
    label: 'text-emerald-800/80',
    chevron: 'text-emerald-500',
    hover: 'hover:bg-emerald-100/60',
  },
  user: { label: 'text-blue-700', chevron: 'text-blue-400', hover: 'hover:bg-blue-100/70' },
  final: { label: 'text-emerald-700', chevron: 'text-emerald-400', hover: 'hover:bg-emerald-50' },
  toolCall: {
    label: 'text-indigo-700',
    chevron: 'text-indigo-400',
    hover: 'hover:bg-indigo-100/70',
  },
} satisfies Record<string, FoldTone>

/**
 * The Rendered view for a plain-text content block: markdown, folded behind the
 * clamp control when long (the collapsed preview stays plain text). The Raw and
 * Tokens views are handled by the per-message tabs in the card header.
 */
export function RichTextBlock({
  text,
  label,
  tone,
}: {
  text: string
  label: string
  tone: FoldTone
}) {
  return (
    <div data-testid="rich-text-block">
      {text.length <= CLAMP ? (
        <MarkdownContent text={text} className="px-1.5 py-0.5" />
      ) : (
        <FoldSection
          label={label}
          text={text}
          tone={tone}
          blockPreview
          previewChars={CLAMP}
          renderText={(t) => <MarkdownContent text={t} />}
        />
      )}
    </div>
  )
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

/** Chip label: `code · tier/family` when detector evidence exists. */
export function failureChipLabel(failure: UnifiedFailure): string {
  const taxonomy = [failure.tier, failure.family].filter(Boolean).join('/')
  return taxonomy ? `${failure.code} · ${taxonomy}` : failure.code
}

/**
 * Unified failure findings anchored to the exact source message. Fed from
 * `failuresByMessage(trace)` (single source: evaluation.failures first,
 * message metadata only as fill-in). Gating failures are red; advisory
 * (non-gating) findings are amber.
 */
export function FailureChips({ failures }: { failures?: readonly UnifiedFailure[] }) {
  if (failures === undefined || failures.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1" data-testid="ace-failure-chips">
      {failures.map((failure) => (
        <span
          key={`${failure.origin}:${failure.code}:${failure.messageId ?? failure.anchorLabel}:${failure.source}`}
          title={[
            failure.origin,
            failure.severity,
            failure.gating ? 'gating' : 'non-gating',
            typeof failure.evidence === 'string' ? failure.evidence : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
            failure.gating
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}
        >
          {failureChipLabel(failure)}
        </span>
      ))}
    </div>
  )
}

/** Per-message meta row: timestamp, duration, score. */
export function MessageMeta({
  message,
  light = false,
}: {
  message: Message
  /** Smaller type for rows nested inside a StepCard. */
  light?: boolean
}) {
  return (
    <div
      className={`mt-1 flex items-center justify-end gap-2 text-slate-400 ${
        light ? 'text-[10px]' : 'text-xs'
      }`}
    >
      <span>{formatTimestamp(message.timestamp)}</span>
      {message.durationMs !== undefined && <span>· {formatDuration(message.durationMs)}</span>}
      {message.score !== undefined && <ScoreBadge score={message.score} />}
    </div>
  )
}

/** Role chip + message number on the left; view tabs (+ token chips) on the right. */
function CardHeader({
  kind,
  number,
  message,
  tab,
  onTabChange,
}: {
  kind: Kind
  number: number | undefined
  message: Message
  tab: 'rendered' | 'raw' | 'tokens'
  onTabChange: (tab: 'rendered' | 'raw' | 'tokens') => void
}) {
  const chip = CHIP[kind]
  return (
    <div className="flex items-center gap-2 px-1.5 pt-0.5 pb-1">
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chip.cls}`}
      >
        {chip.label}
      </span>
      {number !== undefined && (
        <span className="font-mono text-[10px] text-slate-400" data-testid="message-number">
          #{number}
        </span>
      )}
      <MessageViewHeader
        message={message}
        tab={tab}
        onChange={onTabChange}
        termination={kind === 'final' ? 'return' : undefined}
        className="ml-auto"
      />
    </div>
  )
}

function Body({
  message,
  kind,
  number,
  expanded,
  onToggle,
  toolName,
}: {
  message: Message
  kind: Kind
  number: number | undefined
  expanded: boolean
  onToggle: () => void
  toolName?: string
}) {
  const [tab, setTab] = useMessageViewTab(message.id)
  const carriedToolName =
    typeof message.metadata?.toolName === 'string' && message.metadata.toolName.length > 0
      ? message.metadata.toolName
      : undefined
  const card = `rounded-lg border border-l-4 px-2 py-1.5 ${CARD[kind]}`
  const header = (
    <CardHeader kind={kind} number={number} message={message} tab={tab} onTabChange={setTab} />
  )

  // ToolResultBlock draws its own card, so its header line sits just above it.
  if (kind === 'toolResult' || kind === 'toolError') {
    return (
      <div>
        {header}
        {tab === 'raw' ? (
          <RawMessageJson message={message} />
        ) : tab === 'tokens' ? (
          <TokenInspector
            message={message}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5"
          />
        ) : (
          <ToolResultBlock
            message={message}
            toolName={toolName ?? carriedToolName}
            expanded={expanded}
            onToggle={onToggle}
          />
        )}
      </div>
    )
  }

  if (tab === 'raw') {
    return (
      <div className={card}>
        {header}
        <RawMessageJson message={message} />
      </div>
    )
  }
  if (tab === 'tokens') {
    return (
      <div className={card}>
        {header}
        <TokenInspector message={message} className="px-1.5 py-1" />
      </div>
    )
  }

  switch (kind) {
    case 'system':
    case 'developer':
      return (
        <div className={card}>
          {header}
          <FoldSection
            label={kind === 'system' ? 'SYSTEM PROMPT' : 'DEVELOPER'}
            text={message.content}
            tone={FOLD_TONES[kind]}
            mono
            expanded={expanded}
            onToggle={onToggle}
            renderText={(t) => <MarkdownContent text={t} />}
          />
        </div>
      )
    case 'user':
      return (
        <div className={card}>
          {header}
          <RichTextBlock text={message.content} label="USER MESSAGE" tone={FOLD_TONES.user} />
        </div>
      )
    default:
      return (
        <div className={card}>
          {header}
          <RichTextBlock
            text={message.content}
            label="ASSISTANT RESPONSE"
            tone={FOLD_TONES.final}
          />
        </div>
      )
  }
}

/** Standalone card for user/system/developer/tool messages. Assistant steps use StepCard. */
export function MessageCard({
  message,
  bodyExpanded,
  onToggleBody,
  toolName,
  failures,
}: {
  message: Message
  bodyExpanded: boolean
  onToggleBody: () => void
  /**
   * Tool name for the tool-result chip. MessageCard only sees its own message,
   * so the owner of the message list normally resolves it (see buildCallNameMap).
   * Connectors may also preserve an unlinked raw name in message metadata.
   */
  toolName?: string
  /** Unified failures anchored to this message (from failuresByMessage(trace)). */
  failures?: readonly UnifiedFailure[]
}) {
  const kind = kindOf(message)
  return (
    <div className="py-1.5" data-testid="message-card" data-kind={kind}>
      <Body
        message={message}
        kind={kind}
        number={messageNumber(message.id)}
        expanded={bodyExpanded}
        onToggle={onToggleBody}
        toolName={toolName}
      />
      {message.judgeOutput && <JudgeCallout text={message.judgeOutput} />}
      <FailureChips failures={failures} />
      <MessageMeta message={message} />
    </div>
  )
}
