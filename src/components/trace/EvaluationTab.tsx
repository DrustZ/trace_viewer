import type { FailureV1, Trace } from '@shared/schema/types'

function OutcomeBadge({ outcome }: { outcome: string }) {
  const cls =
    outcome === 'pass'
      ? 'bg-emerald-100 text-emerald-800'
      : outcome === 'fail' || outcome === 'runtime_error'
        ? 'bg-red-100 text-red-800'
        : outcome === 'invalid'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-slate-100 text-slate-700'
  return (
    <span className={`rounded px-2 py-1 text-xs font-semibold uppercase ${cls}`}>
      {outcome.replace('_', ' ')}
    </span>
  )
}

function FailureRow({ failure }: { failure: FailureV1 }) {
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-3 py-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${failure.severity === 'major' || failure.severity === 'critical' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}
        >
          {failure.severity}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">{failure.origin}</td>
      <td className="px-3 py-2 font-mono text-xs text-slate-800">{failure.code}</td>
      <td className="px-3 py-2 text-xs text-slate-600">
        {failure.messageId ??
          (failure.rawIndex !== undefined ? `raw #${failure.rawIndex + 1}` : '—')}
      </td>
      <td className="max-w-xl px-3 py-2 text-xs text-slate-600">
        {typeof failure.evidence === 'string'
          ? failure.evidence
          : failure.evidence
            ? JSON.stringify(failure.evidence)
            : '—'}
      </td>
      <td className="px-3 py-2 text-center text-xs">{failure.gating ? '●' : '—'}</td>
    </tr>
  )
}

function failureKey(failure: FailureV1): string {
  return JSON.stringify([
    failure.origin,
    failure.code,
    failure.source,
    failure.messageId,
    failure.toolCallId,
    failure.indexSpace,
    failure.rawIndex,
    failure.chronologicalIndex,
    failure.evidence,
  ])
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function EvaluationTab({ trace }: { trace: Trace }) {
  const evaluation = trace.evaluation
  if (!evaluation) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
          <h2 className="text-sm font-medium text-slate-700">Ungraded trace</h2>
          <p className="mt-1 text-xs text-slate-500">
            This source does not provide task grading. Tool outcomes and corpus diagnostics remain
            available without being mislabeled as success.
          </p>
        </div>
      </div>
    )
  }
  const gate = evaluation.userSimGate
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <OutcomeBadge outcome={evaluation.outcome} />
        <span className="text-xs text-slate-500">
          lifecycle {evaluation.lifecycle.state}
          {evaluation.lifecycle.pendingPhase
            ? ` · pending ${evaluation.lifecycle.pendingPhase}`
            : ''}
          {evaluation.lifecycle.termination ? ` · ${evaluation.lifecycle.termination}` : ''}
        </span>
        <span className="ml-auto text-xs text-slate-500">
          {evaluation.failures.length} findings ·{' '}
          {evaluation.checks.filter((check) => check.gating && !check.ok).length} failed gating
          checks
        </span>
      </div>
      <Card title="Programmatic grade checks">
        {evaluation.checks.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">No task grader was run.</p>
        ) : (
          <div className="grid gap-px bg-slate-100 md:grid-cols-2">
            {evaluation.checks.map((check) => (
              <div key={check.name} className="bg-white p-3">
                <div className="flex items-center gap-2">
                  <span className={check.ok ? 'text-emerald-600' : 'text-red-600'}>
                    {check.ok ? '✓' : '✕'}
                  </span>
                  <b className="font-mono text-xs">{check.name}</b>
                  {check.gating && (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">
                      GATING
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {check.detail ?? 'No detail recorded'}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Normalized failures">
        {evaluation.failures.length === 0 ? (
          <p className="p-4 text-xs text-emerald-700">No normalized failures.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Severity</th>
                  <th>Origin</th>
                  <th>Code</th>
                  <th>Anchor</th>
                  <th>Evidence</th>
                  <th>Gating</th>
                </tr>
              </thead>
              <tbody>
                {evaluation.failures.map((failure) => (
                  <FailureRow key={failureKey(failure)} failure={failure} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {gate && (
        <Card title="User simulator validity">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <OutcomeBadge outcome={gate.invalid ? 'invalid' : 'pass'} />
              <span className="text-xs text-slate-500">
                attempt {gate.attempt ?? '—'} · environment seed{' '}
                {gate.environmentSeed ?? gate.seed ?? '—'}
              </span>
            </div>
            {gate.violations.length > 0 && (
              <ul className="mt-3 space-y-1">
                {gate.violations.map((item) => (
                  <li
                    key={JSON.stringify([
                      item.rule,
                      item.messageId,
                      item.rawIndex,
                      item.chronologicalIndex,
                      item.note,
                    ])}
                    className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
                  >
                    <b>{item.rule}</b>
                    {item.note ? ` — ${item.note}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
      {(evaluation.judge || evaluation.semanticVerify) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {evaluation.judge && (
            <Card title="Judge · shadow only">
              <div className="space-y-2 p-4">
                {Object.entries(evaluation.judge.dimensions).map(([name, value]) => (
                  <div key={name} className="rounded border border-slate-100 p-2 text-xs">
                    <b>{name}</b> · {value.verdict}
                    <p className="text-slate-500">{value.evidence ?? 'No evidence recorded'}</p>
                  </div>
                ))}
                {evaluation.judge.disagreement && (
                  <p className="rounded bg-violet-50 px-2 py-1 text-xs text-violet-700">
                    Judge disagrees with the deterministic grader; prioritize blind review.
                  </p>
                )}
              </div>
            </Card>
          )}
          {evaluation.semanticVerify && (
            <Card title="Semantic verification · shadow only">
              <div className="p-4 text-xs">
                <p>
                  {evaluation.semanticVerify.supportedCount ?? 0} supported ·{' '}
                  <span className="text-red-700">
                    {evaluation.semanticVerify.contradictedCount ?? 0} contradicted
                  </span>{' '}
                  · {evaluation.semanticVerify.unverifiedCount ?? 0} unverified
                </p>
                <ul className="mt-2 space-y-1">
                  {evaluation.semanticVerify.claims
                    .filter((claim) => claim.verdict !== 'supported')
                    .map((claim) => (
                      <li
                        key={JSON.stringify([
                          claim.kind,
                          claim.messageId,
                          claim.rawIndex,
                          claim.chronologicalIndex,
                          claim.span,
                          claim.value,
                          claim.verdict,
                        ])}
                        className="rounded bg-slate-50 px-2 py-1"
                      >
                        {claim.kind ?? 'claim'}={JSON.stringify(claim.value)} · {claim.verdict}
                      </li>
                    ))}
                </ul>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
