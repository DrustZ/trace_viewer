import { useMemo } from 'react'
import { type ListParams, useComponentAggregates, useRewardCurves } from '../../api/hooks'
import type { ListParamKey } from '../../state/filterParams'
import { formatScore } from '../common/format'
import { CollapsibleSection } from './CollapsibleSection'
import { ComponentTable } from './ComponentTable'
import { RewardCurveChart } from './RewardCurveChart'

/**
 * Collapsible analytics sections of the main column: reward curves and the
 * component table. Stat tiles and filters live in the sidebar now.
 * Summary hooks share query keys with the section bodies, so they add no fetches.
 */
export function TopPanel({
  params,
  setParam,
}: {
  params: ListParams
  setParam: (key: ListParamKey, value: string | undefined) => void
}) {
  const curves = useRewardCurves(params.component ? [params.component] : undefined)
  const aggregates = useComponentAggregates(params)

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
    <div className="flex shrink-0 flex-col gap-3">
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
    </div>
  )
}
