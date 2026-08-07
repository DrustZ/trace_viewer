import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'

export const ACCESS_TOKEN_ENV = 'TRACE_VIEWER_ACCESS_TOKEN'
export const SESSION_COOKIE_NAME = 'trace_viewer_session'
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

const SESSION_CONTEXT = 'trace-viewer-access-session:v1'

/** Empty and unset values preserve the local, unauthenticated development workflow. */
export function normalizeAccessToken(value: string | null | undefined): string | undefined {
  return value !== undefined && value !== null && value.length > 0 ? value : undefined
}

/** Compare fixed-length hashes so different input lengths do not create a timing oracle. */
export function timingSafeStringEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}

/**
 * Derive the browser session credential from the configured secret. The plaintext access token
 * is never placed in a cookie, URL after bootstrap, response body, or server-side session store.
 */
export function sessionDigest(accessToken: string): string {
  return createHmac('sha256', accessToken).update(SESSION_CONTEXT).digest('base64url')
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const key = part.slice(0, separator).trim()
    if (key !== name) continue
    const value = part.slice(separator + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return undefined
    }
  }
  return undefined
}

export function createSessionHandler(accessToken: string | undefined): RequestHandler {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store')

    // Keep the endpoint harmless and convenient in the default local-development mode.
    if (!accessToken) {
      res.json({ ok: true, authRequired: false })
      return
    }

    const supplied =
      typeof req.body === 'object' && req.body !== null && typeof req.body.token === 'string'
        ? req.body.token
        : undefined
    if (!supplied || !timingSafeStringEqual(supplied, accessToken)) {
      res.status(401).json({ error: 'invalid access token', code: 'INVALID_ACCESS_TOKEN' })
      return
    }

    res.cookie(SESSION_COOKIE_NAME, sessionDigest(accessToken), {
      httpOnly: true,
      sameSite: 'strict',
      // Tailscale Serve terminates TLS and forwards the original scheme. Keep
      // localhost/plain-tailnet development usable, but mark HTTPS sessions Secure.
      secure: req.secure || req.header('x-forwarded-proto') === 'https',
      path: '/api',
      maxAge: SESSION_MAX_AGE_SECONDS * 1_000,
    })
    res.json({ ok: true, authRequired: true, expiresInSeconds: SESSION_MAX_AGE_SECONDS })
  }
}

export function requireAccessSession(accessToken: string | undefined): RequestHandler {
  if (!accessToken) return (_req, _res, next) => next()
  const expected = sessionDigest(accessToken)

  return (req, res, next) => {
    const supplied = cookieValue(req.header('cookie'), SESSION_COOKIE_NAME)
    if (supplied && timingSafeStringEqual(supplied, expected)) {
      next()
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    res.status(401).json({ error: 'authentication required', code: 'AUTH_REQUIRED' })
  }
}
