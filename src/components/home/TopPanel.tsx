import { useMemo } from 'react'
import { type ListParams, useComponentAggregates, useRewardCurves, useTiles } from '../../api/hooks'
import type { ListParamKey } from '../../state/filterParams'
import { formatNumber, formatScore } from '../common/format'
import { CollapsibleSection } from './CollapsibleSection'
import { ComponentTable } from './ComponentTable'
import { FilterBar } from './FilterBar'
import { RewardCurveChart } from './RewardCurveChart'
import { StatTiles } from './StatTiles'

/**
 * Non-scrolling top region of the home page: stat tiles, reward curves,
 * component table (each collapsible) and the always-visible filter bar.
 * Summary hooks share query keys with the section bodies, so they add no fetches.
 */
export function TopPanel({
  params,
  setParam,
  clearAll,
}: {
  params: ListParams
  setParam: (key: ListParamKey, value: string | undefined) => void
  clearAll: () => void
}) {
  const tiles = useTiles(params)
  const curves = useRewardCurves(params.component ? [params.component] : undefined)
  const aggregates = useComponentAggregates(params)

  const overviewSummary = tiles.data
    ? `${formatNumber(tiles.data.total)} traces · avg ${formatScore(tiles.data.avgScore)}`
    : undefined

  const curvesSummary = curves.data
    ? `${curves.data.train.length} train · ${curves.data.test.length} test points`
    : undefined

  const componentsSummary = useMemo(() => {
    const rows = aggregates.data
    if (!rows || rows.length === 0) return undefined
    const components = new Set(rows.map((r) => r.component))
    let sum = 0
    let weight = 0
    for (const r of rows) {
      if (r.avgScore === null || r.count === 0) continue
      sum += r.avgScore * r.count
      weight += r.count
    }
    const avg = weight === 0 ? '—' : formatScore(sum / weight)
    return `${components.size} components · avg ${avg}`
  }, [aggregates.data])

  return (
    <div className="flex flex-col gap-3">
      <CollapsibleSection id="overview" title="Overview" summary={overviewSummary} defaultOpen>
        <StatTiles params={params} />
      </CollapsibleSection>
      <CollapsibleSection id="curves" title="Reward curves" summary={curvesSummary} defaultOpen>
        <RewardCurveChart params={params} setParam={setParam} />
      </CollapsibleSection>
      <CollapsibleSection
        id="components"
        title="Components"
        summary={componentsSummary}
        defaultOpen
      >
        <ComponentTable params={params} setParam={setParam} />
      </CollapsibleSection>
      <FilterBar params={params} setParam={setParam} clearAll={clearAll} />
    </div>
  )
}
