import type { MetaResponse } from '@shared/schema/api'
import { type ListParams, useMeta, useTiles, useTraces } from '../../api/hooks'
import { formatNumber } from '../common/format'

/** Scan-progress fields are being added to /api/meta by another track; read them defensively. */
type MetaWithScan = MetaResponse &
  Partial<{ scanning: boolean; scannedFiles: number; totalFiles: number }>

function Spinner() {
  return (
    <svg
      className="h-3 w-3 animate-spin text-slate-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  )
}

/** Slim, non-scrolling status strip at the top of the main column. */
export function RunStatusBar({
  params,
  sidebarOpen,
  onToggleSidebar,
}: {
  params: ListParams
  sidebarOpen: boolean
  onToggleSidebar: () => void
}) {
  const meta = useMeta()
  const tiles = useTiles(params)
  const executing = useTraces({ status: 'executing', limit: 1 })

  const scan = meta.data as MetaWithScan | undefined
  const maxStep = meta.data?.steps.length ? Math.max(...meta.data.steps) : null
  const executingTotal = executing.data && 'total' in executing.data ? executing.data.total : 0
  const runInProgress = executingTotal > 0

  return (
    <div
      data-testid="run-status-bar"
      className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-2"
    >
      {!sidebarOpen && (
        <button
          type="button"
          data-testid="statusbar-sidebar-toggle"
          aria-label="Open sidebar"
          onClick={onToggleSidebar}
          className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          ☰
        </button>
      )}
      <span className="text-sm font-semibold text-slate-900">RL trace run · seed-42 corpus</span>
      {executing.data &&
        (runInProgress ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            Run in progress{maxStep !== null ? ` · Step ${maxStep}` : ''}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Run complete
          </span>
        ))}
      <span className="min-w-0 flex-1 truncate text-center text-xs text-slate-500">
        {tiles.data && meta.data
          ? `Showing ${formatNumber(tiles.data.total)} of ${formatNumber(meta.data.traceCount)} traces · ${meta.data.components.length} components`
          : ''}
      </span>
      {scan?.scanning === true && (
        <span
          data-testid="scan-progress"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500"
        >
          <Spinner />
          scanning {formatNumber(scan.scannedFiles ?? 0)}/{formatNumber(scan.totalFiles ?? 0)}
        </span>
      )}
    </div>
  )
}
