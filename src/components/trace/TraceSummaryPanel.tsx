import { recordedCheckpoint } from '@shared/schema/provenance'
import type { Trace } from '@shared/schema/types'
import { useMemo, useState } from 'react'
import { FoldSection, type FoldTone } from '../common/CollapsibleText'
import {
  MarkdownContent,
  RichRawToggle,
  useViewMode,
  wrapBareLatex,
} from '../common/MarkdownContent'
import { ScoreBadge } from '../common/ScoreBadge'

const JUDGE_CLAMP = 400
const GOLDEN_FOLD_THRESHOLD = 400

const GOLDEN_TONE: FoldTone = {
  label: 'text-slate-500',
  chevron: 'text-slate-400',
  hover: 'hover:bg-slate-50',
}

function formatRewardValue(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

interface JudgeExtra {
  verdict: number
  reasoning: string
  model?: string
}

/** meta.extra.judge → typed record, or undefined when absent/malformed. */
export function parseJudgeExtra(value: unknown): JudgeExtra | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const o = value as Record<string, unknown>
  if (typeof o.verdict !== 'number' || typeof o.reasoning !== 'string') return undefined
  return {
    verdict: o.verdict,
    reasoning: o.reasoning,
    model: typeof o.model === 'string' ? o.model : undefined,
  }
}

interface RewardBreakdown {
  correctness: number
  length_penalty: number
  final_reward: number
}

/** meta.extra.reward_breakdown → typed record, or undefined when absent/malformed. */
export function parseRewardBreakdown(value: unknown): RewardBreakdown | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const o = value as Record<string, unknown>
  if (
    typeof o.correctness !== 'number' ||
    typeof o.length_penalty !== 'number' ||
    typeof o.final_reward !== 'number'
  )
    return undefined
  return {
    correctness: o.correctness,
    length_penalty: o.length_penalty,
    final_reward: o.final_reward,
  }
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

/**
 * One Reference value (ground truth or success criteria): markdown by default so math
 * like \frac{...} renders (bare TeX gets $-wrapped), with the mono raw string behind
 * the same Rich/Raw pill used on message cards.
 */
function ReferenceBlock({
  id,
  text,
  sublabel,
  testId,
}: {
  id: string
  text: string
  sublabel?: string
  testId: string
}) {
  const [view, setView] = useViewMode(id)
  return (
    <div data-testid={testId} data-view={view}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-400">{sublabel}</span>
        <RichRawToggle mode={view} onChange={setView} />
      </div>
      {view === 'rich' ? (
        <MarkdownContent
          text={wrapBareLatex(text)}
          className="mt-1 max-h-40 overflow-y-auto rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-700"
        />
      ) : (
        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700">
          {text}
        </pre>
      )}
    </div>
  )
}

/**
 * A file-property-style summary: one always-visible line of chips (score, reward,
 * status) so the conversation stays at the top, with the deeper evaluation
 * evidence (reward breakdown, reference/golden, judge, warnings) behind a
 * "details" toggle that scrolls when long. Replaces the old always-open 2-col grid.
 */
export function TraceSummaryPanel({ trace }: { trace: Trace }) {
  const [open, setOpen] = useState(false)
  const [judgeFull, setJudgeFull] = useState(false)
  const { meta, stats } = trace
  const checkpoint = recordedCheckpoint(meta)
  const extra = meta.extra ?? {}
  const groundTruth = typeof extra.ground_truth === 'string' ? extra.ground_truth : undefined
  const successCriteria =
    typeof extra.success_criteria === 'string' ? extra.success_criteria : undefined
  const goldenResponse =
    typeof extra.golden_response === 'string' ? extra.golden_response : undefined
  const endReason = typeof extra.end_reason === 'string' ? extra.end_reason : undefined
  const judgeExtra = parseJudgeExtra(extra.judge)
  const breakdown = parseRewardBreakdown(extra.reward_breakdown)

  const judgeText = useMemo(() => {
    for (let i = trace.messages.length - 1; i >= 0; i--) {
      const out = trace.messages[i].judgeOutput
      if (out) return out
    }
    return undefined
  }, [trace.messages])
  // Structured judge record wins; plain judgeOutput text is the fallback.
  const judge = judgeExtra?.reasoning ?? judgeText

  // Content of the last errored tool result — used to detect cancelled runs.
  const lastToolError = useMemo(() => {
    for (let i = trace.messages.length - 1; i >= 0; i--) {
      const m = trace.messages[i]
      if (m.toolResult?.isError) return m.content
    }
    return undefined
  }, [trace.messages])

  // Why the score is missing (or zero) — shown inline so a bare "—" or an
  // unexplained 0 never stands alone.
  let scoreNote: { text: string; cls: string } | undefined
  if (endReason === 'budget_exceeded' && (stats.score === null || stats.score === 0)) {
    scoreNote = { text: 'score 0 — budget exhausted', cls: 'text-amber-700' }
  } else if (stats.score === null) {
    if (meta.status === 'executing') {
      scoreNote = { text: 'ungraded — still executing', cls: 'text-blue-600' }
    } else if (meta.status === 'failed' && lastToolError?.includes('Cancelled')) {
      scoreNote = { text: 'ungraded — run cancelled', cls: 'text-slate-500' }
    } else {
      scoreNote = { text: 'ungraded', cls: 'text-slate-500' }
    }
  }

  const chips = meta.rewardDetails ? rewardChips(meta.rewardDetails) : []

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
  const refCount = [groundTruth, successCriteria, goldenResponse].filter(
    (v) => v !== undefined,
  ).length
  const hasDetails =
    breakdown !== undefined || refCount > 0 || judge !== undefined || warnings.length > 0

  return (
    <section
      data-testid="trace-summary"
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      {/* Always-visible one-line metadata bar. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Summary
        </span>
        <ScoreBadge score={stats.score} />
        {chips.map((chip) => (
          <span
            key={chip}
            className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600"
          >
            {chip}
          </span>
        ))}
        {badges.map((b) => (
          <span
            key={b.key}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${b.cls}`}
          >
            {b.label}
          </span>
        ))}
        {scoreNote && <span className={`text-[11px] ${scoreNote.cls}`}>{scoreNote.text}</span>}
        <span className="ml-auto shrink-0 text-[10px] text-slate-400">
          {checkpoint === null ? 'checkpoint unavailable' : `step ${checkpoint}`} · {meta.split} ·{' '}
          {meta.status}
        </span>
        {hasDetails && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            data-testid="trace-summary-toggle"
            className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50"
          >
            {open ? 'hide details ▾' : 'details ▸'}
          </button>
        )}
      </div>
      {open && hasDetails && (
        <div className="max-h-[45vh] space-y-4 overflow-y-auto border-t border-slate-100 px-4 py-3">
          {breakdown && (
            <Item label="Reward breakdown">
              <div data-testid="reward-breakdown" className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                  correctness {String(breakdown.correctness)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
                    breakdown.length_penalty < 0
                      ? 'bg-red-50 text-red-600'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  length penalty {String(breakdown.length_penalty)}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                  final reward {String(breakdown.final_reward)}
                </span>
              </div>
            </Item>
          )}
          {refCount > 0 && (
            <Item label="Reference">
              <div className="space-y-3">
                {groundTruth !== undefined && (
                  <ReferenceBlock
                    id={`${meta.traceId}:ground-truth`}
                    text={groundTruth}
                    sublabel={refCount > 1 ? 'ground truth' : undefined}
                    testId="reference-ground-truth"
                  />
                )}
                {successCriteria !== undefined && (
                  <ReferenceBlock
                    id={`${meta.traceId}:success-criteria`}
                    text={successCriteria}
                    sublabel={refCount > 1 ? 'success criteria' : undefined}
                    testId="reference-success-criteria"
                  />
                )}
                {goldenResponse !== undefined &&
                  (goldenResponse.length > GOLDEN_FOLD_THRESHOLD ? (
                    <div data-testid="reference-golden-response">
                      <FoldSection
                        label="golden response"
                        text={goldenResponse}
                        tone={GOLDEN_TONE}
                        blockPreview
                        testId="golden-response-toggle"
                        renderText={(t) => (
                          <MarkdownContent
                            text={wrapBareLatex(t)}
                            className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-700"
                          />
                        )}
                      />
                    </div>
                  ) : (
                    <div data-testid="reference-golden-response">
                      <span className="text-[10px] text-slate-400">golden response</span>
                      <MarkdownContent
                        text={wrapBareLatex(goldenResponse)}
                        className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-700"
                      />
                    </div>
                  ))}
              </div>
            </Item>
          )}
          {judge !== undefined && (
            <Item label="Judge">
              {judgeExtra && (
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <span
                    data-testid="judge-verdict"
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      judgeExtra.verdict === 1
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {judgeExtra.verdict === 1 ? 'PASS' : 'FAIL'}
                  </span>
                  {judgeExtra.model && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                      {judgeExtra.model}
                    </span>
                  )}
                </div>
              )}
              <blockquote className="rounded-r border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-amber-900">
                <MarkdownContent
                  text={
                    judge.length > JUDGE_CLAMP && !judgeFull
                      ? `${judge.slice(0, JUDGE_CLAMP)}…`
                      : judge
                  }
                  className="text-sm"
                />
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
          )}
          {warnings.length > 0 && (
            <Item label="Warnings">
              <ul className="list-disc rounded border border-amber-200 bg-amber-50 py-2 pr-3 pl-7 text-xs text-amber-800">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Item>
          )}
        </div>
      )}
    </section>
  )
}
