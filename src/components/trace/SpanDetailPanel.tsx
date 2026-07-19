import type { ReactNode } from 'react'
import { formatDuration, formatTimestamp } from '../common/format'
import { JsonTree } from '../common/JsonTree'
import type { ProfSpan, SpanKind } from './profSpans'

const KIND_BADGE: Record<SpanKind, string> = {
  trace: 'bg-blue-50 text-blue-700',
  io: 'bg-slate-100 text-slate-600',
  model: 'bg-violet-50 text-violet-700',
  sandbox: 'bg-orange-50 text-orange-700',
  grader: 'bg-emerald-50 text-emerald-700',
}

/** Absolute wall-clock time = trace start + offset, with millisecond precision. */
function absTime(traceStartIso: string, offsetMs: number): string {
  const base = Date.parse(traceStartIso)
  if (!Number.isFinite(base)) return `+${formatDuration(offsetMs)}`
  const d = new Date(base + offsetMs)
  return `${formatTimestamp(d.toISOString())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-slate-400">{label}</span>
      <span className="min-w-0 text-right text-xs text-slate-700">{children}</span>
    </div>
  )
}

/** Right-hand detail panel for the selected span. */
export function SpanDetailPanel({
  span,
  traceStartIso,
}: {
  span: ProfSpan | null
  /** meta.timestamp — spans' startMs are relative to it. */
  traceStartIso: string
}) {
  if (!span) {
    return (
      <div
        data-testid="span-detail"
        className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-xs text-slate-400"
      >
        Select a span to inspect it
      </div>
    )
  }
  const exception = typeof span.detail?.exception === 'string' ? span.detail.exception : null
  const hasMetrics = span.detail !== undefined && Object.keys(span.detail).length > 0
  return (
    <div data-testid="span-detail" className="rounded-lg border border-slate-200 bg-white p-4">
      {exception && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs break-all text-red-700">
          {exception}
        </div>
      )}
      <div className="font-mono text-sm font-semibold break-all text-slate-900">{span.name}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${KIND_BADGE[span.kind]}`}
        >
          {span.kind}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
            span.status === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {span.status}
        </span>
      </div>
      <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
        <Row label="Duration">
          <span className="font-mono">{formatDuration(span.durationMs)}</span>
        </Row>
        <Row label="Started">
          <span className="font-mono">{absTime(traceStartIso, span.startMs)}</span>
        </Row>
        <Row label="Ended">
          <span className="font-mono">
            {absTime(traceStartIso, span.startMs + span.durationMs)}
          </span>
        </Row>
        {span.messageId && (
          <Row label="Message">
            <span className="font-mono">{span.messageId}</span>{' '}
            <span className="text-slate-400">(see conversation tab)</span>
          </Row>
        )}
      </div>
      {hasMetrics && (
        <div className="mt-3">
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Metrics
          </h3>
          <JsonTree value={span.detail} />
        </div>
      )}
    </div>
  )
}
