import type { ScanRootStatus } from '@shared/schema/api'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { type ListParams, useMeta, useTiles } from '../../api/hooks'
import { hasActiveSelection } from '../../state/filterParams'
import { formatNumber } from '../common/format'

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

function rootPurpose(root: ScanRootStatus): string {
  if (root.mode === 'fixed') return `run ${root.run}`
  if (root.mode === 'runs') return 'subfolders are runs'
  return 'run from trace metadata'
}

function rootStateClass(root: ScanRootStatus): string {
  if (root.state === 'error' || root.state === 'missing' || root.warnings > 0) {
    return 'bg-amber-50 text-amber-700'
  }
  if (root.state === 'scanning') return 'bg-blue-50 text-blue-700'
  return 'bg-emerald-50 text-emerald-700'
}

function DataRoots({ roots }: { roots: ScanRootStatus[] }) {
  const issues = roots.filter(
    (root) => root.state === 'error' || root.state === 'missing' || root.warnings > 0,
  ).length
  return (
    <details className="group relative shrink-0">
      <summary
        data-testid="data-roots-summary"
        className="flex cursor-pointer list-none items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 [&::-webkit-details-marker]:hidden"
      >
        <span>{roots.length} data roots</span>
        {issues > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
            {issues} {issues === 1 ? 'issue' : 'issues'}
          </span>
        )}
        <span aria-hidden="true" className="text-[10px] group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="absolute right-0 top-full z-30 mt-2 w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Scanned data sources
        </div>
        <div className="space-y-2">
          {roots.map((root) => (
            <div key={root.id} className="rounded-md border border-slate-100 bg-slate-50 p-2">
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 truncate text-[11px] text-slate-700">
                  {root.label}
                </code>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${rootStateClass(root)}`}
                >
                  {root.state}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                <span>{rootPurpose(root)}</span>
                <span>
                  {formatNumber(root.scannedFiles)}/{formatNumber(root.files)} files
                </span>
                <span>{formatNumber(root.traces)} traces</span>
                {root.warnings > 0 && (
                  <span className="font-medium text-amber-700">
                    {formatNumber(root.warnings)} warnings
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-slate-400">
          Counts only; trace and file contents are never included in this status response.
        </p>
      </div>
    </details>
  )
}

/** Store mutations matter whether they come from a full scan or a one-file watcher event. */
export function corpusVersionChanged(
  previous: number | undefined,
  current: number | undefined,
): boolean {
  return current !== undefined && current !== previous
}

/** Slim, non-scrolling status strip at the top of the main column. */
export function RunStatusBar({ params }: { params: ListParams }) {
  const queryClient = useQueryClient()
  // Progressive scan: poll meta while the backend reports scanning, stop when done.
  const meta = useMeta({
    refetchInterval: (query) => (query.state.data?.scanning === true ? 1200 : 5_000),
  })
  const active = hasActiveSelection(params)
  const tiles = useTiles(params)
  const scan = meta.data
  const dataVersion = meta.data?.dataVersion

  // Full scans and filesystem watcher events both bump dataVersion. Invalidate every
  // corpus-derived query, including raw/detail views, while leaving this meta poll alone.
  const previousVersion = useRef<number | undefined>(undefined)
  useEffect(() => {
    const last = previousVersion.current
    previousVersion.current = dataVersion
    if (!corpusVersionChanged(last, dataVersion)) return
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] !== 'meta',
    })
  }, [dataVersion, queryClient])
  const selected = tiles.data
  const runInProgress = (selected?.executing ?? 0) > 0
  const unknownLifecycle = selected?.unknown ?? 0

  return (
    <div
      data-testid="run-status-bar"
      className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-2"
    >
      <span className="text-sm font-semibold text-slate-900">Trace corpus</span>
      {active &&
        selected &&
        (selected.total === 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            No matching traces
          </span>
        ) : runInProgress ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            Run in progress
          </span>
        ) : unknownLifecycle > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {unknownLifecycle === selected.total ? 'Lifecycle unknown' : 'Lifecycle partly unknown'}
            {` · ${formatNumber(unknownLifecycle)}`}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Run complete
          </span>
        ))}
      <span className="min-w-0 flex-1 truncate text-right text-xs text-slate-500">
        {active
          ? tiles.data && meta.data
            ? `Showing ${formatNumber(tiles.data.total)} of ${formatNumber(meta.data.traceCount)} traces · ${meta.data.components.length} components`
            : ''
          : 'No run selected — pick a run to load traces'}
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
      {scan && <DataRoots roots={scan.scanRoots} />}
    </div>
  )
}
