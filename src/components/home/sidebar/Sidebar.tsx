import { useState } from 'react'
import { Link } from 'react-router-dom'
import { type ListParams, useImportTrace, useMeta } from '../../../api/hooks'
import {
  hasActiveSelection,
  type ListParamKey,
  type ListParamPatch,
} from '../../../state/filterParams'
import { formatNumber } from '../../common/format'
import { ImportDialog } from '../ImportDialog'
import { CategoryTree } from './CategoryTree'
import { RunTree } from './RunTree'
import { SelectionStats } from './SelectionStats'
import { SidebarFilters } from './SidebarFilters'

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('could not read file'))
    reader.readAsText(file)
  })
}

function Chevron({ left }: { left: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-3.5 w-3.5 ${left ? '' : 'rotate-180'}`}
    >
      <path
        d="M10 4L6 8l4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const BTN =
  'inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50'

export function Sidebar({
  open,
  onToggle,
  params,
  setParam,
  setParams,
  clearAll,
}: {
  open: boolean
  onToggle: () => void
  params: ListParams
  setParam: (key: ListParamKey, value: string | undefined) => void
  setParams: (patch: ListParamPatch) => void
  clearAll: () => void
}) {
  const meta = useMeta()
  const importTrace = useImportTrace()
  const [importOpen, setImportOpen] = useState(false)
  const [dragging, setDragging] = useState(false)

  // Sole drag-and-drop entry point: dropping files anywhere on the sidebar runs
  // the same import mutation the Import dialog uses.
  const importFiles = async (files: File[]) => {
    for (const file of files) {
      try {
        await importTrace.mutateAsync({ type: 'text', content: await readText(file) })
      } catch {
        // per-file failure — the dialog is the path for detailed errors
      }
    }
  }

  if (!open) {
    return (
      <aside
        data-testid="sidebar-collapsed"
        className="flex w-10 shrink-0 flex-col items-center border-r border-slate-200 bg-white py-2"
      >
        <button
          type="button"
          data-testid="sidebar-toggle"
          aria-label="Open sidebar"
          onClick={onToggle}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <Chevron left={false} />
        </button>
      </aside>
    )
  }

  return (
    <aside
      data-testid="sidebar"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void importFiles(Array.from(e.dataTransfer.files))
      }}
      className={`relative flex w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white ${
        dragging ? 'ring-2 ring-inset ring-blue-400' : ''
      }`}
    >
      {dragging && (
        <div
          data-testid="sidebar-drop-overlay"
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-blue-50/80 text-sm font-medium text-blue-700"
        >
          Drop trace files to import
        </div>
      )}
      {/* Non-scrolling head: brand + actions. */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-slate-100 px-3 py-3">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-base font-semibold text-slate-900">Trace Viewer</h1>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              {meta.data ? `${formatNumber(meta.data.traceCount)} traces` : 'Loading…'}
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                Local
              </span>
            </p>
          </div>
          <button
            type="button"
            data-testid="sidebar-toggle"
            aria-label="Collapse sidebar"
            onClick={onToggle}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Chevron left />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="import-open"
            onClick={() => setImportOpen(true)}
            className={BTN}
          >
            Import a trace
          </button>
          <Link to="/compare" data-testid="compare-link" className={BTN}>
            Compare runs
          </Link>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        <RunTree params={params} setParam={setParam} />
        {/* Current-selection stats and the component tree only make sense once a
            run/filter narrows the corpus — hidden until then (mirrors the main pane). */}
        {hasActiveSelection(params) && <SelectionStats params={params} />}
        {hasActiveSelection(params) && <CategoryTree params={params} setParams={setParams} />}
        <SidebarFilters params={params} setParam={setParam} clearAll={clearAll} />
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </aside>
  )
}
