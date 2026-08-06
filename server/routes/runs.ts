import { Router } from 'express'
import { runOf } from '../../shared/stats/evolution'
import { firstParam, type RouteCtx } from './context'

const DEFAULT_INSTANCE_LIMIT = 200
const MAX_INSTANCE_LIMIT = 1000

interface MutableRunAggregate {
  count: number
  scoreSum: number
  scoredCount: number
  instances: Set<string>
}

interface RunCatalog {
  version: number
  runs: Array<{ run: string; count: number; avgScore: number | null }>
  allInstances: string[]
  instancesByRun: Map<string, string[]>
}

function repeatedStrings(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v !== ''))]
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number(firstParam(value))
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

/**
 * Metadata-only catalog for run pickers and compare instance suggestions.
 * It is rebuilt at most once per store dataVersion; no message bodies leave
 * the server and result sets stay bounded even for very large corpora.
 */
export function runsRoutes(ctx: RouteCtx): Router {
  const router = Router()
  let cached: RunCatalog | undefined

  const catalog = (): RunCatalog => {
    if (cached?.version === ctx.store.dataVersion) return cached

    const aggregates = new Map<string, MutableRunAggregate>()
    const allInstances = new Set<string>()
    for (const summary of ctx.store.list()) {
      const run = runOf(summary)
      let aggregate = aggregates.get(run)
      if (!aggregate) {
        aggregate = { count: 0, scoreSum: 0, scoredCount: 0, instances: new Set() }
        aggregates.set(run, aggregate)
      }
      aggregate.count += 1
      if (summary.stats.score !== null && Number.isFinite(summary.stats.score)) {
        aggregate.scoreSum += summary.stats.score
        aggregate.scoredCount += 1
      }
      aggregate.instances.add(summary.meta.instanceId)
      allInstances.add(summary.meta.instanceId)
    }

    const instancesByRun = new Map<string, string[]>()
    for (const [run, aggregate] of aggregates) {
      instancesByRun.set(run, [...aggregate.instances].sort())
    }
    cached = {
      version: ctx.store.dataVersion,
      runs: [...aggregates.entries()]
        .map(([run, aggregate]) => ({
          run,
          count: aggregate.count,
          avgScore: aggregate.scoredCount > 0 ? aggregate.scoreSum / aggregate.scoredCount : null,
        }))
        .sort((a, b) => a.run.localeCompare(b.run)),
      allInstances: [...allInstances].sort(),
      instancesByRun,
    }
    return cached
  }

  router.get('/api/runs', (_req, res) => {
    const current = catalog()
    res.json({
      total: current.runs.length,
      items: current.runs,
      dataVersion: current.version,
    })
  })

  router.get('/api/runs/instances', (req, res) => {
    const current = catalog()
    const runs = repeatedStrings(req.query.run)
    const source =
      runs.length === 0
        ? current.allInstances
        : [...new Set(runs.flatMap((run) => current.instancesByRun.get(run) ?? []))].sort()
    const query = firstParam(req.query.q)?.trim().toLowerCase() ?? ''
    const matches = query === '' ? source : source.filter((id) => id.toLowerCase().includes(query))
    const limit = boundedInteger(req.query.limit, DEFAULT_INSTANCE_LIMIT, MAX_INSTANCE_LIMIT)
    const offset = boundedInteger(req.query.offset, 0, Number.MAX_SAFE_INTEGER)

    res.json({
      total: matches.length,
      items: matches.slice(offset, offset + limit),
      limit,
      offset,
      dataVersion: current.version,
    })
  })

  return router
}
