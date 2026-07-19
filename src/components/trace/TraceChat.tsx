import { type FormEvent, useEffect, useRef, useState } from 'react'
import { ApiError, apiPost } from '../../api/client'
import { MarkdownContent } from '../common/MarkdownContent'

/**
 * Floating "Ask AI" chat scoped to one trace. The FAB sits inside the trace
 * view container (absolute); the panel is fixed bottom-right above the drawer.
 * History is client-side per traceId, session-scoped (module Map).
 */

interface ChatEntry {
  id: number
  role: 'user' | 'assistant'
  content: string
}

const MAX_HISTORY = 20

const historyByTrace = new Map<string, ChatEntry[]>()
let nextEntryId = 0

/** ApiError.message is the raw response body — usually {"error": "..."}. */
function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed: unknown = JSON.parse(err.message)
      if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
        const msg = (parsed as { error: unknown }).error
        if (typeof msg === 'string') {
          return err.status === 503
            ? `${msg}. Set it in the server environment to enable chat.`
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

export function TraceChat({ traceId }: { traceId: string }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<ChatEntry[]>(() => historyByTrace.get(traceId) ?? [])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Swap to the new trace's session history when navigating between traces.
  useEffect(() => {
    setEntries(historyByTrace.get(traceId) ?? [])
    setError(null)
    setPending(false)
  }, [traceId])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const setHistory = (next: ChatEntry[]) => {
    historyByTrace.set(traceId, next)
    setEntries(next)
    // Scroll after the new entry paints.
    requestAnimationFrame(() => {
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (text === '' || pending) return
    const withUser = [...entries, { id: nextEntryId++, role: 'user' as const, content: text }]
    setHistory(withUser)
    setInput('')
    setError(null)
    setPending(true)
    try {
      const { reply } = await apiPost<{ reply: string }>(
        `/api/traces/${encodeURIComponent(traceId)}/chat`,
        { messages: withUser.slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content })) },
      )
      setHistory([...withUser, { id: nextEntryId++, role: 'assistant' as const, content: reply }])
    } catch (err) {
      setError(errorText(err))
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="trace-chat-open"
        onClick={() => setOpen(true)}
        className="absolute right-4 bottom-4 z-30 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg hover:bg-slate-50"
      >
        Ask AI
      </button>
    )
  }

  return (
    <div
      data-testid="trace-chat-panel"
      className="fixed right-4 bottom-4 z-50 flex h-[480px] w-[380px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <span className="text-sm font-semibold text-slate-700">Ask AI about this trace</span>
        <button
          type="button"
          data-testid="trace-chat-close"
          aria-label="Close chat"
          onClick={() => setOpen(false)}
          className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          ✕
        </button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {entries.length === 0 && !pending && (
          <p className="text-xs text-slate-400">
            Ask about failures, tool calls, or scoring. Answers cite message numbers (#N).
          </p>
        )}
        {entries.map((entry) =>
          entry.role === 'user' ? (
            <div
              key={entry.id}
              className="ml-8 whitespace-pre-wrap break-words rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800"
            >
              {entry.content}
            </div>
          ) : (
            <div
              key={entry.id}
              className="mr-8 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <MarkdownContent text={entry.content} />
            </div>
          ),
        )}
        {pending && (
          <div
            className="flex items-center gap-2 text-xs text-slate-400"
            data-testid="trace-chat-pending"
          >
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
            Thinking…
          </div>
        )}
        {error && (
          <p className="text-xs text-red-600" data-testid="trace-chat-error">
            {error}
          </p>
        )}
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-2">
        <input
          data-testid="trace-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this trace…"
          className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-slate-400"
        />
        <button
          type="submit"
          data-testid="trace-chat-send"
          disabled={pending || input.trim() === ''}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  )
}
