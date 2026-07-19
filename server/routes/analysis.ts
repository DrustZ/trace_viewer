import { Router } from 'express'
import { AnalysisError, runAnalysis } from '../ai/analyst'
import { asyncHandler, isRecord, type RouteCtx } from './context'

/** POST /api/analysis { query } → { report, steps } — the AI analysis agent. */
export function analysisRoutes(ctx: RouteCtx): Router {
  const router = Router()

  // 503 without ANTHROPIC_API_KEY, 502 on upstream failure (mapped from AnalysisError).
  router.post(
    '/api/analysis',
    asyncHandler(async (req, res) => {
      const query =
        isRecord(req.body) && typeof req.body.query === 'string' ? req.body.query.trim() : ''
      if (query === '') {
        res.status(400).json({ error: 'query must be a non-empty string' })
        return
      }
      try {
        res.json(await runAnalysis(ctx, query))
      } catch (err) {
        if (err instanceof AnalysisError) {
          res.status(err.status).json({ error: err.message })
          return
        }
        throw err
      }
    }),
  )

  return router
}
