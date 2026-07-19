import type { Message } from '@shared/schema/types'
import { CollapsibleText } from '../common/CollapsibleText'
import { formatDuration } from '../common/format'

export function ToolResultBlock({ message }: { message: Message }) {
  const isError = message.toolResult?.isError ?? false
  const durationMs = message.toolResult?.durationMs
  const tone = isError ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'
  const headerTone = isError ? 'text-red-700' : 'text-emerald-700'

  return (
    <div className={`rounded-lg border ${tone}`}>
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
      <div className="px-3 pb-2">
        <CollapsibleText text={message.content} mono />
      </div>
    </div>
  )
}
