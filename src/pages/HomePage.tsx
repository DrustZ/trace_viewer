import { FilterBar } from '../components/home/FilterBar'
import { Header } from '../components/home/Header'
import { StatTiles } from '../components/home/StatTiles'
import { TraceTable } from '../components/home/TraceTable'
import { useListParams } from '../state/filterParams'

export default function HomePage() {
  const { params, setParam, setParams, clearAll } = useListParams()

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto flex max-w-[1400px] flex-col gap-4 px-6 py-4">
        <StatTiles params={params} />
        <FilterBar params={params} setParam={setParam} clearAll={clearAll} />
        <TraceTable params={params} setParams={setParams} />
      </main>
    </div>
  )
}
