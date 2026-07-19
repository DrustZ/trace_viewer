import { Router } from 'express'
import { PlaygroundError, type PlaygroundParams, runPlayground } from '../ai/playground'
import { asyncHandler, isRecord, type RouteCtx } from './context'

/** Validates the request body; null when malformed. */
function parseBody(body: unknown): ({ traceId: string } & PlaygroundParams) | null {
  if (!isRecord(body) || typeof body.traceId !== 'string' || body.traceId === '') return null
  if (body.uptoMessageId !== undefined && typeof body.uptoMessageId !== 'string') return null
  if (body.userOverride !== undefined && typeof body.userOverride !== 'string') return null
  if (
    body.checkpointStep !== undefined &&
    (typeof body.checkpointStep !== 'number' || !Number.isFinite(body.checkpointStep))
  ) {
    return null
  }
  return {
    traceId: body.traceId,
    uptoMessageId: body.uptoMessageId,
    userOverride: body.userOverride,
    checkpointStep: body.checkpointStep,
  }
}

/** POST /api/playground — checkpoint replay simulation against a stand-in model. */
export function playgroundRoutes(ctx: RouteCtx): Router {
  const router = Router()

  // 503 without ANTHROPIC_API_KEY, 502 on upstream failure (mapped from PlaygroundError).
  router.post(
    '/api/playground',
    asyncHandler(async (req, res) => {
      const body = parseBody(req.body)
      if (!body) {
        res.status(400).json({
          error:
            'body must be { traceId: string, uptoMessageId?: string, userOverride?: string, checkpointStep?: number }',
        })
        return
      }
      const trace = ctx.store.getFull(body.traceId)
      if (!trace) {
        res.status(404).json({ error: 'trace not found' })
        return
      }
      try {
        const result = await runPlayground(trace, body)
        res.json(result)
      } catch (err) {
        if (err instanceof PlaygroundError) {
          res.status(err.status).json({ error: err.message })
          return
        }
        throw err
      }
    }),
  )

  return router
}
