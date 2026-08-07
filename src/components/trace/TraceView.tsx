import type { ReviewSubject } from '@shared/reviews/types'
import type { Trace } from '@shared/schema/types'
import { ReviewPanel } from '../review/ReviewPanel'
import { ConversationView } from './ConversationView'
import { EvaluationTab } from './EvaluationTab'
import { EvolutionTab } from './EvolutionTab'
import { MetadataTab } from './MetadataTab'
import { PlaygroundTab } from './PlaygroundTab'
import { RawTab } from './RawTab'
import { ReplayTab } from './ReplayTab'
import { StateToolsTab } from './StateToolsTab'
import { TraceChat } from './TraceChat'
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
  const traceUid = trace.meta.traceUid ?? trace.meta.traceId
  const reviewSubject: ReviewSubject = {
    corpusId:
      trace.meta.corpusId ??
      (trace.meta.sourceFormat.startsWith('ace') ? 'simulation' : 'production'),
    runId:
      trace.meta.runId ??
      (typeof trace.meta.extra?.run === 'string' ? trace.meta.extra.run : 'unassigned'),
    traceUid,
    rubricVersion: trace.evaluation?.judge?.rubricVersion ?? 'judge_v2',
    annotator: 'local',
    // A trace page already exposes evaluation/state/replay metadata. Calling
    // that surface "Calibration" would make blind review trivially bypassable.
    mode: 'assisted',
  }
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <TraceHeader
        trace={trace}
        activeTab={tab}
        onTabChange={onTabChange}
        variant={variant}
        listSearch={listSearch}
        onNavigate={onNavigate}
        onClose={onClose}
        blindReview={false}
      />
      <div className="min-h-0 flex-1">
        {tab === 'conversation' && <ConversationView trace={trace} />}
        {tab === 'evaluation' && (
          <div className="h-full overflow-y-auto">
            <EvaluationTab trace={trace} />
          </div>
        )}
        {tab === 'review' && (
          <div className="h-full overflow-y-auto bg-slate-50 px-4 py-4">
            <div className="mx-auto mb-3 flex max-w-4xl items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Inline trace review is Assisted because this page exposes automatic evaluation,
                state, replay, and raw metadata.
              </p>
              <a
                href="/reviews?mode=calibration&corpusId=ace&state=unreviewed"
                data-testid="blind-calibration-link"
                className="shrink-0 text-xs font-medium text-violet-700 hover:underline"
              >
                Open blind Calibration workspace ↗
              </a>
            </div>
            <ReviewPanel
              key={`${traceUid}:assisted`}
              subject={reviewSubject}
              className="mx-auto max-w-4xl"
            />
          </div>
        )}
        {tab === 'state' && (
          <div className="h-full overflow-y-auto">
            <StateToolsTab trace={trace} />
          </div>
        )}
        {tab === 'replay' && (
          <div className="h-full overflow-y-auto">
            <ReplayTab key={traceUid} trace={trace} />
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
        {tab === 'playground' && (
          <div className="h-full overflow-y-auto">
            {/* Keyed by trace: controls (cut message id, step) are trace-specific state. */}
            <PlaygroundTab key={traceUid} trace={trace} />
          </div>
        )}
        {tab === 'raw' && <RawTab traceId={traceUid} active />}
      </div>
      <TraceChat traceId={traceUid} />
    </div>
  )
}
