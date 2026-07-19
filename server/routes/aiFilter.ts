import { Router } from 'express'
import { parseNlQuery } from '../../shared/filter/nlRules'
import type { AiFilterResponse } from '../../shared/schema/api'
import { isRecord, type RouteCtx } from './context'

export function aiFilterRoutes(ctx: RouteCtx): Router {
  const router = Router()

  // Rules-only for now; the LLM path plugs in behind the same response shape later.
  router.post('/api/ai-filter', (req, res) => {
    const body: unknown = req.body
    const query = isRecord(body) && typeof body.query === 'string' ? body.query.trim() : ''
    if (query === '') {
      res.status(400).json({ error: 'query is required' })
      return
    }
    const components = [...new Set(ctx.store.list().map((s) => s.meta.component))]
    const { filter, explanation } = parseNlQuery(query, { components })
    res.json({ filter, source: 'rules', explanation } satisfies AiFilterResponse)
  })

  return router
}
