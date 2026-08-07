import path from 'node:path'
import { Router } from 'express'
import type { AceTaskQuery, AceTasksResponse } from '../../shared/schema/aceTasks'
import { filterAceTasks, loadAceTaskCatalog } from '../ace/taskCatalog'
import type { AceTaskScoringExporter } from '../ace/taskScoringAuthority'
import { PROJECT_ROOT } from '../config/dataRoots'
import { asyncHandler, firstParam, type RouteCtx } from './context'

const MAX_QUERY_LENGTH = 256

export interface AceTaskRouteConfig {
  projectRoot: string
  scoringExporter?: AceTaskScoringExporter
}

export function resolveAceTaskConfig(): AceTaskRouteConfig {
  return {
    projectRoot: path.resolve(
      process.env.ACE_PROJECT_ROOT ?? path.join(PROJECT_ROOT, '..', 'ac_express'),
    ),
  }
}

function queryValue(value: unknown): string | undefined {
  const candidate = firstParam(value)?.trim()
  return candidate && candidate.length <= MAX_QUERY_LENGTH ? candidate : undefined
}

function taskQuery(query: Record<string, unknown>): AceTaskQuery {
  return {
    q: queryValue(query.q),
    id: queryValue(query.id),
    suite: queryValue(query.suite),
    issue: queryValue(query.issue),
    language: queryValue(query.language),
    journey: queryValue(query.journey),
    persona: queryValue(query.persona),
    sourcePack: queryValue(query.sourcePack),
  }
}

async function safelyLoad(ctx: RouteCtx, config: AceTaskRouteConfig) {
  try {
    return await loadAceTaskCatalog(config.projectRoot, ctx.store.list(), {
      scoringExporter: config.scoringExporter,
    })
  } catch {
    return null
  }
}

/** Read-only access to the fixed ACE configs/scenarios directory. */
export function aceTasksRoutes(
  ctx: RouteCtx,
  config: AceTaskRouteConfig = resolveAceTaskConfig(),
): Router {
  const router = Router()

  router.get(
    '/api/ace/tasks',
    asyncHandler(async (req, res) => {
      const catalog = await safelyLoad(ctx, config)
      if (!catalog) {
        res.status(503).json({
          error: 'ACE task catalog unavailable',
          detail: 'Check the local ACE configs/scenarios directory.',
        })
        return
      }
      const items = filterAceTasks(catalog.tasks, taskQuery(req.query))
      res.json({
        total: catalog.tasks.length,
        filteredTotal: items.length,
        items,
        facets: catalog.facets,
        source: catalog.source,
      } satisfies AceTasksResponse)
    }),
  )

  router.get(
    '/api/ace/tasks/:scenarioId',
    asyncHandler(async (req, res) => {
      const scenarioId = String(req.params.scenarioId)
      if (
        scenarioId.length === 0 ||
        scenarioId.length > MAX_QUERY_LENGTH ||
        [...scenarioId].some((character) => character.charCodeAt(0) < 32)
      ) {
        res.status(400).json({ error: 'invalid scenario id' })
        return
      }
      const catalog = await safelyLoad(ctx, config)
      if (!catalog) {
        res.status(503).json({
          error: 'ACE task catalog unavailable',
          detail: 'Check the local ACE configs/scenarios directory.',
        })
        return
      }
      const task = catalog.tasks.find((candidate) => candidate.scenarioId === scenarioId)
      if (!task) {
        res.status(404).json({ error: 'ACE task not found' })
        return
      }
      res.json({ ...task, source: catalog.source, scoring: catalog.scoring })
    }),
  )

  return router
}
