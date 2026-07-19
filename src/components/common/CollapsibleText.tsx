import { type ReactNode, useState } from 'react'

/** Expanded views above this size are cut off — full text belongs in the Raw tab. */
const HARD_CAP = 200_000

export interface FoldTone {
  label: string
  chevron: string
  hover: string
}

/**
 * Explicit fold control: a clickable header row (chevron + label + char count + hint)
 * that stays visible when expanded so the block can be re-collapsed without scrolling.
 * Collapsed shows a faded preview — one truncated line, or a `previewChars` block when
 * `blockPreview` is set. Pass expanded/onToggle to lift state out of virtualized rows.
 */
export function FoldSection({
  label,
  text,
  tone,
  mono = false,
  expanded,
  onToggle,
  defaultExpanded = false,
  previewChars = 120,
  blockPreview = false,
  testId = 'fold-toggle',
  renderText,
}: {
  label: string
  text: string
  tone: FoldTone
  mono?: boolean
  expanded?: boolean
  onToggle?: () => void
  defaultExpanded?: boolean
  previewChars?: number
  blockPreview?: boolean
  testId?: string
  /** Custom renderer for the expanded content (e.g. markdown); previews stay plain text. */
  renderText?: (text: string) => ReactNode
}) {
  const [localOpen, setLocalOpen] = useState(defaultExpanded)
  const open = expanded ?? localOpen
  const toggle = onToggle ?? (() => setLocalOpen((v) => !v))
  const chars = text.length
  const contentCls = `whitespace-pre-wrap break-words ${mono ? 'font-mono text-xs' : 'text-sm'}`

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        data-testid={testId}
        className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left ${tone.hover}`}
      >
        <span
          className={`inline-block text-[10px] transition-transform ${tone.chevron} ${open ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${tone.label}`}>
          {label}
        </span>
        <span className="font-mono text-[10px] text-slate-400">{chars.toLocaleString()} chars</span>
        <span className="ml-auto shrink-0 text-[10px] text-slate-400">
          {open ? 'collapse' : 'click to expand'}
        </span>
      </button>
      {open ? (
        <div className="px-1.5 pb-1">
          {renderText ? (
            renderText(chars > HARD_CAP ? text.slice(0, HARD_CAP) : text)
          ) : (
            <div className={contentCls}>{chars > HARD_CAP ? text.slice(0, HARD_CAP) : text}</div>
          )}
          {chars > HARD_CAP && (
            <p className="mt-1 text-xs text-slate-400 italic">
              (truncated view — use Raw tab for full text)
            </p>
          )}
        </div>
      ) : blockPreview ? (
        <div className="relative overflow-hidden px-1.5 pb-1">
          <div className={`${contentCls} opacity-75`}>{text.slice(0, previewChars)}</div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent" />
        </div>
      ) : (
        <p
          className={`truncate px-1.5 pb-1 text-slate-400 ${mono ? 'font-mono text-xs' : 'text-sm'}`}
        >
          {text.slice(0, previewChars)}
        </p>
      )}
    </div>
  )
}

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
