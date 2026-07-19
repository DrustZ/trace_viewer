import { Router } from 'express'
import { buildEvolutionSeries } from '../../shared/stats/evolution'
import type { RouteCtx } from './context'

export function evolutionRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.get('/api/evolution/:instanceId', (req, res) => {
    const series = buildEvolutionSeries(ctx.store.list(), req.params.instanceId)
    if (!series) {
      res.status(404).json({ error: 'instance not found' })
      return
    }
    res.json(series)
  })

  return router
}
