import { describe, expect, it } from 'vitest'
// @ts-expect-error The directly executable launcher intentionally remains native ESM JavaScript.
import * as launcher from '../../scripts/serveTailscale.mjs'

const { accessTokenRequired, apiEnvironmentFor, resolveTailscaleIdentity } = launcher

const status = {
  Self: {
    TailscaleIPs: ['100.79.194.120', 'fd7a:115c:a1e0::1239:c279'],
    DNSName: 'viewer.example.ts.net.',
  },
}

describe('Tailnet service boundary', () => {
  it('uses only the current node Tailscale IPv4 and normalizes MagicDNS', () => {
    expect(resolveTailscaleIdentity(status)).toEqual({
      address: '100.79.194.120',
      dnsName: 'viewer.example.ts.net',
    })
    expect(resolveTailscaleIdentity(status, '100.79.194.120')).toEqual({
      address: '100.79.194.120',
      dnsName: 'viewer.example.ts.net',
    })
  })

  it.each(['0.0.0.0', '192.168.1.20', '100.79.194.121', '127.0.0.1'])(
    'rejects a wildcard, LAN, loopback, or non-Self override: %s',
    (address) => {
      expect(() => resolveTailscaleIdentity(status, address)).toThrow(
        /specific Tailscale IPv4|not assigned to this Tailscale node/,
      )
    },
  )

  it('rejects missing or IPv6-only Self identity', () => {
    expect(() => resolveTailscaleIdentity({ Self: { TailscaleIPs: [] } })).toThrow(
      'No usable Tailscale IPv4 address',
    )
    expect(() => resolveTailscaleIdentity(status, 'fd7a:115c:a1e0::1239:c279')).toThrow(
      'must be a specific Tailscale IPv4 address',
    )
  })

  it('keeps the API on loopback regardless of inherited host and token settings', () => {
    const inherited = {
      HOST: '0.0.0.0',
      PORT: '9999',
      TRACE_VIEWER_ACCESS_TOKEN: 'inherited-secret',
      TRACE_VIEWER_ACCESS_TOKEN_FILE: '/tmp/inherited-token',
    }

    expect(apiEnvironmentFor(inherited)).toEqual({ HOST: '127.0.0.1', PORT: '8787' })
    expect(apiEnvironmentFor(inherited, 'explicit-secret')).toEqual({
      HOST: '127.0.0.1',
      PORT: '8787',
      TRACE_VIEWER_ACCESS_TOKEN: 'explicit-secret',
    })
  })

  it('keeps the access-token gate enabled by default and permits only the explicit opt-out', () => {
    expect(accessTokenRequired({})).toBe(true)
    expect(accessTokenRequired({ TRACE_VIEWER_REQUIRE_ACCESS_TOKEN: '1' })).toBe(true)
    expect(accessTokenRequired({ TRACE_VIEWER_REQUIRE_ACCESS_TOKEN: '0' })).toBe(false)
  })
})
