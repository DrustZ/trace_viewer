import { Router } from 'express'
import { FILTER_KEYS } from '../../shared/filter/keys'
import type { MetaResponse } from '../../shared/schema/api'
import type { Split, TraceStatus } from '../../shared/schema/types'
import { getScanProgress, type ScanProgress } from '../store/scan'
import type { RouteCtx } from './context'

const SPLIT_ORDER: Split[] = ['train', 'test']
const STATUS_ORDER: TraceStatus[] = ['completed', 'failed', 'executing']

/** Additive scan-progress fields ride along without touching the shared contract. */
type MetaWithProgress = MetaResponse & ScanProgress

export function metaRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.get('/api/meta', (_req, res) => {
    const summaries = ctx.store.list()
    const body: MetaWithProgress = {
      ...getScanProgress(),
      components: [...new Set(summaries.map((s) => s.meta.component))].sort(),
      steps: [...new Set(summaries.map((s) => s.meta.checkpointStep))].sort((a, b) => a - b),
      splits: SPLIT_ORDER.filter((sp) => summaries.some((s) => s.meta.split === sp)),
      statuses: STATUS_ORDER.filter((st) => summaries.some((s) => s.meta.status === st)),
      filterKeys: FILTER_KEYS,
      traceCount: ctx.store.size,
      dataVersion: ctx.store.dataVersion,
    }
    res.json(body)
  })

  return router
}
