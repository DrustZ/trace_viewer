import type { Trace } from '@shared/schema/types'
import { useMemo, useState } from 'react'
import { ApiError, apiPost } from '../../api/client'
import { formatNumber } from '../common/format'
import { MarkdownContent } from '../common/MarkdownContent'
import { ScoreBadge } from '../common/ScoreBadge'

/**
 * Checkpoint playground: pick a cut point in the recorded conversation,
 * optionally override the last user message and the checkpoint step, and
 * replay the prefix against a stand-in model. The recorded final answer sits
 * next to the simulated reply for comparison.
 */

interface PlaygroundResponse {
  reply: string
  promptChars: number
  model: string
}

/** ApiError.message is the raw response body — usually {"error": "..."}. */
function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed: unknown = JSON.parse(err.message)
      if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
        const msg = (parsed as { error: unknown }).error
        if (typeof msg === 'string') {
          return err.status === 503
            ? `${msg}. Set it in the server environment to enable replay.`
            : msg
        }
      }
    } catch {
      // fall through to the generic message
    }
    return `request failed (${err.status})`
  }
  return err instanceof Error ? err.message : 'request failed'
}

function optionLabel(index: number, role: string, content: string): string {
  const snippet = content.replace(/\s+/g, ' ').trim().slice(0, 60) || '(empty)'
  return `#${index + 1} · ${role} · ${snippet}`
}

export function PlaygroundTab({ trace }: { trace: Trace }) {
  // Cut candidates: user/tool messages (replaying makes the model answer what follows them).
  const cutOptions = useMemo(
    () =>
      trace.messages
        .map((m, i) => ({ message: m, index: i }))
        .filter(({ message }) => message.role === 'user' || message.role === 'tool'),
    [trace.messages],
  )
  const defaultCut = cutOptions.find(({ message }) => message.role === 'user') ?? cutOptions[0]

  const [uptoMessageId, setUptoMessageId] = useState<string | undefined>(defaultCut?.message.id)
  const [override, setOverride] = useState('')
  const [step, setStep] = useState(String(trace.meta.checkpointStep))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PlaygroundResponse | null>(null)

  // Recorded rollout = the trace's final assistant message (prefer the 'final' channel).
  const recorded = useMemo(() => {
    const assistants = trace.messages.filter((m) => m.role === 'assistant')
    const finals = assistants.filter((m) => !m.channel || m.channel === 'final')
    const pool = finals.length > 0 ? finals : assistants
    return pool.length > 0 ? pool[pool.length - 1] : undefined
  }, [trace.messages])

  const run = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const stepNum = Number(step)
      const response = await apiPost<PlaygroundResponse>('/api/playground', {
        traceId: trace.meta.traceId,
        uptoMessageId,
        ...(override.trim() !== '' ? { userOverride: override } : {}),
        ...(Number.isFinite(stepNum) ? { checkpointStep: stepNum } : {}),
      })
      setResult(response)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* Replay controls */}
      <div className="space-y-4 self-start rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Replay controls</h2>

        <label className="block text-xs text-slate-600">
          <span className="mb-1 block font-medium">Replay up to message (inclusive)</span>
          <select
            data-testid="playground-cut"
            value={uptoMessageId ?? ''}
            onChange={(e) => setUptoMessageId(e.target.value || undefined)}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-400"
          >
            {cutOptions.map(({ message, index }) => (
              <option key={message.id} value={message.id}>
                {optionLabel(index, message.role, message.content)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs text-slate-600">
          <span className="mb-1 block font-medium">Override user input (optional)</span>
          <textarea
            data-testid="playground-override"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            rows={4}
            placeholder="Replaces the last user message in the replay prefix…"
            className="w-full resize-y rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-slate-400"
          />
        </label>

        <label className="block text-xs text-slate-600">
          <span className="mb-1 block font-medium">Checkpoint step</span>
          <input
            data-testid="playground-step"
            type="number"
            value={step}
            onChange={(e) => setStep(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-slate-400"
          />
        </label>

        <button
          type="button"
          data-testid="playground-run"
          onClick={run}
          disabled={pending || cutOptions.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {pending && (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-white" />
          )}
          {pending ? 'Replaying…' : 'Run replay'}
        </button>

        {cutOptions.length === 0 && (
          <p className="text-xs text-slate-400">
            This trace has no user or tool messages to replay from.
          </p>
        )}
        {error && (
          <p className="text-xs text-red-600" data-testid="playground-error">
            {error}
          </p>
        )}
      </div>

      {/* Recorded vs simulated */}
      <div className="min-w-0 space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-800">Recorded rollout</h2>
            <ScoreBadge score={trace.stats.score} />
          </div>
          {recorded ? (
            <MarkdownContent text={recorded.content} />
          ) : (
            <p className="text-xs text-slate-400">No assistant message recorded in this trace.</p>
          )}
        </section>

        <section
          className="rounded-lg border border-slate-200 bg-white p-4"
          data-testid="playground-replay-panel"
        >
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Replay (simulated)</h2>
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            SIMULATION — stand-in model, not the real checkpoint
          </div>
          {result ? (
            <>
              <MarkdownContent text={result.reply} />
              <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">
                prompt {formatNumber(result.promptChars)} chars · model {result.model}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-400">
              {pending
                ? 'Waiting for the simulated reply…'
                : 'Run a replay to see the simulated response.'}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
