import { Router } from 'express'
import type { AiFilterResponse } from '../../shared/schema/api'
import { recordedCheckpoint } from '../../shared/schema/provenance'
import { nlToFilter } from '../ai/anthropic'
import { asyncHandler, isRecord, type RouteCtx } from './context'

export function aiFilterRoutes(ctx: RouteCtx): Router {
  const router = Router()

  // LLM when ANTHROPIC_API_KEY is set, deterministic rules otherwise (nlToFilter never throws).
  router.post(
    '/api/ai-filter',
    asyncHandler(async (req, res) => {
      const body: unknown = req.body
      const query = isRecord(body) && typeof body.query === 'string' ? body.query.trim() : ''
      if (query === '') {
        res.status(400).json({ error: 'query is required' })
        return
      }
      const summaries = ctx.store.list()
      const components = [...new Set(summaries.map((s) => s.meta.component))].sort()
      const steps = [
        ...new Set(
          summaries.flatMap((s) => {
            const step = recordedCheckpoint(s.meta)
            return step === null ? [] : [step]
          }),
        ),
      ].sort((a, b) => a - b)
      const result = await nlToFilter(query, { components, steps })
      res.json(result satisfies AiFilterResponse)
    }),
  )

  return router
}
