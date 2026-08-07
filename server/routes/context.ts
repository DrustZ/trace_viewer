import type { Request, RequestHandler, Response } from 'express'
import type { SearchIndex } from '../search/searchIndex'
import type { DataRootManager } from '../store/dataRootManager'
import type { TraceStore } from '../store/traceStore'

/** Dependencies shared by every route factory; assembled once in createApp. */
export interface RouteCtx {
  store: TraceStore
  searchIndex: SearchIndex
  /** Roots rescanned by POST /api/refresh. */
  dataRoots: string[]
  /** Runtime root registry used by refresh and the typed local-folder API. */
  dataRootManager?: DataRootManager
  /** Directory where POST /api/import persists raw uploads. */
  importDir: string
}

/** Routes any rejection into the JSON error middleware instead of crashing the process. */
export function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next)
  }
}

/** First value of a possibly-repeated query param. */
export function firstParam(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' ? v : undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
