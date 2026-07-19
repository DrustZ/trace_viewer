import { type ReactNode, useState } from 'react'

const storageKey = (id: string) => `tv.section.${id}`

function readOpen(id: string, defaultOpen: boolean): boolean {
  try {
    const stored = localStorage.getItem(storageKey(id))
    return stored === null ? defaultOpen : stored === '1'
  } catch {
    return defaultOpen
  }
}

/**
 * Collapsible card section. Open state persists per-id in localStorage;
 * children unmount when closed so collapsed charts cost nothing.
 */
export function CollapsibleSection({
  id,
  title,
  summary,
  defaultOpen = true,
  children,
}: {
  id: string
  title: string
  /** Right-aligned digest shown only while collapsed, e.g. '6 components · avg 0.36'. */
  summary?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen))

  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(storageKey(id), next ? '1' : '0')
    } catch {
      // storage unavailable (private mode) — open state stays in-memory only
    }
  }

  return (
    <section data-testid={`section-${id}`} className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        data-testid={`section-toggle-${id}`}
        onClick={toggle}
        className="flex w-full items-center gap-2 rounded-lg px-4 py-2 text-left hover:bg-slate-50"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path
            d="M6 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </span>
        {!open && summary !== undefined && (
          <span className="ml-auto truncate text-xs text-slate-400">{summary}</span>
        )}
      </button>
      {open && <div className="border-t border-slate-100 px-4 py-3">{children}</div>}
    </section>
  )
}
