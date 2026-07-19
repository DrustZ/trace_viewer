import { useCallback } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import type { ListParams } from '../../api/hooks'
import type { ListParamPatch } from '../../state/filterParams'
import { TraceDrawer } from './TraceDrawer'
import { TraceTable } from './TraceTable'

/**
 * Scrollable bottom region of the home page: the trace table plus the
 * slide-over trace preview drawer. Owns row-selection state via the 'peek'
 * URL param (shareable, back-button friendly; never sent to the server —
 * searchToListParams whitelists list keys).
 */
export function TraceTableArea({
  params,
  setParams,
}: {
  params: ListParams
  setParams: (patch: ListParamPatch) => void
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const peek = searchParams.get('peek')

  const setPeek = useCallback(
    (traceId: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (traceId) next.set('peek', traceId)
        else next.delete('peek')
        return next
      })
    },
    [setSearchParams],
  )

  return (
    <div className="relative min-h-[340px] flex-1">
      <TraceTable
        params={params}
        setParams={setParams}
        selectedId={peek ?? undefined}
        onSelect={setPeek}
      />
      {peek && (
        <TraceDrawer
          traceId={peek}
          onClose={() => setPeek(null)}
          onNavigate={setPeek}
          listSearch={location.search}
        />
      )}
    </div>
  )
}
