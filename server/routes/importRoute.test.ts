import { createServer } from 'node:http'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import { TraceStore } from '../store/traceStore'
import {
  assertUrlAllowed,
  fetchText,
  isPublicIpAddress,
  type PinnedUrlFetcher,
  type UrlResolver,
} from './importRoute'

function stream(text: string): ReadableStream<Uint8Array> | null {
  return new Response(text).body
}

describe('URL import address classification', () => {
  it.each([
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.9',
    '192.0.2.1',
    '192.31.196.1',
    '192.52.193.1',
    '192.88.99.1',
    '192.168.1.1',
    '192.175.48.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ])('rejects non-public/special IPv4 %s', (address) => {
    expect(isPublicIpAddress(address, 4)).toBe(false)
  })

  it.each([
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::808:808',
    '64:ff9b:1::1',
    '100::1',
    '100:0:0:1::1',
    '2001::1',
    '2001:1::1',
    '2001:db8::1',
    '2002::1',
    '2620:4f:8000::1',
    '3fff::1',
    '5f00::1',
    'fc00::1',
    'fdff::1',
    'fe80::1',
    'fe9f::1',
    'fea0::1',
    'febf::1',
    'fec0::1',
    'ff02::1',
  ])('rejects non-public/special IPv6 %s', (address) => {
    expect(isPublicIpAddress(address, 6)).toBe(false)
  })

  it.each([
    ['1.1.1.1', 4],
    ['8.8.8.8', 4],
    ['100.63.255.255', 4],
    ['100.128.0.1', 4],
    ['2001:4860:4860::8888', 6],
    ['2606:4700:4700::1111', 6],
  ] as const)('allows ordinary public unicast %s', (address, family) => {
    expect(isPublicIpAddress(address, family)).toBe(true)
  })

  it('fails closed on malformed addresses and family mismatches', () => {
    expect(isPublicIpAddress('999.1.1.1', 4)).toBe(false)
    expect(isPublicIpAddress('1.1.1.1', 6)).toBe(false)
    expect(isPublicIpAddress('fe80::1%lo0', 6)).toBe(false)
  })
})

describe('URL import network boundary', () => {
  afterEach(() => {
    delete process.env.ALLOW_PRIVATE_URLS
  })

  it('rejects a mixed public/private DNS answer before connecting', async () => {
    const resolver = vi.fn<UrlResolver>(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '100.64.0.8', family: 4 },
    ])

    await expect(
      assertUrlAllowed(new URL('https://example.com/trace.json'), { resolver }),
    ).rejects.toThrow('non-public or special-purpose address')
  })

  it('pins the HTTP request to the exact validated DNS result', async () => {
    const resolver = vi.fn<UrlResolver>(async () => [{ address: '93.184.216.34', family: 4 }])
    const fetcher: PinnedUrlFetcher = vi.fn(async (_url, target) => {
      expect(target).toEqual({ address: '93.184.216.34', family: 4 })
      return { status: 200, headers: new Headers(), body: stream('pinned response') }
    })

    await expect(
      fetchText(new URL('https://example.com/trace.json'), { resolver, fetcher }),
    ).resolves.toBe('pinned response')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('revalidates every redirect and refuses a public-to-loopback hop', async () => {
    const resolver = vi.fn<UrlResolver>(async (hostname) =>
      hostname === 'example.com'
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }],
    )
    const fetcher: PinnedUrlFetcher = vi.fn(async () => ({
      status: 302,
      headers: new Headers({ location: 'http://127.0.0.1/private-trace.json' }),
      body: stream('redirect'),
    }))

    await expect(
      fetchText(new URL('https://example.com/trace.json'), { resolver, fetcher }),
    ).rejects.toThrow('non-public or special-purpose address')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('rejects URL credentials before resolving or connecting', async () => {
    const resolver = vi.fn<UrlResolver>(async () => [{ address: '93.184.216.34', family: 4 }])
    await expect(
      assertUrlAllowed(new URL('https://user:secret@example.com/trace.json'), { resolver }),
    ).rejects.toThrow('URL credentials are not allowed')
    expect(resolver).not.toHaveBeenCalled()
  })

  it('keeps the explicit local private-address escape hatch pinned', async () => {
    const resolver = vi.fn<UrlResolver>(async () => [{ address: '127.0.0.1', family: 4 }])
    const target = await assertUrlAllowed(new URL('http://localhost/trace.json'), {
      resolver,
      allowPrivate: true,
    })
    expect(target).toEqual({ address: '127.0.0.1', family: 4 })
  })

  it('uses the pinned native requester in local mode', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/plain')
      response.end('native pinned response')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('test server did not bind')
      await expect(
        fetchText(new URL(`http://127.0.0.1:${address.port}/trace.json`), {
          allowPrivate: true,
        }),
      ).resolves.toBe('native pinned response')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
})

describe('shared-server URL import policy', () => {
  it('returns a clear 403 before any URL resolution on an access-token server', async () => {
    const accessToken = 'shared-server-test-token'
    const app = createApp({ store: new TraceStore(), dataRoots: [], accessToken })
    const session = await request(app)
      .post('/api/auth/session')
      .send({ token: accessToken })
      .expect(200)
    const cookie = (session.headers['set-cookie']?.[0] ?? '').split(';', 1)[0]

    const response = await request(app)
      .post('/api/import')
      .set('Cookie', cookie)
      .send({ type: 'url', url: 'https://does-not-need-to-resolve.invalid/trace.json' })

    expect(response.status).toBe(403)
    expect(response.body).toEqual({
      error:
        'URL import is disabled on access-token/shared servers. Download the trace and use File or Paste instead.',
      code: 'URL_IMPORT_DISABLED_SHARED_SERVER',
    })
  })

  it('does not disable paste/file payloads on an access-token server', async () => {
    const accessToken = 'shared-server-test-token'
    const app = createApp({ store: new TraceStore(), dataRoots: [], accessToken })
    const session = await request(app)
      .post('/api/auth/session')
      .send({ token: accessToken })
      .expect(200)
    const cookie = (session.headers['set-cookie']?.[0] ?? '').split(';', 1)[0]

    const response = await request(app)
      .post('/api/import')
      .set('Cookie', cookie)
      .send({ type: 'text', content: '{}' })

    expect(response.status).toBe(422)
    expect(response.body.error).toBe('no traces could be parsed')
  })
})
