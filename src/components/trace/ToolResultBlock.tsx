import type { Message } from '@shared/schema/types'
import { FoldSection, type FoldTone } from '../common/CollapsibleText'
import { formatDuration } from '../common/format'

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

export function ToolResultBlock({ message }: { message: Message }) {
  const isError = message.toolResult?.isError ?? false
  const durationMs = message.toolResult?.durationMs
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
        {durationMs !== undefined && (
          <span className="ml-auto rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            {formatDuration(durationMs)}
          </span>
        )}
      </div>
      <div className="px-2 pb-1.5">
        {message.content.length <= CLAMP ? (
          <div className="whitespace-pre-wrap break-words px-1.5 font-mono text-xs">
            {message.content}
          </div>
        ) : (
          <FoldSection
            label="OUTPUT"
            text={message.content}
            tone={isError ? RED : CYAN}
            mono
            blockPreview
            previewChars={CLAMP}
          />
        )}
      </div>
    </div>
  )
}
