import { decodeFilterSet, encodeFilterSet } from '@shared/filter/parse'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { type ListParams, useMeta, useRefresh } from '../../../api/hooks'
import type { ListParamKey, ListParamPatch } from '../../../state/filterParams'
import { formatNumber } from '../../common/format'
import { GlobalSearchBox } from '../GlobalSearchBox'
import { ImportDialog } from '../ImportDialog'
import { CategoryTree } from './CategoryTree'
import { ImportDropzone } from './ImportDropzone'
import { SelectionStats } from './SelectionStats'
import { SidebarFilters } from './SidebarFilters'

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

function ReloadIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={`h-3 w-3 ${spinning ? 'animate-spin' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

const BTN =
  'inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50'

/** Known training runs. Static, time-boxed: the corpus is generated with exactly these. */
const RUNS = ['run-a', 'run-b']

function runFromFilters(filters: string | undefined): string {
  const cond = decodeFilterSet(filters).conditions.find((c) => c.key === 'run' && c.op === 'eq')
  return cond && !Array.isArray(cond.value) ? String(cond.value) : ''
}

/** 'RUN' selector: applies/removes a `run.eq.<x>` condition on the filters param. */
function RunSection({
  params,
  setParam,
}: {
  params: ListParams
  setParam: (key: ListParamKey, value: string | undefined) => void
}) {
  const setRun = (value: string) => {
    const others = decodeFilterSet(params.filters).conditions.filter(
      (c) => !(c.key === 'run' && c.op === 'eq'),
    )
    const conditions = value === '' ? others : [...others, { key: 'run', op: 'eq' as const, value }]
    setParam('filters', encodeFilterSet({ conditions }) || undefined)
  }
  return (
    <section data-testid="run-section" className="flex flex-col gap-1.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Run</h2>
      <select
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
        data-testid="run-select"
        aria-label="Run"
        value={runFromFilters(params.filters)}
        onChange={(e) => setRun(e.target.value)}
      >
        <option value="">All runs</option>
        {RUNS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </section>
  )
}

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
  const refresh = useRefresh()
  const [importOpen, setImportOpen] = useState(false)

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
      className="flex w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white"
    >
      {/* Non-scrolling head: brand + search, so the search dropdown can overflow the sidebar. */}
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
            Import
          </button>
          <button
            type="button"
            data-testid="reload"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className={BTN}
          >
            <ReloadIcon spinning={refresh.isPending} />
            Reload
          </button>
          <Link to="/compare" data-testid="compare-link" className={BTN}>
            Compare runs
          </Link>
        </div>
        <GlobalSearchBox />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        <RunSection params={params} setParam={setParam} />
        <SelectionStats params={params} />
        <CategoryTree params={params} setParams={setParams} />
        <SidebarFilters params={params} setParam={setParam} clearAll={clearAll} />
        <ImportDropzone onOpenDialog={() => setImportOpen(true)} />
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </aside>
  )
}
