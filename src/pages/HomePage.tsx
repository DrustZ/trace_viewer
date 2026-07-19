import { Header } from '../components/home/Header'
import { TopPanel } from '../components/home/TopPanel'
import { TraceTableArea } from '../components/home/TraceTableArea'
import { useListParams } from '../state/filterParams'

/**
 * Viewport-height layout: the header never scrolls. When TopPanel + table fit,
 * only the trace table scrolls internally; on short viewports main itself
 * scrolls so the table keeps a usable minimum height (see TraceTableArea).
 */
export default function HomePage() {
  const { params, setParam, setParams, clearAll } = useListParams()

  return (
    <div className="flex h-screen flex-col">
      <Header />
      <main className="mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 flex-col gap-3 overflow-y-auto px-6 py-3">
        <TopPanel params={params} setParam={setParam} clearAll={clearAll} />
        <TraceTableArea params={params} setParams={setParams} />
      </main>
    </div>
  )
}
