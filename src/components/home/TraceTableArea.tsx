import type { ListParams } from '../../api/hooks'
import type { ListParamPatch } from '../../state/filterParams'
import { TraceTable } from './TraceTable'

/**
 * The trace table region of the home page. Row selection is lifted to HomePage
 * (the `peek` URL param + the preview drawer live there) so the drawer stays
 * mounted even when this gated area isn't — e.g. right after an import with no
 * run selected.
 */
export function TraceTableArea({
  params,
  setParams,
  selectedId,
  onSelect,
}: {
  params: ListParams
  setParams: (patch: ListParamPatch) => void
  selectedId?: string
  onSelect: (traceId: string | null) => void
}) {
  return (
    <div className="relative min-h-[340px] flex-1">
      <TraceTable
        params={params}
        setParams={setParams}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </div>
  )
}
