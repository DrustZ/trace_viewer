import { useState } from 'react'
import { AnalysisPanel } from '../components/home/AnalysisPanel'
import { RunStatusBar } from '../components/home/RunStatusBar'
import { Sidebar } from '../components/home/sidebar/Sidebar'
import { TopPanel } from '../components/home/TopPanel'
import { TraceTableArea } from '../components/home/TraceTableArea'
import { useListParams } from '../state/filterParams'

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
        <RunStatusBar params={params} sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
          <AnalysisPanel setParam={setParam} />
          <TopPanel params={params} setParam={setParam} />
          <TraceTableArea params={params} setParams={setParams} />
        </main>
      </div>
    </div>
  )
}
