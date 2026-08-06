import path from 'node:path'
import express, { type ErrorRequestHandler, type Express } from 'express'
import { aggregatesRoutes } from './routes/aggregates'
import { aiFilterRoutes } from './routes/aiFilter'
import { analysisRoutes } from './routes/analysis'
import { chatRoutes } from './routes/chat'
import { isRecord, type RouteCtx } from './routes/context'
import { evolutionRoutes } from './routes/evolution'
import { importRoutes } from './routes/importRoute'
import { metaRoutes } from './routes/meta'
import { playgroundRoutes } from './routes/playground'
import { refreshRoutes } from './routes/refresh'
import { runsRoutes } from './routes/runs'
import { searchRoutes } from './routes/search'
import { tracesRoutes } from './routes/traces'
import { SearchIndex } from './search/searchIndex'
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
  /** Directory where POST /api/import persists raw uploads. */
  importDir?: string
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
  const ctx: RouteCtx = {
    store,
    searchIndex: new SearchIndex(store),
    dataRoots: deps.dataRoots ?? DEFAULT_ROOTS,
    importDir: deps.importDir ?? 'data/imported',
  }

  const app = express()
  app.use(express.json({ limit: '5mb' }))
  app.use(express.text({ limit: '50mb', type: 'text/plain' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: deps.version ?? 'dev' })
  })

  app.use(metaRoutes(ctx))
  app.use(runsRoutes(ctx))
  app.use(tracesRoutes(ctx))
  app.use(chatRoutes(ctx))
  app.use(analysisRoutes(ctx))
  app.use(playgroundRoutes(ctx))
  app.use(aggregatesRoutes(ctx))
  app.use(evolutionRoutes(ctx))
  app.use(searchRoutes(ctx))
  app.use(importRoutes(ctx))
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
