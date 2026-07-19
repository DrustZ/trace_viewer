import type { Trace } from '@shared/schema/types'
import { useMemo, useState } from 'react'
import { ScoreBadge } from '../common/ScoreBadge'

const JUDGE_CLAMP = 400

function formatRewardValue(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/** { tests_passed: 3, tests_total: 4, judge: 1 } → ['tests 3/4', 'judge 1'] */
function rewardChips(details: Record<string, number>): string[] {
  const chips: string[] = []
  const used = new Set<string>()
  for (const [key, value] of Object.entries(details)) {
    if (!key.endsWith('_passed')) continue
    const base = key.slice(0, -'_passed'.length)
    const totalKey = `${base}_total`
    if (totalKey in details) {
      chips.push(
        `${base.replace(/_/g, ' ')} ${formatRewardValue(value)}/${formatRewardValue(details[totalKey])}`,
      )
      used.add(key)
      used.add(totalKey)
    }
  }
  for (const [key, value] of Object.entries(details)) {
    if (!used.has(key)) chips.push(`${key.replace(/_/g, ' ')} ${formatRewardValue(value)}`)
  }
  return chips
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

export function TraceSummaryPanel({ trace }: { trace: Trace }) {
  const [open, setOpen] = useState(true)
  const [judgeFull, setJudgeFull] = useState(false)
  const { meta, stats } = trace
  const extra = meta.extra ?? {}
  const groundTruth = typeof extra.ground_truth === 'string' ? extra.ground_truth : undefined
  const successCriteria =
    typeof extra.success_criteria === 'string' ? extra.success_criteria : undefined
  const endReason = typeof extra.end_reason === 'string' ? extra.end_reason : undefined

  const judge = useMemo(() => {
    for (let i = trace.messages.length - 1; i >= 0; i--) {
      const out = trace.messages[i].judgeOutput
      if (out) return out
    }
    return undefined
  }, [trace.messages])

  const chips = meta.rewardDetails ? rewardChips(meta.rewardDetails) : []
  const hasScore = stats.score !== null || chips.length > 0

  const badges: Array<{ key: string; label: string; cls: string }> = []
  if (endReason)
    badges.push({
      key: 'end-reason',
      label: endReason.replace(/_/g, ' '),
      cls: 'bg-slate-200 text-slate-700',
    })
  if (stats.truncated)
    badges.push({ key: 'truncated', label: 'TRUNCATED', cls: 'bg-orange-100 text-orange-700' })
  if (stats.hasError)
    badges.push({ key: 'has-errors', label: 'HAS ERRORS', cls: 'bg-red-100 text-red-700' })
  if (meta.status === 'executing')
    badges.push({
      key: 'executing',
      label: 'EXECUTING',
      cls: 'animate-pulse bg-blue-100 text-blue-700',
    })

  const warnings = trace.warnings ?? []
  const hasAnyItem =
    hasScore ||
    badges.length > 0 ||
    groundTruth !== undefined ||
    successCriteria !== undefined ||
    judge !== undefined ||
    warnings.length > 0

  return (
    <section
      data-testid="trace-summary"
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="trace-summary-toggle"
        className="flex w-full items-center gap-2 rounded-lg px-4 py-2.5 text-left hover:bg-slate-50"
      >
        <span
          className={`inline-block text-[10px] text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
        <span className="text-xs font-semibold tracking-wide text-slate-700">TRACE SUMMARY</span>
        {!open && stats.score !== null && <ScoreBadge score={stats.score} />}
        <span className="ml-auto shrink-0 text-[10px] text-slate-400">
          {open ? 'collapse' : 'click to expand'}
        </span>
      </button>
      {open &&
        (hasAnyItem ? (
          <div className="grid gap-x-8 gap-y-4 border-t border-slate-100 px-4 py-3 sm:grid-cols-2">
            {hasScore && (
              <Item label="Score">
                <div className="flex flex-wrap items-center gap-2">
                  {/* upsize the shared badge for the panel's headline number */}
                  <span className="[&>span]:rounded-md [&>span]:px-2 [&>span]:py-0.5 [&>span]:text-lg">
                    <ScoreBadge score={stats.score} />
                  </span>
                  {chips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </Item>
            )}
            {badges.length > 0 && (
              <Item label="Status">
                <div className="flex flex-wrap items-center gap-1.5">
                  {badges.map((b) => (
                    <span
                      key={b.key}
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${b.cls}`}
                    >
                      {b.label}
                    </span>
                  ))}
                </div>
              </Item>
            )}
            {groundTruth !== undefined && (
              <Item label="Ground truth">
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700">
                  {groundTruth}
                </pre>
              </Item>
            )}
            {successCriteria !== undefined && (
              <Item label="Success criteria">
                <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
                  {successCriteria}
                </p>
              </Item>
            )}
            {judge !== undefined && (
              <div className="sm:col-span-2">
                <Item label="Judge output">
                  <blockquote className="whitespace-pre-wrap break-words rounded-r border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {judge.length > JUDGE_CLAMP && !judgeFull
                      ? `${judge.slice(0, JUDGE_CLAMP)}…`
                      : judge}
                  </blockquote>
                  {judge.length > JUDGE_CLAMP && (
                    <button
                      type="button"
                      data-testid="judge-expand"
                      onClick={() => setJudgeFull(!judgeFull)}
                      className="mt-1 text-xs font-medium text-amber-700 underline hover:text-amber-900"
                    >
                      {judgeFull ? 'Collapse' : `Show all (${judge.length.toLocaleString()} chars)`}
                    </button>
                  )}
                </Item>
              </div>
            )}
            {warnings.length > 0 && (
              <div className="sm:col-span-2">
                <Item label="Warnings">
                  <ul className="list-disc rounded border border-amber-200 bg-amber-50 py-2 pr-3 pl-7 text-xs text-amber-800">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Item>
              </div>
            )}
          </div>
        ) : (
          <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-400">
            No verdict metadata on this trace.
          </p>
        ))}
    </section>
  )
}
