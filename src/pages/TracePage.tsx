import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useTrace } from '../api/hooks'
import { ErrorState, LoadingState } from '../components/common/EmptyState'
import { resolveTraceTab, type TraceTab } from '../components/trace/TraceHeader'
import { TraceView } from '../components/trace/TraceView'

export default function TracePage() {
  const { traceId } = useParams()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  // Legacy deep links (state/replay/playground/metadata) map onto the five tabs.
  const tab: TraceTab = resolveTraceTab(searchParams.get('tab'))
  const trace = useTrace(traceId)

  const onTabChange = (next: TraceTab) => {
    const p = new URLSearchParams(searchParams)
    p.set('tab', next)
    setSearchParams(p, { replace: true })
  }

  if (trace.isLoading) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <LoadingState label="Loading trace…" />
      </div>
    )
  }

  if (trace.isError || !trace.data) {
    const notFound = trace.error instanceof ApiError && trace.error.status === 404
    const message = notFound
      ? `Trace '${traceId}' was not found.`
      : `Failed to load trace: ${trace.error instanceof Error ? trace.error.message : 'unknown error'}`
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <ErrorState message={message} />
        <Link to="/" className="inline-block text-sm text-slate-600 underline hover:text-slate-900">
          ← Back to traces
        </Link>
      </div>
    )
  }

  return (
    <div className="h-screen">
      <TraceView
        trace={trace.data}
        tab={tab}
        onTabChange={onTabChange}
        variant="page"
        listSearch={location.search}
      />
    </div>
  )
}
