import type { Message, Trace } from '@shared/schema/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAceCheckpoints,
  useAceRegressionCapability,
  useAceReplay,
  useSaveAceRegression,
} from '../../api/ace'
import { formatNumber } from '../common/format'
import { MarkdownContent } from '../common/MarkdownContent'
import { checkpointForkMessageId } from '../trace/ReplayTab'
import { chronologicalMessages } from '../trace/regressionScenario'

const INPUT =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400'

// ---------------------------------------------------------------------------
// Bubble taxonomy
// ---------------------------------------------------------------------------

export interface BubbleStyle {
  label: string
  /** Chip classes. */
  chip: string
  /** Bubble card classes. */
  card: string
  /** Simulated end user reads left; the bot under test reads right. */
  align: 'start' | 'end'
}

/**
 * Role → bubble color/side for the Playground conversation. The user
 * simulator is blue-left; the bot under test (beta) is sky-right; a human
 * takeover is amber-right; tool results are cyan-left.
 */
export function bubbleStyle(message: Message): BubbleStyle {
  if (message.role === 'user') {
    return {
      label: 'USER',
      chip: 'bg-blue-100 text-blue-700',
      card: 'border-blue-200 bg-blue-50',
      align: 'start',
    }
  }
  if (message.role === 'tool') {
    return message.toolResult?.isError
      ? {
          label: 'TOOL · ERROR',
          chip: 'bg-red-100 text-red-700',
          card: 'border-red-200 bg-red-50',
          align: 'start',
        }
      : {
          label: 'TOOL',
          chip: 'bg-cyan-100 text-cyan-700',
          card: 'border-cyan-200 bg-cyan-50/60',
          align: 'start',
        }
  }
  if (message.role === 'system' || message.role === 'developer') {
    return {
      label: message.role.toUpperCase(),
      chip: 'bg-slate-200 text-slate-600',
      card: 'border-slate-200 bg-slate-50',
      align: 'start',
    }
  }
  const agent = typeof message.metadata?.agentType === 'string' ? message.metadata.agentType : ''
  if (agent === 'human') {
    return {
      label: 'HUMAN',
      chip: 'bg-amber-100 text-amber-800',
      card: 'border-amber-200 bg-amber-50',
      align: 'end',
    }
  }
  if (agent === 'beta') {
    return {
      label: 'BETA',
      chip: 'bg-sky-100 text-sky-700',
      card: 'border-sky-200 bg-sky-50',
      align: 'end',
    }
  }
  return {
    label: 'ASSISTANT',
    chip: 'bg-emerald-100 text-emerald-700',
    card: 'border-emerald-200 bg-white',
    align: 'end',
  }
}

function Bubble({ message }: { message: Message }) {
  const style = bubbleStyle(message)
  const isAnalysis = message.channel === 'analysis'
  return (
    <div
      className={`flex ${style.align === 'end' ? 'justify-end' : 'justify-start'}`}
      data-testid="playground-bubble"
      data-role={style.label.toLowerCase()}
    >
      <div className={`max-w-[85%] rounded-lg border px-3 py-2 ${style.card}`}>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.chip}`}
        >
          {style.label}
          {isAnalysis ? ' · reasoning' : ''}
        </span>
        {isAnalysis ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] text-slate-500">Show reasoning</summary>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">
              {message.content}
            </p>
          </details>
        ) : message.content ? (
          <div className="mt-1 text-sm">
            <MarkdownContent text={message.content} />
          </div>
        ) : null}
        {message.toolCalls?.map((call) => (
          <details
            key={call.id}
            className="mt-1 rounded border border-indigo-200 bg-indigo-50/60 px-2 py-1"
            data-testid="playground-tool-call"
          >
            <summary className="cursor-pointer font-mono text-[11px] font-medium text-indigo-700">
              → {call.name}
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-600">
              {call.arguments}
            </pre>
          </details>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session phase pill
// ---------------------------------------------------------------------------

export type SessionPhaseKind = 'starting' | 'running' | 'grading' | 'complete' | 'failed'

export interface SessionPhaseInfo {
  kind: SessionPhaseKind
  label: string
  /** Still producing content — keep Stop available and the pulse on. */
  active: boolean
}

/**
 * One status pill for the live session: starting → running · N messages →
 * grading → complete/failed. `lifecycle` is the batch manifest's word
 * (authoritative when terminal); `pendingPhase` is the episode's own current
 * phase and only promotes the label to grading-style states.
 */
export function sessionPhase(
  lifecycle: string | undefined,
  messageCount: number,
  pendingPhase?: string,
): SessionPhaseInfo {
  if (lifecycle === 'completed') return { kind: 'complete', label: 'complete', active: false }
  if (lifecycle === 'failed' || lifecycle === 'cancelled') {
    return { kind: 'failed', label: lifecycle, active: false }
  }
  if (messageCount === 0) return { kind: 'starting', label: 'starting', active: true }
  if (pendingPhase !== undefined && /grad|judge|verif/i.test(pendingPhase)) {
    return { kind: 'grading', label: pendingPhase, active: true }
  }
  return {
    kind: 'running',
    label: `running · ${messageCount} ${messageCount === 1 ? 'message' : 'messages'}`,
    active: true,
  }
}

/** How close to the bottom (px) still counts as "following the stream". */
const AUTOSCROLL_SLACK_PX = 48

/** Chat-style rendering of one episode's messages (chronological order). */
export function EpisodeConversation({ trace }: { trace: Trace }) {
  const ordered = useMemo(() => chronologicalMessages(trace.messages), [trace.messages])
  // Standard chat behavior: follow new messages at the bottom, but stop
  // following the moment the reader scrolls up; resume when they return.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const followStream = useRef(true)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content only.
  useEffect(() => {
    const el = containerRef.current
    if (el && followStream.current) el.scrollTop = el.scrollHeight
  }, [ordered.length])
  if (ordered.length === 0) {
    return (
      <p className="rounded-md bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
        Waiting for the first durable message…
      </p>
    )
  }
  return (
    <div
      ref={containerRef}
      onScroll={() => {
        const el = containerRef.current
        if (!el) return
        followStream.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < AUTOSCROLL_SLACK_PX
      }}
      className="max-h-[65vh] space-y-2 overflow-y-auto pr-1"
      data-testid="playground-conversation"
    >
      {ordered.map(({ message }) => (
        <Bubble key={message.id} message={message} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Judge / grade result card
// ---------------------------------------------------------------------------

export function EpisodeResultCard({ trace, costUsd }: { trace: Trace; costUsd?: number | null }) {
  const evaluation = trace.evaluation
  const outcome = evaluation?.outcome
  // Soft highlight when the grade lands so the eye jumps from the last bubble
  // to the verdict; keyed on the outcome so a rerender never re-triggers it.
  const [justGraded, setJustGraded] = useState(false)
  useEffect(() => {
    if (outcome === undefined) return
    setJustGraded(true)
    const timer = setTimeout(() => setJustGraded(false), 1_600)
    return () => clearTimeout(timer)
  }, [outcome])
  if (!evaluation || outcome === undefined) return null
  const pending = evaluation.lifecycle.pendingPhase !== undefined
  const failedGating = evaluation.checks.filter((check) => check.gating && !check.ok)
  const badge =
    outcome === 'pass'
      ? 'bg-emerald-100 text-emerald-800'
      : outcome === 'fail' || outcome === 'runtime_error'
        ? 'bg-red-100 text-red-800'
        : 'bg-amber-100 text-amber-800'
  return (
    <section
      className={`rounded-lg border bg-white p-3 transition-all duration-700 ${
        justGraded ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200 ring-0'
      }`}
      data-testid="playground-result-card"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-2 py-1 font-semibold uppercase ${badge}`}>
          {outcome.replace('_', ' ')}
        </span>
        {pending && (
          <span className="text-slate-500">
            still {evaluation.lifecycle.pendingPhase ?? 'running'}
          </span>
        )}
        <span className="text-slate-500">
          {formatNumber(evaluation.failures.length)} findings ·{' '}
          {formatNumber(evaluation.checks.length)} checks
        </span>
        <span className="ml-auto font-mono text-slate-600">
          {costUsd === undefined || costUsd === null ? 'cost —' : `cost $${costUsd.toFixed(3)}`}
        </span>
      </div>
      {failedGating.length > 0 && (
        <ul className="mt-2 space-y-1">
          {failedGating.map((check) => (
            <li
              key={check.name}
              className="rounded bg-red-50 px-2 py-1 text-xs text-red-800"
              data-testid="playground-failed-check"
            >
              ✕ <b className="font-mono">{check.name}</b>
              {check.detail ? ` — ${check.detail}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// First-class actions: fork from turn + save as regression
// ---------------------------------------------------------------------------

/**
 * Promotes the two TracePage rerun actions to Playground first-class buttons.
 * Fork uses the recorded checkpoint boundaries of the episode; save-regression
 * uses the same bridge action as the Rerun tab. Anything the compact controls
 * cannot express deep-links back to the trace's rerun tab.
 */
export function PlaygroundActions({
  trace,
  onChildRun,
}: {
  trace: Trace
  onChildRun: (runId: string) => void
}) {
  const traceUid = trace.meta.traceUid ?? trace.meta.traceId
  const checkpoints = useAceCheckpoints(traceUid)
  const replay = useAceReplay()
  const regressionCapability = useAceRegressionCapability(traceUid)
  const saveRegression = useSaveAceRegression()
  const rows = checkpoints.data?.checkpoints ?? []
  const branchable = rows.filter((row) => row.branchable)
  const [checkpointId, setCheckpointId] = useState<number | undefined>()
  const forkInFlight = useRef(false)

  const selected = rows.find((row) => row.id === checkpointId) ?? branchable[branchable.length - 1]
  const forkMessageId = checkpointForkMessageId(selected, trace.messages)
  const forkAvailable = Boolean(checkpoints.data?.forkAvailable) && branchable.length > 0

  const result =
    replay.data && typeof replay.data === 'object'
      ? (replay.data as { result?: { child_run_id?: unknown } })
      : undefined
  const childRunId =
    typeof result?.result?.child_run_id === 'string' ? result.result.child_run_id : undefined

  const fork = () => {
    if (!forkAvailable || !selected || forkInFlight.current) return
    forkInFlight.current = true
    replay.mutate(
      {
        sourceTraceUid: traceUid,
        mode: 'exact',
        checkpointId: selected.id,
        ...(forkMessageId ? { forkMessageId } : {}),
        costCapUsd: 2,
      },
      {
        onSettled: () => {
          forkInFlight.current = false
        },
        onSuccess: (data) => {
          const child = (data as { result?: { child_run_id?: unknown } }).result?.child_run_id
          if (typeof child === 'string') onChildRun(child)
        },
      },
    )
  }

  // Production traces need an edited scenario draft — that flow lives on the
  // trace's rerun tab; simulation episodes save directly.
  const needsScenarioDraft =
    trace.meta.corpusId === 'production' &&
    regressionCapability.data?.scenarioSnapshotAvailable === false
  const regressionReady = Boolean(regressionCapability.data?.available) && !needsScenarioDraft

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-3"
      data-testid="playground-actions"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 text-xs text-slate-600">
          Fork from turn…
          <select
            className={INPUT}
            data-testid="playground-fork-boundary"
            value={selected?.id ?? ''}
            onChange={(event) => setCheckpointId(Number(event.target.value))}
            disabled={!forkAvailable}
            title={
              forkAvailable
                ? 'Recorded safe boundaries; the fork restores state exactly up to here'
                : `Fork unavailable: ${(checkpoints.data?.missing ?? []).join(', ') || 'no branchable checkpoint'}`
            }
          >
            {branchable.map((row) => (
              <option key={row.id} value={row.id}>
                #{row.id} · {row.phase} · {row.message_count ?? '?'} messages
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="playground-fork"
          onClick={fork}
          disabled={!forkAvailable || replay.isPending}
          title="Immutable checkpoint fork with exact config; the child run opens here"
          className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
        >
          {replay.isPending ? 'Forking…' : 'Fork'}
        </button>
        <button
          type="button"
          data-testid="playground-save-regression"
          onClick={() => saveRegression.mutate({ sourceTraceUid: traceUid })}
          disabled={!regressionReady || saveRegression.isPending}
          title={
            regressionReady
              ? 'Saves an immutable regression scenario artifact; no model or tool is called'
              : needsScenarioDraft
                ? 'Production evidence needs a scenario draft — finish on the rerun tab'
                : (regressionCapability.data?.missing ?? []).join(', ') ||
                  'Inspecting regression capability…'
          }
          className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800 disabled:opacity-40"
        >
          {saveRegression.isPending ? 'Saving…' : 'Save as regression'}
        </button>
        <Link
          to={`/trace/${encodeURIComponent(traceUid)}?tab=rerun`}
          className="ml-auto text-xs text-violet-700 underline"
        >
          Full rerun controls ↗
        </Link>
      </div>
      {(childRunId || replay.error) && (
        <p className="mt-2 text-xs">
          {childRunId ? (
            <span className="text-emerald-700">
              Child run <b className="font-mono">{childRunId}</b> started — session switched to it.
            </span>
          ) : (
            <span className="text-red-700">
              {replay.error instanceof Error ? replay.error.message : 'Fork failed'}
            </span>
          )}
        </p>
      )}
      {saveRegression.data && (
        <p className="mt-2 text-xs text-slate-700">
          <b>
            {saveRegression.data.runnable
              ? 'Runnable synthetic scenario saved'
              : 'Regression draft saved'}
            {saveRegression.data.deduplicated ? ' · existing identical artifact reused' : ''}
          </b>
          <span className="ml-2 font-mono">ACE runs/{saveRegression.data.artifact}</span>
        </p>
      )}
      {saveRegression.error && (
        <p className="mt-2 text-xs text-red-700">
          {saveRegression.error instanceof Error
            ? saveRegression.error.message
            : 'Regression save failed'}
        </p>
      )}
      {/* Multi-turn human input needs a bridge `interactive` action — planned P1. */}
      <div className="mt-3 flex items-center gap-2">
        <textarea
          rows={1}
          disabled
          placeholder="Send a message to the simulated world…"
          title="Needs bridge interactive support (P1): the bridge cannot yet accept injected user turns mid-episode"
          data-testid="playground-human-input"
          className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-400"
        />
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          P1
        </span>
      </div>
    </section>
  )
}
