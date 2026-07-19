import { useState } from 'react'

/** Expanded views above this size are cut off — full text belongs in the Raw tab. */
const HARD_CAP = 200_000

export function CollapsibleText({
  text,
  clampChars = 2500,
  mono = false,
}: {
  text: string
  clampChars?: number
  mono?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const cls = `whitespace-pre-wrap break-words ${mono ? 'font-mono text-xs' : 'text-sm'}`

  if (text.length <= clampChars) return <div className={cls}>{text}</div>

  if (!expanded) {
    return (
      <div>
        <div className="relative overflow-hidden">
          <div className={cls}>{text.slice(0, clampChars)}</div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent" />
        </div>
        <button
          type="button"
          className="mt-1 text-xs font-medium text-slate-500 underline hover:text-slate-800"
          onClick={() => setExpanded(true)}
        >
          Show all ({text.length.toLocaleString()} chars)
        </button>
      </div>
    )
  }

  const truncated = text.length > HARD_CAP
  return (
    <div>
      <div className={cls}>{truncated ? text.slice(0, HARD_CAP) : text}</div>
      {truncated && (
        <p className="mt-1 text-xs text-slate-400 italic">
          (truncated view — use Raw tab for full text)
        </p>
      )}
      <button
        type="button"
        className="mt-1 text-xs font-medium text-slate-500 underline hover:text-slate-800"
        onClick={() => setExpanded(false)}
      >
        Collapse
      </button>
    </div>
  )
}
