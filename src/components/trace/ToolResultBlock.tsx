import type { Message } from '@shared/schema/types'
import { FoldSection, type FoldTone } from '../common/CollapsibleText'
import { formatDuration } from '../common/format'
import { RichRawToggle, useViewMode } from '../common/MarkdownContent'

/** Output above this length is clamped behind the fold control. */
const CLAMP = 2500

const CYAN: FoldTone = {
  label: 'text-cyan-700',
  chevron: 'text-cyan-500',
  hover: 'hover:bg-cyan-100/70',
}
const RED: FoldTone = {
  label: 'text-red-700',
  chevron: 'text-red-400',
  hover: 'hover:bg-red-100/70',
}

/** 'Rich' view for terminal output: fenced-code styling, not markdown parsing. */
function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">
      {text}
    </pre>
  )
}

/**
 * Tool output card. Terminal output is not markdown, so 'Raw' is the default view;
 * the pill's 'Rich' renders fenced-code style instead. Choice is per message id,
 * session-persistent (survives virtualization recycling).
 */
export function ToolResultBlock({
  message,
  /** Resolved by the parent from the trace's callId→name map; omitted ⇒ id-only chip. */
  toolName,
}: {
  message: Message
  toolName?: string
}) {
  const [view, setView] = useViewMode(message.id, 'raw')
  const isError = message.toolResult?.isError ?? false
  const durationMs = message.toolResult?.durationMs
  const callId = message.toolResult?.toolCallId
  const callLabel =
    callId !== undefined ? (callId.startsWith('call') ? callId : `call-${callId}`) : undefined
  const card = isError
    ? 'border-red-200 border-l-red-400 bg-red-50'
    : 'border-cyan-200 border-l-cyan-400 bg-cyan-50'
  const headerTone = isError ? 'text-red-700' : 'text-cyan-700'

  return (
    <div className={`rounded-lg border border-l-4 ${card}`} data-testid="tool-result">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className={`text-xs font-semibold tracking-wide ${headerTone}`}>RESULT</span>
        {isError && (
          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            ERROR
          </span>
        )}
        {callLabel !== undefined && (
          <span
            data-testid="tool-result-call-chip"
            title="Tool call this result belongs to"
            className="truncate rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
          >
            {callLabel}
            {toolName !== undefined ? ` · ${toolName}` : ''}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <RichRawToggle mode={view} onChange={setView} />
          {durationMs !== undefined && (
            <span className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
              {formatDuration(durationMs)}
            </span>
          )}
        </span>
      </div>
      <div className="px-2 pb-1.5">
        {message.content.length <= CLAMP ? (
          view === 'rich' ? (
            <CodeBlock text={message.content} />
          ) : (
            <div className="whitespace-pre-wrap break-words px-1.5 font-mono text-xs">
              {message.content}
            </div>
          )
        ) : (
          <FoldSection
            label="OUTPUT"
            text={message.content}
            tone={isError ? RED : CYAN}
            mono
            blockPreview
            previewChars={CLAMP}
            renderText={view === 'rich' ? (t) => <CodeBlock text={t} /> : undefined}
          />
        )}
      </div>
    </div>
  )
}
