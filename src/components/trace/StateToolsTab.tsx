import type { Trace, TraceEvaluation } from '@shared/schema/types'

/**
 * World diff + tool ledger evidence sections. Rendered inside the Evaluation
 * tab (state is evaluation evidence); StateToolsTab remains as a standalone
 * wrapper for direct embedding.
 */
export function WorldStateSections({ evaluation }: { evaluation: TraceEvaluation }) {
  return (
    <>
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
          World diff · {evaluation.worldDiff.length}
        </h2>
        {evaluation.worldDiff.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">No persistent world changes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Entity</th>
                  <th>Field</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Legal</th>
                </tr>
              </thead>
              <tbody>
                {evaluation.worldDiff.map((entry) => (
                  <tr key={JSON.stringify(entry)} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono">{entry.orderId ?? '—'}</td>
                    <td className="font-mono">{entry.field}</td>
                    <td
                      className="max-w-sm truncate pr-3 text-slate-500"
                      title={JSON.stringify(entry.before)}
                    >
                      {JSON.stringify(entry.before)}
                    </td>
                    <td
                      className="max-w-sm truncate pr-3 text-slate-800"
                      title={JSON.stringify(entry.after)}
                    >
                      {JSON.stringify(entry.after)}
                    </td>
                    <td>{entry.legal === undefined ? '—' : entry.legal ? '✓' : '✕'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
          Tool ledger · {evaluation.ledger.length}
        </h2>
        {evaluation.ledger.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">No offline-twin ledger was recorded.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {evaluation.ledger.map((entry) => (
              <details
                key={
                  entry.toolCallId ??
                  JSON.stringify([
                    entry.name,
                    entry.timestamp,
                    entry.sourceTimestampSeconds,
                    entry.args,
                  ])
                }
                className="group"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs hover:bg-slate-50">
                  <span
                    className={
                      entry.outcomeKnown === false
                        ? 'text-amber-600'
                        : entry.ok === false
                          ? 'text-red-600'
                          : 'text-emerald-600'
                    }
                  >
                    {entry.outcomeKnown === false ? '?' : entry.ok === false ? '✕' : '✓'}
                  </span>
                  <b className="font-mono">{entry.name}</b>
                  {entry.tier && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
                      {entry.tier}
                    </span>
                  )}
                  <span className="ml-auto text-slate-400">
                    executed {String(entry.executed ?? '—')} · outcome known{' '}
                    {String(entry.outcomeKnown ?? '—')}
                  </span>
                </summary>
                {entry.outcomeKnown === false && (
                  <p className="bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">
                    Unknown tool outcome: the model-visible response may differ from the actual side
                    effect. Inspect both values before retrying a write.
                  </p>
                )}
                <div className="grid gap-3 bg-slate-50 px-4 py-3 lg:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-medium uppercase text-slate-400">Arguments</p>
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-xs">
                      {JSON.stringify(entry.args, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase text-slate-400">
                      Model-visible result
                    </p>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-xs">
                      {typeof entry.result === 'string'
                        ? entry.result
                        : JSON.stringify(entry.result, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase text-slate-400">
                      Actual tool outcome
                    </p>
                    {'actualResult' in entry ? (
                      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-xs">
                        {typeof entry.actualResult === 'string'
                          ? entry.actualResult
                          : JSON.stringify(entry.actualResult, null, 2)}
                      </pre>
                    ) : (
                      <p className="mt-1 rounded bg-white p-2 text-xs text-slate-400">
                        Not recorded{entry.actualResultHead ? ` · ${entry.actualResultHead}` : ''}
                      </p>
                    )}
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

export function StateToolsTab({ trace }: { trace: Trace }) {
  const evaluation = trace.evaluation
  if (!evaluation)
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        No ACE world-state or ledger artifact is attached to this trace.
      </div>
    )
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <WorldStateSections evaluation={evaluation} />
    </div>
  )
}
