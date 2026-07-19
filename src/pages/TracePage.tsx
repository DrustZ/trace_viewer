import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useTrace } from '../api/hooks'
import { EmptyState, ErrorState, LoadingState } from '../components/common/EmptyState'
import { ConversationView } from '../components/trace/ConversationView'
import { MetadataTab } from '../components/trace/MetadataTab'
import { RawTab } from '../components/trace/RawTab'
import { TRACE_TABS, TraceHeader, type TraceTab } from '../components/trace/TraceHeader'

function ComingSoon() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <EmptyState title="Coming in v0.5" hint="This view ships in the next milestone." />
    </div>
  )
}

export default function TracePage() {
  const { traceId } = useParams()
  const [searchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: TraceTab = TRACE_TABS.includes(rawTab as TraceTab)
    ? (rawTab as TraceTab)
    : 'conversation'
  const trace = useTrace(traceId)

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

  const data = trace.data
  return (
    <div className="flex h-screen flex-col">
      <TraceHeader trace={data} activeTab={tab} />
      <div className="min-h-0 flex-1">
        {tab === 'conversation' && <ConversationView trace={data} />}
        {tab === 'timeline' && <ComingSoon />}
        {tab === 'metadata' && (
          <div className="h-full overflow-y-auto">
            <MetadataTab trace={data} />
          </div>
        )}
        {tab === 'evolution' && <ComingSoon />}
        {tab === 'raw' && <RawTab traceId={data.meta.traceId} active />}
      </div>
    </div>
  )
}
