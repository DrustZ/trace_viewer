import type { ReviewTranscriptMessage } from '@shared/reviews/types'

export interface ReviewTranscriptSectionProps {
  messages: readonly ReviewTranscriptMessage[]
  locked: boolean
  /** Label of the rubric dimension whose evidence a click will toggle. */
  focusedDimensionLabel: string | null
  /** Message ids already cited by the focused dimension. */
  selectedIds: ReadonlySet<string>
  /** message id → dimension ids citing it, for the evidence badge. */
  evidenceBadges: ReadonlyMap<string, readonly string[]>
  /** Transient hint shown when a click had no focused dimension. */
  hint: string | null
  onToggle: (messageId: string) => void
}

/**
 * The transcript is an interactive evidence picker: clicking a message
 * toggles it in the focused rubric dimension's evidenceMessageIds. The manual
 * comma-separated input remains available in Details → Rubric as a fallback.
 */
export function ReviewTranscriptSection({
  messages,
  locked,
  focusedDimensionLabel,
  selectedIds,
  evidenceBadges,
  hint,
  onToggle,
}: ReviewTranscriptSectionProps) {
  if (messages.length === 0) return null
  return (
    <details open className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        Transcript · {messages.length} messages
      </summary>
      <p className="mt-2 text-xs text-slate-500">
        {focusedDimensionLabel
          ? `Click a message to toggle it as evidence for “${focusedDimensionLabel}”.`
          : 'Click a message to attach it as rubric evidence.'}
      </p>
      {hint ? (
        <p
          aria-live="polite"
          className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
        >
          {hint}
        </p>
      ) : null}
      <ol className="mt-3 max-h-[32rem] space-y-2 overflow-auto">
        {messages.map((message) => {
          const selected = selectedIds.has(message.id)
          const citedBy = evidenceBadges.get(message.id) ?? []
          return (
            <li key={message.id}>
              <button
                type="button"
                disabled={locked}
                aria-pressed={selected}
                aria-label={`Toggle ${message.id} as evidence`}
                onClick={() => onToggle(message.id)}
                className={`w-full rounded-md border p-2.5 text-left disabled:cursor-not-allowed ${
                  selected
                    ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-mono font-medium text-slate-700">{message.id}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 uppercase">
                    {message.role}
                  </span>
                  {citedBy.length > 0 ? (
                    <span
                      className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-700"
                      title={`Evidence for: ${citedBy.join(', ')}`}
                    >
                      evidence ×{citedBy.length}
                    </span>
                  ) : null}
                  {message.timestamp ? <span className="ml-auto">{message.timestamp}</span> : null}
                </span>
                <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-slate-800">
                  {message.content}
                </pre>
              </button>
            </li>
          )
        })}
      </ol>
    </details>
  )
}
