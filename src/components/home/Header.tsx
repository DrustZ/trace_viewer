import { useMeta, useRefresh } from '../../api/hooks'
import { formatNumber } from '../common/format'

function ReloadIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 ${spinning ? 'animate-spin' : ''}`}
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

export function Header() {
  const meta = useMeta()
  const refresh = useRefresh()

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Trace Viewer</h1>
          <p className="text-xs text-slate-500">
            {meta.data
              ? `${formatNumber(meta.data.traceCount)} traces · data v${meta.data.dataVersion}`
              : 'Loading…'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <ReloadIcon spinning={refresh.isPending} />
          Reload
        </button>
      </div>
    </header>
  )
}
