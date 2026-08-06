import { Router } from 'express'
import { FILTER_KEYS } from '../../shared/filter/keys'
import type { MetaResponse } from '../../shared/schema/api'
import { recordedCheckpoint } from '../../shared/schema/provenance'
import type { Split, TraceStatus } from '../../shared/schema/types'
import { getScanProgress } from '../store/scan'
import type { RouteCtx } from './context'

const SPLIT_ORDER: Split[] = ['train', 'test', 'unknown']
const STATUS_ORDER: TraceStatus[] = ['completed', 'failed', 'executing', 'unknown']

export function metaRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.get('/api/meta', (_req, res) => {
    const summaries = ctx.store.list()
    const body: MetaResponse = {
      ...getScanProgress(),
      components: [...new Set(summaries.map((s) => s.meta.component))].sort(),
      steps: [
        ...new Set(
          summaries.flatMap((s) => {
            const step = recordedCheckpoint(s.meta)
            return step === null ? [] : [step]
          }),
        ),
      ].sort((a, b) => a - b),
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
