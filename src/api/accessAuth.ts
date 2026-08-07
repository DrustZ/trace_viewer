export const AUTH_REQUIRED_EVENT = 'trace-viewer:auth-required'

export interface ParsedAccessTokenHash {
  accessToken: string | null
  nextHash: string
}

/** Parse only the fragment so an access token is never sent in an HTTP request URL. */
export function parseAccessTokenHash(hash: string): ParsedAccessTokenHash {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const params = new URLSearchParams(raw)
  const accessToken = params.get('access_token')
  if (accessToken === null) return { accessToken: null, nextHash: hash }
  params.delete('access_token')
  const remainder = params.toString()
  return { accessToken, nextHash: remainder ? `#${remainder}` : '' }
}

/** Consume the startup credential before React mounts, then remove it from browser history. */
export function consumeAccessTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const parsed = parseAccessTokenHash(window.location.hash)
  if (parsed.accessToken === null) return null
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${parsed.nextHash}`,
  )
  return parsed.accessToken
}

export function notifyAuthenticationRequired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new window.Event(AUTH_REQUIRED_EVENT))
  }
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error) return body.error
  } catch {
    // Fall back to the status below for non-JSON responses.
  }
  return response.statusText || `authentication failed (${response.status})`
}

export async function exchangeAccessToken(token: string): Promise<void> {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!response.ok) throw new Error(await responseError(response))
}
