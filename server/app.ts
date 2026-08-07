import path from 'node:path'
import express, { type ErrorRequestHandler, type Express } from 'express'
import { loadAceTaskCatalog } from './ace/taskCatalog'
import {
  ACCESS_TOKEN_ENV,
  createSessionHandler,
  normalizeAccessToken,
  requireAccessSession,
} from './auth'
import type { ReviewStore } from './reviews/reviewStore'
import { createTraceStoreReviewSource } from './reviews/traceSource'
import { aceRoutes } from './routes/ace'
import { aceTasksRoutes, resolveAceTaskConfig } from './routes/aceTasks'
import { aggregatesRoutes } from './routes/aggregates'
import { aiFilterRoutes } from './routes/aiFilter'
import { analysisRoutes } from './routes/analysis'
import { chatRoutes } from './routes/chat'
import { isRecord, type RouteCtx } from './routes/context'
import { dataRootsRoutes } from './routes/dataRoots'
import { eventsRoutes } from './routes/events'
import { evolutionRoutes } from './routes/evolution'
import { importRoutes } from './routes/importRoute'
import { metaRoutes } from './routes/meta'
import { playgroundRoutes } from './routes/playground'
import { refreshRoutes } from './routes/refresh'
import { reviewsRoutes } from './routes/reviews'
import { runsRoutes } from './routes/runs'
import { searchRoutes } from './routes/search'
import { tracesRoutes } from './routes/traces'
import { SearchIndex } from './search/searchIndex'
import { DataRootManager } from './store/dataRootManager'
import { DEFAULT_ROOTS } from './store/scan'
import { TraceStore } from './store/traceStore'

/**
 * App factory — takes dependencies explicitly so tests can build an app
 * around a fixture store (supertest) without touching the filesystem.
 */
export interface AppDeps {
  version?: string
  store?: TraceStore
  /** Roots rescanned by POST /api/refresh. */
  dataRoots?: string[]
  /** Injectable runtime root manager for server startup and focused route tests. */
  dataRootManager?: DataRootManager
  /** Directory where POST /api/import persists raw uploads. */
  importDir?: string
  /** Append-only human labels + atomic drafts. Defaults to sibling ACE runs/labels. */
  reviewStore?: ReviewStore
  /** Stable Calibration alias key override. Tests should inject a 32-byte Buffer. */
  reviewBlindSecret?: Buffer
  /** Explicit override for focused tests. Undefined reads TRACE_VIEWER_ACCESS_TOKEN; null disables. */
  accessToken?: string | null
}

/** Malformed JSON bodies arrive as body-parser errors with a 4xx status; everything else is a 500. */
const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  const status =
    isRecord(err) && typeof err.status === 'number' && err.status >= 400 && err.status < 500
      ? err.status
      : 500
  res.status(status).json({ error: err instanceof Error ? err.message : 'internal error' })
}

export function createApp(deps: AppDeps = {}): Express {
  const store = deps.store ?? new TraceStore()
  const dataRootManager =
    deps.dataRootManager ?? new DataRootManager(store, deps.dataRoots ?? DEFAULT_ROOTS)
  const ctx: RouteCtx = {
    store,
    searchIndex: new SearchIndex(store),
    dataRoots: dataRootManager.dataRoots,
    dataRootManager,
    importDir: deps.importDir ?? 'data/imported',
  }
  const aceTaskProjectRoot = resolveAceTaskConfig().projectRoot
  const accessToken = normalizeAccessToken(
    deps.accessToken === undefined ? process.env[ACCESS_TOKEN_ENV] : deps.accessToken,
  )

  const app = express()
  app.use(express.json({ limit: '5mb' }))
  app.use(express.text({ limit: '50mb', type: 'text/plain' }))

  app.all('/api/health', (req, res, next) => {
    // Express lets HEAD implicitly match GET routes. Keep the documented public exception exact.
    if (req.method !== 'GET') {
      next()
      return
    }
    res.json({ ok: true, version: deps.version ?? 'dev' })
  })
  app.post('/api/auth/session', createSessionHandler(accessToken))

  // The two public routes above are intentionally method-specific. Every other API request,
  // including SSE and unknown /api paths, must present the derived session cookie when enabled.
  app.use('/api', requireAccessSession(accessToken))

  app.use(metaRoutes(ctx))
  app.use(dataRootsRoutes(ctx))
  app.use(eventsRoutes(ctx))
  app.use(aceRoutes(ctx))
  app.use(aceTasksRoutes(ctx))
  app.use(runsRoutes(ctx))
  app.use(
    tracesRoutes(ctx, {
      loadTaskDefinitions: () =>
        loadAceTaskCatalog(aceTaskProjectRoot, store.list()).then((catalog) => catalog.tasks),
    }),
  )
  app.use(
    reviewsRoutes({
      traceSource: createTraceStoreReviewSource(store, {
        loadTaskCatalog: () => loadAceTaskCatalog(aceTaskProjectRoot),
      }),
      reviewStore: deps.reviewStore,
      blindSecret: deps.reviewBlindSecret,
    }),
  )
  app.use(chatRoutes(ctx))
  app.use(analysisRoutes(ctx))
  app.use(playgroundRoutes(ctx))
  app.use(aggregatesRoutes(ctx))
  app.use(evolutionRoutes(ctx))
  app.use(searchRoutes(ctx))
  // URL fetching is intentionally localhost-only. An authenticated shared/Tailnet server would
  // otherwise still expose an outbound network primitive to every holder of its access token.
  app.use(importRoutes(ctx, { urlImportEnabled: accessToken === undefined }))
  app.use(aiFilterRoutes(ctx))
  app.use(refreshRoutes(ctx))

  if (process.env.NODE_ENV === 'production') {
    const dist = path.resolve(import.meta.dirname, '../dist')
    app.use(express.static(dist))
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'))
    })
  }

  app.use(errorHandler)

  return app
}
