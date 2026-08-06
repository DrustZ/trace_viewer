import type { Message, ToolCall } from '@shared/schema/types'
import { messageTokens } from '@shared/stats/computeStats'
import { FoldSection } from '../common/CollapsibleText'
import { formatDuration, formatNumber, formatScore, formatTimestamp } from '../common/format'
import { FOLD_TONES, JudgeCallout, MessageMeta, messageNumber, RichTextBlock } from './MessageCard'
import {
  MessageViewHeader,
  RawMessageJson,
  TokenInspector,
  useMessageViewTab,
} from './TokenInspector'
import { ToolCallBlock } from './ToolCallBlock'
import { type StepUnit, stepScore, unitDurationMs } from './unitize'

const SUMMARY_ARGS_CHARS = 90
const SUMMARY_TEXT_CHARS = 140

/**
 * toolCallId → result.isError across a whole trace. Tool results are standalone
 * units (never inside a StepUnit), so the message-list owner builds this and
 * passes it down for the error dot on ToolCallBlock.
 */
export function buildResultErrorMap(messages: readonly Message[]): Map<string, boolean> {
  const map = new Map<string, boolean>()
  for (const m of messages) {
    if (m.toolResult !== undefined) map.set(m.toolResult.toolCallId, m.toolResult.isError)
  }
  return map
}

function firstToolCall(unit: StepUnit): ToolCall | undefined {
  for (const m of unit.responses) {
    if (m.toolCalls && m.toolCalls.length > 0) return m.toolCalls[0]
  }
  return undefined
}

/** Known agent variants get stable colors; anything else falls back to slate. */
const AGENT_CHIP_CLS: Record<string, string> = {
  alpha: 'bg-violet-100 text-violet-700',
  beta: 'bg-sky-100 text-sky-700',
  human: 'bg-amber-100 text-amber-800',
}

/**
 * Distinct metadata.agentType values across the step's messages (multi-agent
 * transcripts label who produced each assistant message: alpha / beta / human).
 */
function agentTypes(unit: StepUnit): string[] {
  const seen: string[] = []
  for (const m of unit.messages) {
    const agent = m.metadata?.agentType
    if (typeof agent === 'string' && agent !== '' && !seen.includes(agent)) seen.push(agent)
  }
  return seen
}

/** One response piece: a commentary message's tool call(s) or the final text. */
function ResponsePiece({
  message,
  resultErrorByCallId,
}: {
  message: Message
  resultErrorByCallId?: ReadonlyMap<string, boolean>
}) {
  const [tab, setTab] = useMessageViewTab(message.id)
  const isToolCall = message.toolCalls !== undefined && message.toolCalls.length > 0
  return (
    <div data-testid="step-response" data-kind={isToolCall ? 'toolCall' : 'final'}>
      <MessageViewHeader
        message={message}
        tab={tab}
        onChange={setTab}
        // Harmony semantics: the final piece ends with <|return|>, other pieces with <|end|>.
        termination={isToolCall ? 'end' : 'return'}
        className="mb-0.5 px-1.5 pt-0.5"
      />
      {tab === 'raw' ? (
        <RawMessageJson message={message} />
      ) : tab === 'tokens' ? (
        // For commentary pieces the recorded tokens cover the tool-call arguments.
        <TokenInspector message={message} className="px-1.5 py-0.5" />
      ) : isToolCall ? (
        <div className="space-y-2">
          {message.content && (
            <RichTextBlock text={message.content} label="COMMENTARY" tone={FOLD_TONES.toolCall} />
          )}
          {message.toolCalls?.map((call) => (
            <ToolCallBlock
              key={call.id}
              call={call}
              resultIsError={resultErrorByCallId?.get(call.id)}
            />
          ))}
        </div>
      ) : (
        <RichTextBlock text={message.content} label="ASSISTANT RESPONSE" tone={FOLD_TONES.final} />
      )}
      {message.judgeOutput && <JudgeCallout text={message.judgeOutput} />}
      <MessageMeta message={message} light />
    </div>
  )
}

/** One analysis message inside the expanded reasoning fold, with its own view tabs. */
function AnalysisPiece({ message }: { message: Message }) {
  const [tab, setTab] = useMessageViewTab(message.id)
  return (
    <div data-testid="analysis-piece">
      <MessageViewHeader
        message={message}
        tab={tab}
        onChange={setTab}
        termination="end"
        className="mb-0.5"
      />
      {tab === 'raw' ? (
        <RawMessageJson message={message} />
      ) : tab === 'tokens' ? (
        <TokenInspector message={message} className="py-0.5" />
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm">{message.content}</div>
      )}
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
  resultErrorByCallId,
}: {
  unit: StepUnit
  expanded: boolean
  onToggle: () => void
  reasoningOpen: boolean
  onToggleReasoning: () => void
  /** From buildResultErrorMap(trace.messages); omitted ⇒ no error dots on calls. */
  resultErrorByCallId?: ReadonlyMap<string, boolean>
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
          {agentTypes(unit).map((agent) => (
            <span
              key={agent}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                AGENT_CHIP_CLS[agent] ?? 'bg-slate-100 text-slate-600'
              }`}
              data-testid="agent-chip"
            >
              {agent}
            </span>
          ))}
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
                className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-2 py-1.5"
                data-testid="step-reasoning"
              >
                <FoldSection
                  label="REASONING"
                  text={reasoningText}
                  tone={FOLD_TONES.analysis}
                  expanded={reasoningOpen}
                  onToggle={onToggleReasoning}
                  testId="reasoning-toggle"
                  renderText={() => (
                    <div className="space-y-2">
                      {unit.analysis.map((m) => (
                        <AnalysisPiece key={m.id} message={m} />
                      ))}
                    </div>
                  )}
                />
              </div>
            )}
            {unit.analysis.map(
              (m) => m.judgeOutput && <JudgeCallout key={m.id} text={m.judgeOutput} />,
            )}
            {unit.responses.map((m) => (
              <ResponsePiece key={m.id} message={m} resultErrorByCallId={resultErrorByCallId} />
            ))}
          </div>
        ) : (
          <CollapsedSummary unit={unit} />
        )}
      </div>
    </div>
  )
}
