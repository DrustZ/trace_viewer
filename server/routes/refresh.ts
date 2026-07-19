import { Router } from 'express'
import type { RefreshResponse } from '../../shared/schema/api'
import { scanAll } from '../store/scan'
import { asyncHandler, type RouteCtx } from './context'

export function refreshRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.post(
    '/api/refresh',
    asyncHandler(async (_req, res) => {
      ctx.store.clear()
      const result = await scanAll(ctx.store, ctx.dataRoots)
      console.log(
        `[api] ${result.traces} traces from ${result.files} files (${result.warnings} warnings) in ${result.ms}ms`,
      )
      res.json({
        traces: ctx.store.size,
        dataVersion: ctx.store.dataVersion,
      } satisfies RefreshResponse)
    }),
  )

  return router
}
