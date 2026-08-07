import type { Trace } from '@shared/schema/types'
import { useMemo } from 'react'
import { type UnifiedFailure, unifiedFailures } from './failureSource'
import { failureChipLabel } from './MessageCard'
import { WorldStateSections } from './StateToolsTab'

// Re-exported so existing imports keep resolving; the implementation moved to
// the unified failure source module.
export { failureMessageId } from './failureSource'

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

function FailureRow({
  failure,
  onJumpToMessage,
}: {
  failure: UnifiedFailure
  onJumpToMessage?: (messageId: string) => void
}) {
  const targetMessageId = failure.messageId
  const anchorLabel = failure.anchorLabel
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
      <td className="px-3 py-2 font-mono text-xs text-slate-800">
        {failureChipLabel(failure)}
        {failure.metadataOnly && (
          <span
            className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-medium text-slate-500"
            title="Present only in message metadata; missing from the normalized evaluation layer"
          >
            metadata fill-in
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-slate-600">
        {targetMessageId !== undefined && onJumpToMessage !== undefined ? (
          <button
            type="button"
            onClick={() => onJumpToMessage(targetMessageId)}
            className="font-mono text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
            title="Open this message in the conversation"
          >
            {anchorLabel} ↗
          </button>
        ) : (
          <span
            title={anchorLabel === '—' ? 'No declared message index space' : 'Message not found'}
          >
            {anchorLabel}
          </span>
        )}
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

function failureKey(failure: UnifiedFailure, index: number): string {
  return JSON.stringify([
    index,
    failure.origin,
    failure.code,
    failure.source,
    failure.messageId,
    failure.anchorLabel,
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

export function EvaluationTab({
  trace,
  onJumpToMessage,
}: {
  trace: Trace
  onJumpToMessage?: (messageId: string) => void
}) {
  const evaluation = trace.evaluation
  // Single failure source: evaluation.failures first, message metadata as fill-in.
  const failures = useMemo(() => unifiedFailures(trace), [trace])
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
          {failures.length} findings ·{' '}
          {evaluation.checks.filter((check) => check.gating && !check.ok).length} failed gating
          checks
        </span>
      </div>
      {evaluation.lineage?.synthetic && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <b>Synthetic regression rerun · formal metrics excluded</b>
          <p className="mt-1 text-amber-800">
            Parent{' '}
            <span className="font-mono">{evaluation.lineage.parentTraceUid ?? 'unknown'}</span>
            {evaluation.lineage.regressionId
              ? ` · regression ${evaluation.lineage.regressionId}`
              : ''}
            . Scenario evidence was reconstructed from production; environment state and future
            generation were regenerated.
          </p>
        </div>
      )}
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
        {failures.length === 0 ? (
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
                {failures.map((failure, index) => (
                  <FailureRow
                    key={failureKey(failure, index)}
                    failure={failure}
                    onJumpToMessage={onJumpToMessage}
                  />
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
      {/* World diff + tool ledger are evaluation evidence, not a separate tab. */}
      <WorldStateSections evaluation={evaluation} />
    </div>
  )
}
