import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { useTrace } from '../../api/hooks'
import { ErrorState, LoadingState } from '../common/EmptyState'
import { EvaluationSummary } from '../trace/EvaluationSummary'
import type { TraceTab } from '../trace/TraceHeader'
import { TraceView } from '../trace/TraceView'

const WIDTH_KEY = 'tv.drawer.width'
const DEFAULT_WIDTH = 720
const MIN_WIDTH = 480
const MAX_FRACTION = 0.9

function clampWidth(w: number): number {
  return Math.min(Math.max(w, MIN_WIDTH), Math.round(window.innerWidth * MAX_FRACTION))
}

function storedWidth(): number {
  const raw = Number.parseInt(localStorage.getItem(WIDTH_KEY) ?? '', 10)
  return clampWidth(Number.isNaN(raw) ? DEFAULT_WIDTH : raw)
}

/**
 * Slide-over trace preview. No backdrop on purpose — the table underneath
 * stays interactive so users can click through traces while previewing.
 */
export function TraceDrawer({
  traceId,
  onClose,
  onNavigate,
  listSearch,
}: {
  traceId: string
  onClose: () => void
  onNavigate: (traceId: string) => void
  listSearch: string
}) {
  const [tab, setTab] = useState<TraceTab>('conversation')
  const [width, setWidth] = useState(storedWidth)
  const trace = useTrace(traceId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMove = (ev: MouseEvent) => setWidth(clampWidth(window.innerWidth - ev.clientX))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(w))
        return w
      })
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const notFound = trace.error instanceof ApiError && trace.error.status === 404
  const errorMessage = notFound
    ? `Trace '${traceId}' was not found.`
    : `Failed to load trace: ${trace.error instanceof Error ? trace.error.message : 'unknown error'}`

  return (
    <aside
      data-testid="trace-drawer"
      style={{ width, maxWidth: '90vw', background: 'var(--app-bg)' }}
      className="fixed inset-y-0 right-0 z-40 border-l border-slate-200 shadow-xl"
    >
      <div
        data-testid="drawer-resize"
        role="slider"
        aria-label="Resize preview"
        aria-orientation="vertical"
        aria-valuenow={width}
        tabIndex={0}
        onMouseDown={startResize}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-blue-300/60 focus:bg-blue-300/60 focus:outline-none"
      />
      {trace.isLoading ? (
        <div className="p-6">
          <LoadingState label="Loading trace…" />
        </div>
      ) : trace.isError || !trace.data ? (
        <div className="space-y-4 p-6">
          <ErrorState message={errorMessage} />
          <button
            type="button"
            data-testid="drawer-close"
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <TraceView
              trace={trace.data}
              tab={tab}
              onTabChange={setTab}
              variant="drawer"
              listSearch={listSearch}
              onNavigate={onNavigate}
              onClose={onClose}
            />
          </div>
          {/* Verdict + hard gates one glance away under the conversation —
              collapsed by default (red dot when a hard gate failed), so the
              preview stays the drawer's primary surface. */}
          {tab !== 'evaluation' && <EvaluationSummary trace={trace.data} />}
        </div>
      )}
    </aside>
  )
}
