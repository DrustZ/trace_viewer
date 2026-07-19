import type { Trace } from '@shared/schema/types'
import { EmptyState } from '../common/EmptyState'
import { ConversationView } from './ConversationView'
import { MetadataTab } from './MetadataTab'
import { RawTab } from './RawTab'
import { TraceHeader, type TraceTab } from './TraceHeader'

function ComingSoon() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <EmptyState title="Coming in v0.5" hint="This view ships in the next milestone." />
    </div>
  )
}

/** Shared trace renderer: header strip + tab bar + tab content. Fills its parent's height. */
export function TraceView({
  trace,
  tab,
  onTabChange,
  variant,
  listSearch = '',
  onNavigate,
  onClose,
}: {
  trace: Trace
  tab: TraceTab
  onTabChange: (tab: TraceTab) => void
  variant: 'page' | 'drawer'
  listSearch?: string
  onNavigate?: (traceId: string) => void
  onClose?: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TraceHeader
        trace={trace}
        activeTab={tab}
        onTabChange={onTabChange}
        variant={variant}
        listSearch={listSearch}
        onNavigate={onNavigate}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1">
        {tab === 'conversation' && <ConversationView trace={trace} />}
        {tab === 'timeline' && <ComingSoon />}
        {tab === 'metadata' && (
          <div className="h-full overflow-y-auto">
            <MetadataTab trace={trace} />
          </div>
        )}
        {tab === 'evolution' && <ComingSoon />}
        {tab === 'raw' && <RawTab traceId={trace.meta.traceId} active />}
      </div>
    </div>
  )
}
