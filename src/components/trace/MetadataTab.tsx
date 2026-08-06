import { recordedCheckpoint } from '@shared/schema/provenance'
import type { Trace } from '@shared/schema/types'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  formatDuration,
  formatNumber,
  formatPercent,
  formatScore,
  formatTimestamp,
} from '../common/format'
import { JsonTree } from '../common/JsonTree'
import { parseJudgeExtra, parseRewardBreakdown } from './TraceSummaryPanel'

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      {title && (
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}

function KvRow({ label, value, copy }: { label: string; value: ReactNode; copy?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="shrink-0 text-sm text-slate-500">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-right text-sm text-slate-800">
        <span className="min-w-0 break-all">{value}</span>
        {copy !== undefined && <CopyButton value={copy} />}
      </span>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`font-mono text-sm ${tone ?? 'text-slate-800'}`}>{value}</p>
    </div>
  )
}

function scoreTone(score: number | null): string {
  if (score === null) return 'text-slate-400'
  if (score >= 0.7) return 'text-emerald-600'
  if (score > 0) return 'text-amber-600'
  return 'text-red-600'
}

export function MetadataTab({ trace }: { trace: Trace }) {
  const { meta, stats } = trace
  const checkpoint = recordedCheckpoint(meta)
  const tokPerTurn = stats.turns > 0 ? Math.round(stats.totalTokens / stats.turns) : null
  const breakdown = parseRewardBreakdown(meta.extra?.reward_breakdown)
  const judge = parseJudgeExtra(meta.extra?.judge)
  const hasRewardDetails = meta.rewardDetails && Object.keys(meta.rewardDetails).length > 0

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-4">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <p className="text-xs uppercase tracking-wide text-slate-400">Score</p>
          <p className={`mt-1 font-mono text-2xl font-semibold ${scoreTone(stats.score)}`}>
            {formatScore(stats.score)}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-slate-400">Steps</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-slate-800">{stats.turns}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-slate-400">Duration</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-slate-800">
            {formatDuration(stats.durationMs)}
          </p>
        </Card>
      </div>

      <Card title="Trace Metrics">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Metric label="Score" value={formatScore(stats.score)} tone={scoreTone(stats.score)} />
          <Metric
            label="Has Error"
            value={stats.hasError ? 'Yes' : 'No'}
            tone={stats.hasError ? 'text-red-600' : undefined}
          />
          <Metric
            label="Truncated"
            value={stats.truncated ? 'Yes' : 'No'}
            tone={stats.truncated ? 'text-amber-600' : undefined}
          />
          <Metric label="Turns" value={formatNumber(stats.turns)} />
          <Metric label="Tools" value={formatNumber(stats.toolUses)} />
          <Metric label="Sandbox" value={formatNumber(stats.sandboxExecutions)} />
          <Metric label="Input Tok" value={formatNumber(stats.inputTokens)} />
          <Metric label="Output Tok" value={formatNumber(stats.outputTokens)} />
          <Metric label="Think Tok" value={formatNumber(stats.thinkingTokens)} />
          <Metric label="Total Tok" value={formatNumber(stats.totalTokens)} />
          <Metric label="Think %" value={formatPercent(stats.thinkingPortion)} />
          <Metric label="Tok/Turn" value={formatNumber(tokPerTurn)} />
        </div>
      </Card>

      <Card title="Trace Metadata">
        <KvRow
          label="Trace ID"
          value={<span className="font-mono">{meta.traceId}</span>}
          copy={meta.traceId}
        />
        <KvRow
          label="Instance ID"
          value={<span className="font-mono">{meta.instanceId}</span>}
          copy={meta.instanceId}
        />
        <KvRow label="Component" value={meta.component} />
        <KvRow label="Status" value={meta.status} />
        <KvRow label="Checkpoint Step" value={checkpoint ?? 'Unavailable'} />
        <KvRow label="Split" value={meta.split} />
        <KvRow label="Timestamp" value={formatTimestamp(meta.timestamp)} />
        <KvRow label="Source Format" value={meta.sourceFormat} />
      </Card>

      {(hasRewardDetails || breakdown || judge) && (
        <Card title="Reward Details">
          {hasRewardDetails &&
            Object.entries(meta.rewardDetails ?? {}).map(([key, value]) => (
              <KvRow key={key} label={key} value={<span className="font-mono">{value}</span>} />
            ))}
          {breakdown && (
            <>
              <KvRow
                label="correctness"
                value={<span className="font-mono">{String(breakdown.correctness)}</span>}
              />
              <KvRow
                label="length penalty"
                value={
                  <span
                    className={`font-mono ${breakdown.length_penalty < 0 ? 'text-red-600' : ''}`}
                  >
                    {String(breakdown.length_penalty)}
                  </span>
                }
              />
              <KvRow
                label="final reward"
                value={<span className="font-mono">{String(breakdown.final_reward)}</span>}
              />
            </>
          )}
          {judge && (
            <KvRow
              label="judge verdict"
              value={
                <span className="flex items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      judge.verdict === 1
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {judge.verdict === 1 ? 'PASS' : 'FAIL'}
                  </span>
                  {judge.model && (
                    <span className="font-mono text-xs text-slate-500">{judge.model}</span>
                  )}
                </span>
              }
            />
          )}
        </Card>
      )}

      {stats.model && (
        <Card title="Model Config">
          <KvRow label="Model" value={<span className="font-mono">{stats.model.name}</span>} />
          {stats.model.contextWindow !== undefined && (
            <KvRow label="Context Window" value={formatNumber(stats.model.contextWindow)} />
          )}
          {stats.model.temperature !== undefined && (
            <KvRow label="Temperature" value={stats.model.temperature} />
          )}
          {stats.model.topP !== undefined && <KvRow label="Top P" value={stats.model.topP} />}
        </Card>
      )}

      {meta.dataLocation && (
        <Card title="Data Location">
          <div className="flex items-center justify-between gap-4">
            <span className="min-w-0 break-all font-mono text-xs text-slate-700">
              {meta.dataLocation}
            </span>
            <CopyButton value={meta.dataLocation} />
          </div>
        </Card>
      )}

      {meta.extra && Object.keys(meta.extra).length > 0 && (
        <Card title="Extra">
          <JsonTree value={meta.extra} />
        </Card>
      )}
    </div>
  )
}
