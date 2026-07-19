import { promises as dns } from 'node:dns'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { parseAny } from '../../shared/connectors/registry'
import type { ImportResponse } from '../../shared/schema/api'
import { asyncHandler, isRecord, type RouteCtx } from './context'

const FETCH_TIMEOUT_MS = 15000
const MAX_BYTES = 25 * 1024 * 1024

const EXT_BY_FORMAT: Record<string, string> = {
  native: '.json',
  'openai-chat': '.json',
  harmony: '.txt',
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function isPrivateIp(address: string, family: number): boolean {
  if (family === 4) {
    const [a, b] = address.split('.').map(Number)
    if (a === 127 || a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    return false
  }
  const lower = address.toLowerCase()
  if (lower === '::1') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7
  if (lower.startsWith('fe8') || lower.startsWith('fe9')) return true // fe80::/10 link-local
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice('::ffff:'.length), 4)
  return false
}

/** SSRF guard: http(s) only, and the resolved host must be public unless ALLOW_PRIVATE_URLS=1. */
async function assertUrlAllowed(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'only http(s) URLs are allowed')
  }
  if (process.env.ALLOW_PRIVATE_URLS === '1') return
  let results: Array<{ address: string; family: number }>
  try {
    results = await dns.lookup(url.hostname, { all: true })
  } catch {
    throw new HttpError(400, `cannot resolve host '${url.hostname}'`)
  }
  if (results.some((r) => isPrivateIp(r.address, r.family))) {
    throw new HttpError(
      400,
      'URL resolves to a private address (set ALLOW_PRIVATE_URLS=1 to allow)',
    )
  }
}

async function fetchText(url: URL): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new HttpError(400, `fetch failed: HTTP ${res.status}`)
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw new HttpError(400, 'response exceeds the 25MB limit')
    }
    if (!res.body) return ''
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_BYTES) {
        await reader.cancel()
        throw new HttpError(400, 'response exceeds the 25MB limit')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch (e) {
    if (e instanceof HttpError) throw e
    const message =
      e instanceof Error && e.name === 'AbortError'
        ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s`
        : e instanceof Error
          ? e.message
          : String(e)
    throw new HttpError(400, `fetch failed: ${message}`)
  } finally {
    clearTimeout(timer)
  }
}

export function importRoutes(ctx: RouteCtx): Router {
  const router = Router()

  router.post(
    '/api/import',
    asyncHandler(async (req, res) => {
      const body: unknown = req.body
      if (!isRecord(body) || (body.type !== 'text' && body.type !== 'url')) {
        res.status(400).json({ error: "type must be 'text' or 'url'" })
        return
      }
      const format = typeof body.format === 'string' ? body.format : undefined

      let text: string
      let source: string
      try {
        if (body.type === 'url') {
          if (typeof body.url !== 'string' || body.url === '') {
            throw new HttpError(400, 'url is required for type "url"')
          }
          let url: URL
          try {
            url = new URL(body.url)
          } catch {
            throw new HttpError(400, `invalid url '${body.url}'`)
          }
          await assertUrlAllowed(url)
          text = await fetchText(url)
          source = url.toString()
        } else {
          if (typeof body.content !== 'string' || body.content === '') {
            throw new HttpError(400, 'content is required for type "text"')
          }
          text = body.content
          source = 'pasted'
        }
      } catch (e) {
        if (e instanceof HttpError) {
          res.status(e.status).json({ error: e.message })
          return
        }
        throw e
      }

      const result = parseAny(
        text,
        { sourcePath: source, fallbackTimestamp: new Date().toISOString() },
        format,
      )
      if (result.traces.length === 0) {
        res.status(422).json({ error: 'no traces could be parsed', warnings: result.warnings })
        return
      }

      // Atomic commit: run every check first; nothing is written or upserted
      // until the whole batch passes. Connector-level salvage (bad entries
      // dropped with warnings) happens above in parseAny — atomicity applies
      // to the commit of whatever the connector accepted.

      // (a) duplicate traceIds within the batch itself.
      const seen = new Set<string>()
      const duplicates = new Set<string>()
      for (const t of result.traces) {
        if (seen.has(t.meta.traceId)) duplicates.add(t.meta.traceId)
        else seen.add(t.meta.traceId)
      }
      if (duplicates.size > 0) {
        res.status(409).json({
          error: 'duplicate traceIds within the imported batch',
          duplicates: [...duplicates],
        })
        return
      }

      // (b) traceIds already in the store — importing the same file twice must
      // not silently re-upsert. body.overwrite === true skips this check.
      const overwrite = body.overwrite === true
      if (!overwrite) {
        const conflicts = result.traces
          .map((t) => t.meta.traceId)
          .filter((id) => ctx.store.get(id) !== undefined)
        if (conflicts.length > 0) {
          res.status(409).json({
            error: 'traceIds already exist in the store (pass overwrite: true to replace)',
            conflicts,
          })
          return
        }
      }

      // (c) filename collision — decided only after validation passes.
      const first = result.traces[0]
      const sourceFormat = first.meta.sourceFormat
      const ext = EXT_BY_FORMAT[sourceFormat] ?? '.json'
      const base = first.meta.traceId.replace(/[^\w.-]+/g, '_')
      await fs.mkdir(ctx.importDir, { recursive: true })
      let fileName = `${base}${ext}`
      for (let n = 2; await pathExists(path.join(ctx.importDir, fileName)); n++) {
        fileName = `${base}-${n}${ext}`
      }
      const filePath = path.join(ctx.importDir, fileName)

      // Commit point: write the raw file, then upsert the whole batch.
      await fs.writeFile(filePath, text, 'utf8')
      for (const parsed of result.traces) ctx.store.upsert(parsed, filePath)

      res.json({
        traceIds: result.traces.map((t) => t.meta.traceId),
        format: sourceFormat,
        warnings: [...result.warnings, ...result.traces.flatMap((t) => t.warnings)],
      } satisfies ImportResponse)
    }),
  )

  return router
}
