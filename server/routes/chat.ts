import { Router } from 'express'
import { type ChatMessage, TraceChatError, traceChat } from '../ai/traceChat'
import { maySendTraceToExternalAi } from '../privacy'
import { asyncHandler, isRecord, type RouteCtx } from './context'

const MAX_HISTORY = 20

/** Validates body.messages as [{role:'user'|'assistant', content:string}]; null if malformed. */
function parseMessages(body: unknown): ChatMessage[] | null {
  if (!isRecord(body) || !Array.isArray(body.messages)) return null
  const out: ChatMessage[] = []
  for (const entry of body.messages) {
    if (!isRecord(entry)) return null
    if (entry.role !== 'user' && entry.role !== 'assistant') return null
    if (typeof entry.content !== 'string') return null
    out.push({ role: entry.role, content: entry.content })
  }
  return out
}

export function chatRoutes(ctx: RouteCtx): Router {
  const router = Router()

  // 503 without ANTHROPIC_API_KEY, 502 on upstream failure (mapped from TraceChatError).
  router.post(
    '/api/traces/:id/chat',
    asyncHandler(async (req, res) => {
      const trace = ctx.store.getFull(String(req.params.id))
      if (!trace) {
        res.status(404).json({ error: 'trace not found' })
        return
      }
      if (!maySendTraceToExternalAi(trace)) {
        res.status(403).json({
          error:
            'external AI is disabled for production traces; set ACE_ALLOW_EXTERNAL_AI=1 to opt in',
        })
        return
      }
      const messages = parseMessages(req.body)
      if (!messages || messages.length === 0) {
        res.status(400).json({ error: 'messages must be a non-empty array of {role, content}' })
        return
      }
      if (messages[messages.length - 1].role !== 'user') {
        res.status(400).json({ error: 'last message must have role "user"' })
        return
      }
      try {
        const result = await traceChat(trace, messages.slice(-MAX_HISTORY))
        res.json(result)
      } catch (err) {
        if (err instanceof TraceChatError) {
          res.status(err.status).json({ error: err.message })
          return
        }
        throw err
      }
    }),
  )

  return router
}
