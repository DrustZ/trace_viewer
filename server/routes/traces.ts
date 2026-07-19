import { promises as fs } from 'node:fs'
import { Router } from 'express'
import type {
  GroupedTracesResponse,
  InstanceGroup,
  NeighborsResponse,
  TracesListResponse,
} from '../../shared/schema/api'
import type { TraceSummary } from '../../shared/schema/types'
import { asyncHandler, firstParam, type RouteCtx } from './context'
import { appliedSummaries } from './listParams'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 5000

/** Score desc with nulls last, traceId asc tiebreak — the siblings order. */
function scoreDescNullsLast(a: TraceSummary, b: TraceSummary): number {
  const sa = a.stats.score
  const sb = b.stats.score
  if (sa !== sb) {
    if (sa === null) return 1
    if (sb === null) return -1
    return sb - sa
  }
  return a.meta.traceId < b.meta.traceId ? -1 : a.meta.traceId > b.meta.traceId ? 1 : 0
}

/** Groups already-sorted items by instanceId, preserving first-seen order. */
function groupByInstance(items: TraceSummary[]): InstanceGroup[] {
  const byInstance = new Map<string, TraceSummary[]>()
  for (const s of items) {
    const at = byInstance.get(s.meta.instanceId)
    if (at) at.push(s)
    else byInstance.set(s.meta.instanceId, [s])
  }
  return [...byInstance.entries()].map(([instanceId, group]) => {
    const scores = group.map((s) => s.stats.score).filter((v): v is number => v !== null)
    return {
      instanceId,
      component: group[0].meta.component,
      count: group.length,
      avgScore: scores.length > 0 ? scores.reduce((acc, v) => acc + v, 0) / scores.length : null,
      items: group,
    }
  })
}

export function tracesRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.get('/api/traces', (req, res) => {
    const items = appliedSummaries(ctx, req.query)
    const total = items.length
    const limitRaw = Number(firstParam(req.query.limit))
    const limit =
      Number.isFinite(limitRaw) && limitRaw >= 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT
    const offsetRaw = Number(firstParam(req.query.offset))
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0
    const page = items.slice(offset, offset + limit)
    if (firstParam(req.query.groupBy) === 'instance') {
      res.json({ total, groups: groupByInstance(page) } satisfies GroupedTracesResponse)
      return
    }
    res.json({ total, items: page } satisfies TracesListResponse)
  })

  router.get('/api/traces/:id', (req, res) => {
    const trace = ctx.store.getFull(req.params.id)
    if (!trace) {
      res.status(404).json({ error: 'trace not found' })
      return
    }
    res.json(trace)
  })

  router.get(
    '/api/traces/:id/raw',
    asyncHandler(async (req, res) => {
      // asyncHandler erases the route-literal param inference; :id is always a string.
      const stored = ctx.store.get(String(req.params.id))
      if (!stored?.sourcePath) {
        res.status(404).json({ error: 'raw source not available' })
        return
      }
      try {
        const text = await fs.readFile(stored.sourcePath, 'utf8')
        res.type('text/plain').send(text)
      } catch {
        res.status(404).json({ error: 'raw source not available' })
      }
    }),
  )

  router.get('/api/traces/:id/neighbors', (req, res) => {
    const items = appliedSummaries(ctx, req.query)
    const idx = items.findIndex((s) => s.meta.traceId === req.params.id)
    const body: NeighborsResponse =
      idx === -1
        ? { prevId: null, nextId: null, position: 0, total: items.length }
        : {
            prevId: idx > 0 ? items[idx - 1].meta.traceId : null,
            nextId: idx < items.length - 1 ? items[idx + 1].meta.traceId : null,
            position: idx + 1,
            total: items.length,
          }
    res.json(body)
  })

  router.get('/api/traces/:id/siblings', (req, res) => {
    const trace = ctx.store.getFull(req.params.id)
    if (!trace) {
      res.status(404).json({ error: 'trace not found' })
      return
    }
    const siblings = ctx.store
      .list()
      .filter(
        (s) =>
          s.meta.traceId !== trace.meta.traceId &&
          s.meta.instanceId === trace.meta.instanceId &&
          s.meta.checkpointStep === trace.meta.checkpointStep,
      )
      .sort(scoreDescNullsLast)
    res.json(siblings)
  })

  return router
}
