import { useState } from 'react'
import { visibleReviewShortcutLabels } from './shortcuts'

export interface ReviewShortcutsHelpProps {
  hasAutomaticFailures: boolean
}

/** The shortcut reference lives behind a small "?" toggle instead of a block. */
export function ReviewShortcutsHelp({ hasAutomaticFailures }: ReviewShortcutsHelpProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        title="Keyboard shortcuts"
        className={`h-6 w-6 rounded-full border text-xs font-semibold ${
          open
            ? 'border-slate-700 bg-slate-700 text-white'
            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
        }`}
        onClick={() => setOpen((previous) => !previous)}
      >
        ?
      </button>
      {open ? (
        <dl
          aria-label="Keyboard shortcut reference"
          className="absolute right-0 z-20 mt-1.5 w-72 space-y-1.5 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg"
        >
          {visibleReviewShortcutLabels(hasAutomaticFailures).map((shortcut) => (
            <div key={shortcut.action} className="flex items-center gap-2">
              <kbd className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                {shortcut.keys}
              </kbd>
              <span className="text-slate-500">{shortcut.description}</span>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
