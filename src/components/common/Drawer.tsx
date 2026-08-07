import { type ReactNode, useEffect } from 'react'

/**
 * Right-side overlay drawer for write operations (e.g. launching a run), so
 * detail pages stay read-only by default. Closes on backdrop click or Escape.
 */
export default function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="drawer">
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-slate-900/40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-slate-200 bg-slate-50 shadow-xl"
      >
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="flex-1 p-4">{children}</div>
      </aside>
    </div>
  )
}
