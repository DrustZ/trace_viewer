import { Router } from 'express'
import type { AddDataRootResponse, DataRootsResponse } from '../../shared/schema/dataRoots'
import { asyncHandler, isRecord, type RouteCtx } from './context'

export function dataRootsRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.get('/api/data-roots', (_req, res) => {
    res.json({
      roots: ctx.dataRootManager?.list() ?? [],
      persistenceAvailable: ctx.dataRootManager?.persistenceAvailable ?? false,
    } satisfies DataRootsResponse)
  })

  router.post(
    '/api/data-roots',
    asyncHandler(async (req, res) => {
      if (!isRecord(req.body)) {
        res.status(400).json({ error: 'body must be a JSON object' })
        return
      }
      if (!ctx.dataRootManager) {
        res.status(503).json({ error: 'runtime data-root manager is unavailable' })
        return
      }
      const added = await ctx.dataRootManager.add(req.body.path, req.body.label)
      res.status(201).json(added satisfies AddDataRootResponse)
    }),
  )

  return router
}
