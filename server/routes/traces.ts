import { promises as fs } from 'node:fs'
import { type Response, Router } from 'express'
import type { AceTaskDetail } from '../../shared/schema/aceTasks'
import type {
  GroupedTracesResponse,
  InstanceGroup,
  NeighborsResponse,
  TracesListResponse,
} from '../../shared/schema/api'
import { recordedCheckpoint } from '../../shared/schema/provenance'
import type { TraceSummary } from '../../shared/schema/types'
import { runOf } from '../../shared/stats/evolution'
import { projectAceTraceDimensions } from '../ace/traceDimensions'
import { asyncHandler, firstParam, type RouteCtx } from './context'
import { appliedSummaries, appliedTraceSummaries } from './listParams'
import { publicTrace, publicTraceSummary } from './publicView'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 5000

function addressOf(summary: TraceSummary): string {
  return summary.meta.traceUid ?? summary.meta.traceId
}

function resolveStored(ctx: RouteCtx, id: string, res: Response) {
  const lookup = ctx.store.lookup(id)
  if (lookup.kind === 'found') return lookup.stored
  if (lookup.kind === 'ambiguous') {
    res.status(409).json({
      error: 'legacy trace id is ambiguous',
      sourceTraceId: lookup.sourceTraceId,
      candidates: lookup.candidates,
    })
    return undefined
  }
  res.status(404).json({ error: 'trace not found' })
  return undefined
}

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

/** Group-average bound params: applied AFTER grouping, on each group's avgScore. */
const GROUP_AVG_BOUNDS = [
  ['groupAvgLt', (avg: number, bound: number) => avg < bound],
  ['groupAvgLte', (avg: number, bound: number) => avg <= bound],
  ['groupAvgGt', (avg: number, bound: number) => avg > bound],
  ['groupAvgGte', (avg: number, bound: number) => avg >= bound],
] as const

/**
 * Filters instance groups by avgScore bounds (groupAvgLt/Lte/Gt/Gte). The
 * per-trace filter DSL cannot express group averages (e.g. "groups with avg
 * reward < 0.5" over 0/1 scores); these bounds act on the grouped rows.
 * Groups with a null avgScore are excluded by any bound.
 */
function applyGroupAvgBounds(
  groups: InstanceGroup[],
  query: Record<string, unknown>,
): InstanceGroup[] {
  let out = groups
  for (const [param, passes] of GROUP_AVG_BOUNDS) {
    const raw = firstParam(query[param])
    if (raw === undefined || raw === '') continue
    const bound = Number(raw)
    if (!Number.isFinite(bound)) continue
    out = out.filter((g) => g.avgScore !== null && passes(g.avgScore, bound))
  }
  return out
}

export interface TraceRouteDeps {
  loadTaskDefinitions?: () => Promise<readonly AceTaskDetail[]>
}

export function tracesRoutes(ctx: RouteCtx, deps: TraceRouteDeps = {}): Router {
  const router = Router()

  const filteredSummaries = async (query: Record<string, unknown>) => {
    if (!deps.loadTaskDefinitions) return appliedSummaries(ctx, query)
    let tasks: readonly AceTaskDetail[] = []
    try {
      tasks = await deps.loadTaskDefinitions()
    } catch {
      // Generic trace browsing remains available when the optional ACE task
      // catalog is missing. In that case only trace-recorded metadata filters.
    }
    return appliedTraceSummaries(ctx, projectAceTraceDimensions(ctx.store.list(), tasks), query)
  }

  router.get(
    '/api/traces',
    asyncHandler(async (req, res) => {
      const items = await filteredSummaries(req.query)
      const limitRaw = Number(firstParam(req.query.limit))
      const limit =
        Number.isFinite(limitRaw) && limitRaw >= 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT
      const offsetRaw = Number(firstParam(req.query.offset))
      const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0
      if (firstParam(req.query.groupBy) === 'instance') {
        // Group the complete filtered corpus first. Paginating traces before this
        // step biased group counts/averages whenever a corpus exceeded the page.
        const allGroups = applyGroupAvgBounds(groupByInstance(items), req.query)
        const groups = allGroups.slice(offset, offset + limit).map((group) => ({
          ...group,
          items: group.items.map(publicTraceSummary),
        }))
        const total = allGroups.reduce((sum, group) => sum + group.count, 0)
        res.json({ total, groups } satisfies GroupedTracesResponse)
        return
      }
      const total = items.length
      const page = items.slice(offset, offset + limit).map(publicTraceSummary)
      res.json({ total, items: page } satisfies TracesListResponse)
    }),
  )

  router.get('/api/traces/:id', (req, res) => {
    const stored = resolveStored(ctx, req.params.id, res)
    if (stored) res.json(publicTrace(stored.trace))
  })

  router.get(
    '/api/traces/:id/raw',
    asyncHandler(async (req, res) => {
      // asyncHandler erases the route-literal param inference; :id is always a string.
      const stored = resolveStored(ctx, String(req.params.id), res)
      if (!stored) return
      // Ephemeral imports keep their source text in memory (no file on disk).
      if (stored?.rawText !== undefined) {
        res.type('text/plain').send(stored.rawText)
        return
      }
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

  router.get(
    '/api/traces/:id/neighbors',
    asyncHandler(async (req, res) => {
      const items = await filteredSummaries(req.query)
      const requestId = String(req.params.id)
      const lookup = ctx.store.lookup(requestId)
      if (lookup.kind === 'ambiguous') {
        res.status(409).json({
          error: 'legacy trace id is ambiguous',
          sourceTraceId: lookup.sourceTraceId,
          candidates: lookup.candidates,
        })
        return
      }
      const requestedUid = lookup.kind === 'found' ? lookup.traceUid : requestId
      const idx = items.findIndex((s) => addressOf(s) === requestedUid)
      const body: NeighborsResponse =
        idx === -1
          ? { prevId: null, nextId: null, position: 0, total: items.length }
          : {
              // Compatibility aliases are accepted only as input. Navigation
              // always returns canonical UIDs because a neighboring producer
              // id may be duplicated even when the current id is unique.
              prevId: idx > 0 ? addressOf(items[idx - 1]) : null,
              nextId: idx < items.length - 1 ? addressOf(items[idx + 1]) : null,
              position: idx + 1,
              total: items.length,
            }
      res.json(body)
    }),
  )

  router.get('/api/traces/:id/siblings', (req, res) => {
    const stored = resolveStored(ctx, req.params.id, res)
    if (!stored) return
    const trace = stored.trace
    const currentUid = trace.meta.traceUid ?? trace.meta.traceId
    // Same instance + step within the SAME RUN only — the same instanceId can
    // exist in several runs and cross-run rollouts are not siblings.
    const checkpoint = recordedCheckpoint(trace.meta)
    if (checkpoint === null) {
      res.json([])
      return
    }
    const run = runOf(trace)
    const siblings = ctx.store
      .list()
      .filter(
        (s) =>
          addressOf(s) !== currentUid &&
          s.meta.instanceId === trace.meta.instanceId &&
          recordedCheckpoint(s.meta) === checkpoint &&
          runOf(s) === run,
      )
      .sort(scoreDescNullsLast)
    res.json(siblings.map(publicTraceSummary))
  })

  return router
}
