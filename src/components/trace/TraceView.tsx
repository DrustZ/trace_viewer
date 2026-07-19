import type { Trace } from '@shared/schema/types'
import { ConversationView } from './ConversationView'
import { EvolutionTab } from './EvolutionTab'
import { MetadataTab } from './MetadataTab'
import { RawTab } from './RawTab'
import { TimelineTab } from './TimelineTab'
import { TraceHeader, type TraceTab } from './TraceHeader'

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
        {tab === 'timeline' && (
          <div className="h-full overflow-y-auto">
            <TimelineTab trace={trace} />
          </div>
        )}
        {tab === 'metadata' && (
          <div className="h-full overflow-y-auto">
            <MetadataTab trace={trace} />
          </div>
        )}
        {tab === 'evolution' && (
          <div className="h-full overflow-y-auto">
            <EvolutionTab trace={trace} onNavigate={onNavigate} />
          </div>
        )}
        {tab === 'raw' && <RawTab traceId={trace.meta.traceId} active />}
      </div>
    </div>
  )
}
