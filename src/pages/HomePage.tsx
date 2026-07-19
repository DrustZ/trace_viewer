import { useCallback, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { EmptyState } from '../components/common/EmptyState'
import { AnalysisPanel } from '../components/home/AnalysisPanel'
import { CollapsibleSection } from '../components/home/CollapsibleSection'
import { RewardCurveChart } from '../components/home/RewardCurveChart'
import { RunStatusBar } from '../components/home/RunStatusBar'
import { Sidebar } from '../components/home/sidebar/Sidebar'
import { TraceDrawer } from '../components/home/TraceDrawer'
import { TraceTableArea } from '../components/home/TraceTableArea'
import { hasActiveSelection, useListParams } from '../state/filterParams'

const SIDEBAR_KEY = 'tv.sidebar.open'

function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * Vertical layout: fixed-width sidebar (filters, categories, import) on the
 * left; the main column has a slim run-status bar, then a scrollable content
 * column (curves, components, trace table).
 */
export default function HomePage() {
  const { params, setParam, setParams, clearAll } = useListParams()
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen)

  // The preview drawer is owned here (not inside the gated table area) so an
  // imported trace or a shared ?peek= link opens even with no run selected.
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

  const toggleSidebar = () =>
    setSidebarOpen((prev) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, prev ? '0' : '1')
      } catch {
        // storage unavailable — state stays in-memory only
      }
      return !prev
    })

  return (
    <div className="flex h-screen flex-row">
      <Sidebar
        open={sidebarOpen}
        onToggle={toggleSidebar}
        params={params}
        setParam={setParam}
        setParams={setParams}
        clearAll={clearAll}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <RunStatusBar params={params} />
        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
          {hasActiveSelection(params) ? (
            <>
              <AnalysisPanel setParam={setParam} />
              <CollapsibleSection id="curves" title="Reward curves" defaultOpen>
                <RewardCurveChart params={params} setParam={setParam} />
              </CollapsibleSection>
              <TraceTableArea
                params={params}
                setParams={setParams}
                selectedId={peek ?? undefined}
                onSelect={setPeek}
              />
            </>
          ) : (
            <EmptyState
              title="Select a run to begin"
              hint="Pick a run from the RUNS list on the left (or a component below it), or Import a trace. Nothing is loaded until you choose — a real corpus can hold thousands of runs."
            />
          )}
        </main>
      </div>
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
