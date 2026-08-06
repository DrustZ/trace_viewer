import type { Message } from '@shared/schema/types'
import { FoldSection, type FoldTone } from '../common/CollapsibleText'
import { formatDuration } from '../common/format'
import { MarkdownContent, RichRawToggle, useViewMode } from '../common/MarkdownContent'

/** Collapsed preview length — the one-line-ish clamp shown behind the fold. */
const PREVIEW = 200

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

/**
 * Tool name → highlight.js language for code-producing tools. Their output is source
 * or code-shaped, so it's wrapped in a fenced block of this language and highlighted.
 */
const TOOL_LANG: Record<string, string> = {
  python: 'python',
  run_tests: 'python',
  run_test: 'python',
  execute_code: 'python',
  pytest: 'python',
  bash: 'bash',
  shell: 'bash',
  sh: 'bash',
}

/** Language for fenced highlighting, or undefined when the output is plain terminal text. */
function resolveLang(toolName: string | undefined, content: string): string | undefined {
  if (/^diff --git /m.test(content) || /^@@ .* @@/m.test(content)) return 'diff'
  if (toolName === undefined) return undefined
  return TOOL_LANG[toolName.toLowerCase()]
}

/**
 * 'Rich' rendering of tool output. Content that already carries fenced code, or comes
 * from a code tool (python/run_tests/…), goes through MarkdownContent so rehype-highlight
 * colours it by language; everything else stays as plain monospaced terminal text.
 */
function RichToolBody({ text, toolName }: { text: string; toolName?: string }) {
  if (text.includes('```')) return <MarkdownContent text={text} />
  const lang = resolveLang(toolName, text)
  if (lang !== undefined) return <MarkdownContent text={`\`\`\`${lang}\n${text}\n\`\`\``} />
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800">
      {text}
    </pre>
  )
}

/**
 * Tool output card. Defaults to the 'Rich' view: code-tool output is highlighted by
 * language (fenced through MarkdownContent), plain terminal output stays monospaced.
 * The 'Raw' pill drops back to unstyled text; the choice is per message id and
 * session-persistent (survives virtualization recycling).
 *
 * The body fold (expanded/onToggle) is lifted to ConversationView so Collapse/Expand all
 * can clamp/open tool results alongside system/developer folds.
 */
export function ToolResultBlock({
  message,
  /** Resolved by the parent from the trace's callId→name map; omitted ⇒ id-only chip. */
  toolName,
  expanded,
  onToggle,
}: {
  message: Message
  toolName?: string
  expanded: boolean
  onToggle: () => void
}) {
  const [view, setView] = useViewMode(message.id, 'rich')
  const isError = message.toolResult?.isError ?? false
  const durationMs = message.toolResult?.durationMs
  const callId = message.toolResult?.toolCallId
  const callLabel =
    callId !== undefined && callId !== ''
      ? callId.startsWith('call')
        ? callId
        : `call-${callId}`
      : undefined
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
        {(callLabel !== undefined || toolName !== undefined) && (
          <span
            data-testid="tool-result-call-chip"
            title="Tool result identity"
            className="truncate rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
          >
            {[callLabel, toolName].filter((part) => part !== undefined).join(' · ')}
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
        <FoldSection
          label="OUTPUT"
          text={message.content}
          tone={isError ? RED : CYAN}
          mono
          blockPreview
          previewChars={PREVIEW}
          expanded={expanded}
          onToggle={onToggle}
          renderText={
            view === 'rich' ? (t) => <RichToolBody text={t} toolName={toolName} /> : undefined
          }
        />
      </div>
    </div>
  )
}
