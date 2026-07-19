import type { Message, ToolCall } from '@shared/schema/types'
import { messageTokens } from '@shared/stats/computeStats'
import { useMemo } from 'react'
import { FoldSection } from '../common/CollapsibleText'
import { formatDuration, formatNumber, formatScore, formatTimestamp } from '../common/format'
import {
  FOLD_TONES,
  JudgeCallout,
  type LogprobMode,
  MessageMeta,
  messageNumber,
  RichTextBlock,
} from './MessageCard'
import { TokenLogprobText } from './TokenLogprobText'
import { ToolCallBlock } from './ToolCallBlock'
import { bpeTokens } from './tokenize'
import { type StepUnit, stepScore, unitDurationMs } from './unitize'

const SUMMARY_ARGS_CHARS = 90
const SUMMARY_TEXT_CHARS = 140

function firstToolCall(unit: StepUnit): ToolCall | undefined {
  for (const m of unit.responses) {
    if (m.toolCalls && m.toolCalls.length > 0) return m.toolCalls[0]
  }
  return undefined
}

/** One response piece: a commentary message's tool call(s) or the final text. */
function ResponsePiece({ message, logprobMode }: { message: Message; logprobMode: LogprobMode }) {
  // Per the logprob contract: an active token view replaces rich/plain text rendering.
  const tokenMode = logprobMode === 'off' ? undefined : logprobMode
  const real = message.tokens !== undefined && message.tokens.length > 0 ? message.tokens : null
  const isToolCall = message.toolCalls !== undefined && message.toolCalls.length > 0
  // 'tokens' mode falls back to client-side BPE segmentation of the final text
  // when the message has no real token data; 'probs' stays off (no real probs).
  const synthetic = useMemo(
    () =>
      tokenMode === 'tokens' && real === null && !isToolCall ? bpeTokens(message.content) : [],
    [tokenMode, real, isToolCall, message.content],
  )
  const tokens = real ?? (synthetic.length > 0 ? synthetic : null)
  return (
    <div data-testid="step-response" data-kind={isToolCall ? 'toolCall' : 'final'}>
      {isToolCall ? (
        <div className="space-y-2">
          {message.content && (
            <RichTextBlock
              id={message.id}
              text={message.content}
              label="COMMENTARY"
              tone={FOLD_TONES.toolCall}
            />
          )}
          {message.toolCalls?.map((call) => (
            <ToolCallBlock key={call.id} call={call} />
          ))}
          {tokenMode && tokens && (
            <div
              className="rounded-md border border-indigo-200 bg-indigo-50/30 px-2 py-1.5"
              data-testid="arguments-logprobs"
            >
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
                Arguments logprobs
              </p>
              <TokenLogprobText tokens={tokens} mode={tokenMode} />
            </div>
          )}
        </div>
      ) : tokenMode && tokens ? (
        <TokenLogprobText tokens={tokens} mode={tokenMode} className="px-1.5 py-0.5" />
      ) : (
        <RichTextBlock
          id={message.id}
          text={message.content}
          label="ASSISTANT RESPONSE"
          tone={FOLD_TONES.final}
        />
      )}
      {message.judgeOutput && <JudgeCallout text={message.judgeOutput} />}
      <MessageMeta message={message} logprobMode={logprobMode} light />
    </div>
  )
}

/** Collapsed body: one summary line + a violet dot when hidden reasoning exists. */
function CollapsedSummary({ unit }: { unit: StepUnit }) {
  const call = firstToolCall(unit)
  const finalText = unit.responses.find((m) => !m.toolCalls?.length && m.content)?.content
  return (
    <div
      className="flex items-center gap-2 border-t border-emerald-100 px-2.5 py-1.5"
      data-testid="step-summary"
    >
      {unit.analysis.length > 0 && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400"
          title="Has reasoning — expand the step to view"
          data-testid="reasoning-dot"
        />
      )}
      {call ? (
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">
          <span className="font-semibold text-indigo-600">TOOL CALL</span>
          {' · '}
          {call.name} {call.arguments.slice(0, SUMMARY_ARGS_CHARS)}
        </p>
      ) : finalText ? (
        <p className="min-w-0 flex-1 truncate text-sm text-slate-400">
          {finalText.slice(0, SUMMARY_TEXT_CHARS)}
        </p>
      ) : (
        <p className="text-xs text-slate-400 italic">(no response content)</p>
      )}
    </div>
  )
}

/**
 * One agent response as a single unit: header (step badge + aggregate meta),
 * nested reasoning widget (collapsed by default, always), then the response
 * content — tool call(s) or the final text. Expand state lives in the parent,
 * never inside recycled rows.
 */
export function StepCard({
  unit,
  expanded,
  onToggle,
  reasoningOpen,
  onToggleReasoning,
  logprobMode = 'off',
}: {
  unit: StepUnit
  expanded: boolean
  onToggle: () => void
  reasoningOpen: boolean
  onToggleReasoning: () => void
  logprobMode?: LogprobMode
}) {
  const first = unit.messages[0]
  const number = first ? messageNumber(first.id) : undefined
  const durationMs = unitDurationMs(unit)
  const score = stepScore(unit)
  // unit.messages holds exactly the step's assistant messages (see buildUnits).
  const tokenCount = unit.messages.reduce((acc, m) => acc + messageTokens(m), 0)
  const reasoningText = unit.analysis.map((m) => m.content).join('\n\n')
  return (
    <div className="py-1.5" data-testid="step-card" data-step={unit.stepIndex}>
      <div className="rounded-lg border border-l-4 border-emerald-200 border-l-emerald-400 bg-white">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          data-testid="step-toggle"
          className="flex w-full items-center gap-2 rounded-t-lg px-2.5 py-1.5 text-left hover:bg-emerald-50/60"
        >
          <span
            className={`inline-block text-[10px] text-emerald-400 transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          >
            ▸
          </span>
          {unit.stepIndex !== undefined && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white">
              Step {unit.stepIndex}
            </span>
          )}
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            Assistant
          </span>
          {number !== undefined && (
            <span className="font-mono text-[10px] text-slate-400" data-testid="message-number">
              #{number}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-slate-400">
            {durationMs !== undefined && <span>{formatDuration(durationMs)}</span>}
            {score !== undefined && (
              <span
                className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700"
                data-testid="step-reward-chip"
              >
                Reward: {formatScore(score)}
              </span>
            )}
            <span
              className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
              data-testid="step-tokens-chip"
            >
              Tokens ({formatNumber(tokenCount)})
            </span>
            <span>{formatTimestamp(first?.timestamp)}</span>
          </span>
        </button>
        {expanded ? (
          <div className="space-y-2 border-t border-emerald-100 px-2.5 pt-2 pb-2">
            {unit.analysis.length > 0 && (
              <div
                className="rounded-lg border border-l-4 border-violet-200 border-l-violet-400 bg-violet-50 px-2 py-1.5"
                data-testid="step-reasoning"
              >
                <FoldSection
                  label="REASONING"
                  text={reasoningText}
                  tone={FOLD_TONES.analysis}
                  expanded={reasoningOpen}
                  onToggle={onToggleReasoning}
                  testId="reasoning-toggle"
                />
              </div>
            )}
            {unit.analysis.map(
              (m) => m.judgeOutput && <JudgeCallout key={m.id} text={m.judgeOutput} />,
            )}
            {unit.responses.map((m) => (
              <ResponsePiece key={m.id} message={m} logprobMode={logprobMode} />
            ))}
          </div>
        ) : (
          <CollapsedSummary unit={unit} />
        )}
      </div>
    </div>
  )
}
