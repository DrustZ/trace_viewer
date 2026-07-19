import type { Trace } from '@shared/schema/types'
import { messageTokens } from '@shared/stats/computeStats'
import { useMemo } from 'react'
import { formatNumber } from '../common/format'
import { ScoreBadge } from '../common/ScoreBadge'

/** Token-breakdown segments, in bar order. Keys index into the computed totals. */
const SEGMENTS = [
  { key: 'system', label: 'System', cls: 'bg-slate-400' },
  { key: 'user', label: 'User', cls: 'bg-blue-400' },
  { key: 'tool', label: 'Tool response', cls: 'bg-cyan-400' },
  { key: 'reasoning', label: 'Reasoning', cls: 'bg-violet-400' },
  { key: 'toolCall', label: 'Tool call', cls: 'bg-indigo-400' },
  { key: 'final', label: 'Final', cls: 'bg-emerald-400' },
] as const

type SegmentKey = (typeof SEGMENTS)[number]['key']

/** meta.extra keys already surfaced as reference blocks elsewhere — not metrics. */
const NON_METRIC_EXTRA = new Set(['ground_truth', 'success_criteria', 'golden_response'])

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-700 tabular-nums">{value}</span>
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="mt-4 mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </p>
  )
}

/** Right pane of the compact mode: whole-trace metrics, all derived client-side. */
export function TraceMetricsPanel({ trace }: { trace: Trace }) {
  const { meta, stats } = trace

  const derived = useMemo(() => {
    let userMsgs = 0
    let toolOk = 0
    let toolErr = 0
    let negLogprobSum = 0
    let logprobCount = 0
    const tokens: Record<SegmentKey, number> = {
      system: 0,
      user: 0,
      tool: 0,
      reasoning: 0,
      toolCall: 0,
      final: 0,
    }
    for (const m of trace.messages) {
      const t = messageTokens(m)
      if (m.role === 'user') {
        userMsgs += 1
        tokens.user += t
      } else if (m.role === 'system' || m.role === 'developer') {
        tokens.system += t
      } else if (m.role === 'tool') {
        tokens.tool += t
        if (m.toolResult?.isError) toolErr += 1
        else toolOk += 1
      } else if ((m.channel ?? 'final') === 'analysis') {
        tokens.reasoning += t
      } else if (m.toolCalls && m.toolCalls.length > 0) {
        tokens.toolCall += t
      } else {
        tokens.final += t
      }
      if (m.tokens) {
        for (const tok of m.tokens) {
          negLogprobSum += -tok.logprob
          logprobCount += 1
        }
      }
    }
    return {
      userMsgs,
      toolOk,
      toolErr,
      avgNegLogprob: logprobCount > 0 ? negLogprobSum / logprobCount : undefined,
      tokens,
      tokenTotal: Object.values(tokens).reduce((a, b) => a + b, 0),
    }
  }, [trace.messages])

  const extras = useMemo(
    () =>
      Object.entries(meta.extra ?? {}).filter(
        ([key, value]) =>
          !NON_METRIC_EXTRA.has(key) &&
          (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
      ),
    [meta.extra],
  )

  return (
    <aside
      data-testid="trace-metrics-panel"
      className="w-[280px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white px-3 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* upsize the shared badge for the panel's headline number */}
        <span className="[&>span]:rounded-md [&>span]:px-2 [&>span]:py-0.5 [&>span]:text-lg">
          <ScoreBadge score={stats.score} />
        </span>
        <span
          className="max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
          title={meta.instanceId}
        >
          {meta.instanceId}
        </span>
      </div>

      <div className="mt-3 space-y-1">
        <Row label="Turns" value={formatNumber(stats.turns)} />
        <Row label="Messages" value={formatNumber(trace.messages.length)} />
        <Row label="User msgs" value={formatNumber(derived.userMsgs)} />
        <Row label="Tool calls" value={formatNumber(stats.toolUses)} />
        <Row label="Tools ✓" value={formatNumber(derived.toolOk)} />
        <Row label="Tools ✗" value={formatNumber(derived.toolErr)} />
        <Row label="Input tokens" value={formatNumber(stats.inputTokens)} />
        <Row label="Output tokens" value={formatNumber(stats.outputTokens)} />
        <Row label="Reasoning tokens" value={formatNumber(stats.thinkingTokens)} />
        <Row
          label="Avg neg log-prob"
          value={derived.avgNegLogprob === undefined ? '—' : derived.avgNegLogprob.toFixed(3)}
        />
      </div>

      <SectionLabel>Token breakdown</SectionLabel>
      {derived.tokenTotal > 0 ? (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded bg-slate-100">
            {SEGMENTS.map(({ key, label, cls }) => {
              const n = derived.tokens[key]
              if (n === 0) return null
              return (
                <div
                  key={key}
                  className={cls}
                  style={{ width: `${(n / derived.tokenTotal) * 100}%` }}
                  title={`${label}: ${formatNumber(n)}`}
                />
              )
            })}
          </div>
          <div className="mt-1.5 space-y-0.5">
            {SEGMENTS.map(({ key, label, cls }) => (
              <div key={key} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <span className={`h-2 w-2 shrink-0 rounded-sm ${cls}`} />
                <span className="flex-1">{label}</span>
                <span className="font-mono tabular-nums">{formatNumber(derived.tokens[key])}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-400">—</p>
      )}

      {extras.length > 0 && (
        <>
          <SectionLabel>Trace metrics</SectionLabel>
          <div className="space-y-0.5">
            {extras.map(([key, value]) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
              >
                <span className="shrink-0 text-slate-500">{key}:</span>
                <span className="truncate text-slate-700" title={String(value)}>
                  {String(value)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
