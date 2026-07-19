import { Router } from 'express'
import { buildEvolutionSeries } from '../../shared/stats/evolution'
import { firstParam, type RouteCtx } from './context'

export function evolutionRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.get('/api/evolution/:instanceId', (req, res) => {
    // ?run= scopes the series to one run; absent keeps the legacy all-runs behavior.
    const run = firstParam(req.query.run)
    const series = buildEvolutionSeries(ctx.store.list(), req.params.instanceId, run)
    if (!series) {
      res.status(404).json({ error: 'instance not found' })
      return
    }
    res.json(series)
  })

  return router
}
