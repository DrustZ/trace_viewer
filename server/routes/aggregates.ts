import { Router } from 'express'
import { decodeFilterSet, encodeFilterSet } from '../../shared/filter/parse'
import { componentAggregates, rewardCurves, statTiles } from '../../shared/stats/aggregate'
import { firstParam, type RouteCtx } from './context'
import { appliedSummaries } from './listParams'

/**
 * The list query minus the given keys: drops both the exact-match param and
 * any filter-DSL conditions on those keys, keeping the rest of the pipeline
 * (run/status/custom filters, q) intact.
 */
function queryWithoutKeys(query: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...query }
  for (const key of keys) delete out[key]
  const conditions = decodeFilterSet(firstParam(query.filters)).conditions.filter(
    (c) => !keys.includes(c.key),
  )
  if (conditions.length > 0) out.filters = encodeFilterSet({ conditions })
  else delete out.filters
  return out
}

export function aggregatesRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.get('/api/aggregates/tiles', (req, res) => {
    res.json(statTiles(appliedSummaries(ctx, req.query)))
  })

  router.get('/api/aggregates/components', (req, res) => {
    // Full list-filter pipeline EXCEPT component conditions: the table always
    // shows every component under the current run/status/custom selection.
    const items = appliedSummaries(ctx, queryWithoutKeys(req.query, ['component']))
    res.json(componentAggregates(items))
  })

  router.get('/api/aggregates/curves', (req, res) => {
    const raw = req.query.component
    const components =
      raw === undefined ? undefined : [raw].flat().filter((c): c is string => typeof c === 'string')
    // Full pipeline EXCEPT component (the ?component series selector above),
    // step (the x-axis) and split (train/test are the two series).
    const items = appliedSummaries(ctx, queryWithoutKeys(req.query, ['component', 'step', 'split']))
    res.json(rewardCurves(items, components))
  })

  return router
}
