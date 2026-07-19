import { Router } from 'express'
import { firstParam, type RouteCtx } from './context'

export function searchRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.get('/api/search', (req, res) => {
    const q = firstParam(req.query.q)?.trim() ?? ''
    if (q.length < 2) {
      res.json([])
      return
    }
    const limitRaw = Number(firstParam(req.query.limit))
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20
    res.json(ctx.searchIndex.search(q, limit))
  })

  return router
}
