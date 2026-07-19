import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'

describe('app', () => {
  it('serves health', async () => {
    const res = await request(createApp({ version: 'test' })).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, version: 'test' })
  })
})
