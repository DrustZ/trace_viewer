import type { ToolCall } from '@shared/schema/types'
import { JsonTree } from '../common/JsonTree'

export function ToolCallBlock({
  call,
  /** True when this call's matching tool result errored; resolvable only where both live. */
  resultIsError,
}: {
  call: ToolCall
  resultIsError?: boolean
}) {
  return (
    <div className="rounded-md border border-indigo-200 bg-white" data-testid="tool-call">
      <div className="flex flex-wrap items-baseline gap-2 rounded-t-md border-b border-indigo-100 bg-indigo-50/70 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
          Call
        </span>
        <span className="font-mono text-xs font-semibold text-indigo-900">{call.name}</span>
        <span className="font-mono text-[10px] text-indigo-300">{call.id}</span>
        {resultIsError === true && (
          <span
            data-testid="tool-call-error-dot"
            title="The matching tool result reported an error"
            className="inline-block h-1.5 w-1.5 self-center rounded-full bg-red-500"
          />
        )}
      </div>
      <div className="px-3 py-2">
        {call.parseError !== undefined ? (
          <div className="rounded-md border-2 border-red-400 bg-red-50 p-2">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-red-900">
              {call.arguments}
            </pre>
            <p className="mt-1.5 text-xs font-bold text-red-700">
              Malformed JSON: {call.parseError}
            </p>
          </div>
        ) : call.parsedArguments !== undefined ? (
          <JsonTree value={call.parsedArguments} />
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-slate-700">
            {call.arguments}
          </pre>
        )}
      </div>
    </div>
  )
}
