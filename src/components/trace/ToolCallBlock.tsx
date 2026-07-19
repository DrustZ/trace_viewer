import type { ToolCall } from '@shared/schema/types'
import { JsonTree } from '../common/JsonTree'

export function ToolCallBlock({ call }: { call: ToolCall }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-slate-100 px-3 py-1.5">
        <span className="text-xs font-semibold tracking-wide text-slate-600">
          TOOL CALL · {call.name}
        </span>
        <span className="font-mono text-xs text-slate-400">{call.id}</span>
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
