import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionDigest,
  timingSafeStringEqual,
} from './auth'
import { TraceStore } from './store/traceStore'

function app(accessToken: string | null) {
  return createApp({ store: new TraceStore(), dataRoots: [], accessToken })
}

describe('Trace Viewer access-token sessions', () => {
  it('preserves unauthenticated local behavior when no token is configured', async () => {
    expect((await request(app(null)).get('/api/meta')).status).toBe(200)
    expect((await request(app(null)).post('/api/auth/session').send({})).body).toEqual({
      ok: true,
      authRequired: false,
    })
  })

  it('keeps only GET health and POST session public when protection is enabled', async () => {
    const protectedApp = app('correct horse battery staple')

    expect((await request(protectedApp).get('/api/health')).status).toBe(200)
    expect((await request(protectedApp).get('/api/meta')).status).toBe(401)
    expect((await request(protectedApp).get('/api/events')).status).toBe(401)
    expect((await request(protectedApp).post('/api/import').send({})).status).toBe(401)
    expect((await request(protectedApp).get('/api/auth/session')).status).toBe(401)
    expect((await request(protectedApp).post('/api/health')).status).toBe(401)
    expect((await request(protectedApp).head('/api/health')).status).toBe(401)
    expect((await request(protectedApp).get('/api/not-a-route')).status).toBe(401)
  })

  it('rejects invalid tokens without setting a cookie', async () => {
    const response = await request(app('expected-token'))
      .post('/api/auth/session')
      .send({ token: 'wrong-token' })

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: 'invalid access token',
      code: 'INVALID_ACCESS_TOKEN',
    })
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('exchanges a valid token for a scoped, derived 30-day cookie', async () => {
    const accessToken = 'do-not-copy-me-to-the-cookie'
    const protectedApp = app(accessToken)
    const response = await request(protectedApp)
      .post('/api/auth/session')
      .send({ token: accessToken })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      ok: true,
      authRequired: true,
      expiresInSeconds: SESSION_MAX_AGE_SECONDS,
    })
    const setCookie = response.headers['set-cookie']?.[0] ?? ''
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=${sessionDigest(accessToken)}`)
    expect(setCookie).not.toContain(accessToken)
    expect(setCookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`)
    expect(setCookie).toContain('Path=/api')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(response.headers['cache-control']).toBe('no-store')

    const cookie = setCookie.split(';', 1)[0]
    const authenticated = await request(protectedApp).get('/api/meta').set('Cookie', cookie)
    expect(authenticated.status).toBe(200)

    const forged = await request(protectedApp)
      .get('/api/meta')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${accessToken}`)
    expect(forged.status).toBe(401)
  })

  it('uses length-independent timing-safe comparisons', () => {
    expect(timingSafeStringEqual('same', 'same')).toBe(true)
    expect(timingSafeStringEqual('same', 'different-and-longer')).toBe(false)
  })

  it('marks the session Secure when a trusted TLS proxy forwards HTTPS', async () => {
    const response = await request(app('tls-token'))
      .post('/api/auth/session')
      .set('X-Forwarded-Proto', 'https')
      .send({ token: 'tls-token' })

    expect(response.headers['set-cookie']?.[0]).toContain('Secure')
  })
})
