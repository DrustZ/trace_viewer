import { Router } from 'express'
import { componentAggregates, rewardCurves, statTiles } from '../../shared/stats/aggregate'
import { firstParam, type RouteCtx } from './context'
import { appliedSummaries } from './listParams'

export function aggregatesRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.get('/api/aggregates/tiles', (req, res) => {
    res.json(statTiles(appliedSummaries(ctx, req.query)))
  })

  router.get('/api/aggregates/components', (req, res) => {
    let items = ctx.store.list()
    const split = firstParam(req.query.split)
    if (split) items = items.filter((s) => s.meta.split === split)
    const step = firstParam(req.query.step)
    if (step) {
      const stepNum = Number(step)
      items = items.filter((s) => s.meta.checkpointStep === stepNum)
    }
    res.json(componentAggregates(items))
  })

  router.get('/api/aggregates/curves', (req, res) => {
    const raw = req.query.component
    const components =
      raw === undefined ? undefined : [raw].flat().filter((c): c is string => typeof c === 'string')
    res.json(rewardCurves(ctx.store.list(), components))
  })

  return router
}
