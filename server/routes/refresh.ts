import { Router } from 'express'
import type { RefreshResponse } from '../../shared/schema/api'
import { type ScanResult, scanAll } from '../store/scan'
import { asyncHandler, type RouteCtx } from './context'

export function refreshRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.post(
    '/api/refresh',
    asyncHandler(async (_req, res) => {
      let result: ScanResult
      if (ctx.dataRootManager) {
        result = await ctx.dataRootManager.refresh()
      } else {
        ctx.store.clear()
        result = await scanAll(ctx.store, ctx.dataRoots)
      }
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
