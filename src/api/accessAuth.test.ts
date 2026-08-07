import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_REQUIRED_EVENT,
  consumeAccessTokenFromUrl,
  exchangeAccessToken,
  parseAccessTokenHash,
} from './accessAuth'
import { apiGet } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('browser access-token bootstrap', () => {
  it('extracts and removes only access_token from the URL fragment', () => {
    expect(parseAccessTokenHash('#access_token=one%20two&view=failures')).toEqual({
      accessToken: 'one two',
      nextHash: '#view=failures',
    })
    expect(parseAccessTokenHash('#view=failures')).toEqual({
      accessToken: null,
      nextHash: '#view=failures',
    })
  })

  it('removes the consumed token from browser history before returning it', () => {
    const replaceState = vi.fn()
    vi.stubGlobal('window', {
      location: {
        hash: '#access_token=tailnet-secret&view=latest',
        pathname: '/ace',
        search: '?run=live',
      },
      history: { state: { navigation: 1 }, replaceState },
    })

    expect(consumeAccessTokenFromUrl()).toBe('tailnet-secret')
    expect(replaceState).toHaveBeenCalledWith({ navigation: 1 }, '', '/ace?run=live#view=latest')
  })

  it('exchanges the token using a credentialed same-origin request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await exchangeAccessToken('session-bootstrap-token')

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'session-bootstrap-token' }),
    })
  })

  it('turns a protected API 401 into the global lock event', async () => {
    const eventTarget = new EventTarget()
    const locked = vi.fn()
    eventTarget.addEventListener(AUTH_REQUIRED_EVENT, locked)
    vi.stubGlobal('window', {
      Event,
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'authentication required' }), { status: 401 }),
        ),
    )

    await expect(apiGet('/api/meta')).rejects.toMatchObject({ status: 401 })
    expect(locked).toHaveBeenCalledOnce()
  })
})
