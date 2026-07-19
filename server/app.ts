import path from 'node:path'
import express, { type Express } from 'express'

/**
 * App factory — takes dependencies explicitly so tests can build an app
 * around a fixture store (supertest) without touching the filesystem.
 * The store type is introduced in M2/M3; for now the factory wires health only.
 */
export interface AppDeps {
  version?: string
}

export function createApp(deps: AppDeps = {}): Express {
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  app.use(express.text({ limit: '50mb', type: 'text/plain' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: deps.version ?? 'dev' })
  })

  if (process.env.NODE_ENV === 'production') {
    const dist = path.resolve(import.meta.dirname, '../dist')
    app.use(express.static(dist))
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'))
    })
  }

  return app
}
