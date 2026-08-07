import { promises as dns } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { Router } from 'express'
import { parseAny } from '../../shared/connectors/registry'
import type { ImportResponse } from '../../shared/schema/api'
import { asyncHandler, isRecord, type RouteCtx } from './context'

const FETCH_TIMEOUT_MS = 15000
const MAX_BYTES = 25 * 1024 * 1024
const MAX_REDIRECTS = 5

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

type IpFamily = 4 | 6

export interface ResolvedUrlAddress {
  address: string
  family: IpFamily
}

export type UrlResolver = (hostname: string) => Promise<ResolvedUrlAddress[]>

interface IpRange {
  network: bigint
  prefix: number
}

function parseIpv4(address: string): bigint | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet < 0 || octet > 255) return null
    value = (value << 8n) | BigInt(octet)
  }
  return value
}

function parseIpv6Half(value: string): { groups: number[]; ipv4Tail: boolean } | null {
  if (value === '') return { groups: [], ipv4Tail: false }
  const tokens = value.split(':')
  const groups: number[] = []
  let ipv4Tail = false
  for (const [index, token] of tokens.entries()) {
    if (token === '') return null
    if (token.includes('.')) {
      if (index !== tokens.length - 1 || ipv4Tail) return null
      const ipv4 = parseIpv4(token)
      if (ipv4 === null) return null
      groups.push(Number((ipv4 >> 16n) & 0xffffn), Number(ipv4 & 0xffffn))
      ipv4Tail = true
      continue
    }
    if (!/^[0-9a-f]{1,4}$/i.test(token)) return null
    groups.push(Number.parseInt(token, 16))
  }
  return { groups, ipv4Tail }
}

function parseIpv6(address: string): bigint | null {
  if (address.includes('%')) return null
  const halves = address.split('::')
  if (halves.length > 2) return null
  const left = parseIpv6Half(halves[0] ?? '')
  const right = parseIpv6Half(halves[1] ?? '')
  if (!left || !right || (left.ipv4Tail && halves.length === 2)) return null
  const count = left.groups.length + right.groups.length
  const compressed = halves.length === 2
  if ((!compressed && count !== 8) || (compressed && count >= 8)) return null
  const groups = [...left.groups, ...Array.from({ length: 8 - count }, () => 0), ...right.groups]
  if (groups.length !== 8) return null
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n)
}

function ipv4Range(cidr: string): IpRange {
  const [address, prefixText] = cidr.split('/')
  const network = parseIpv4(address)
  const prefix = Number(prefixText)
  if (network === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`invalid IPv4 range ${cidr}`)
  }
  return { network, prefix }
}

function ipv6Range(cidr: string): IpRange {
  const [address, prefixText] = cidr.split('/')
  const network = parseIpv6(address)
  const prefix = Number(prefixText)
  if (network === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
    throw new Error(`invalid IPv6 range ${cidr}`)
  }
  return { network, prefix }
}

function inRange(value: bigint, range: IpRange, bits: number): boolean {
  const shift = BigInt(bits - range.prefix)
  return value >> shift === range.network >> shift
}

/**
 * IANA IPv4 Special-Purpose Address Registry plus multicast. Conservatively reject the complete
 * registered blocks, including the few globally reachable anycast services inside them: URL import
 * does not need those exceptional destinations and treating the whole registry as non-public keeps
 * the SSRF boundary reviewable.
 */
const NON_PUBLIC_IPV4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.31.196.0/24',
  '192.52.193.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '192.175.48.0/24',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
].map(ipv4Range)

const CURRENT_PUBLIC_IPV6 = ipv6Range('2000::/3')

/** Current IANA special-purpose allocations which overlap 2000::/3 global unicast. */
const NON_PUBLIC_IPV6_GLOBAL = [
  '2001::/23',
  '2001:db8::/32',
  '2002::/16',
  '2620:4f:8000::/48',
  '3fff::/20',
].map(ipv6Range)

function normalizedIp(address: string): string {
  if (address.startsWith('[') && address.endsWith(']')) return address.slice(1, -1)
  return address
}

/** True only for an ordinary, currently globally-routable unicast address. */
export function isPublicIpAddress(address: string, declaredFamily?: number): boolean {
  const normalized = normalizedIp(address)
  const detectedFamily = isIP(normalized)
  if (
    (detectedFamily !== 4 && detectedFamily !== 6) ||
    (declaredFamily !== undefined && declaredFamily !== detectedFamily)
  ) {
    return false
  }
  if (detectedFamily === 4) {
    const value = parseIpv4(normalized)
    return value !== null && !NON_PUBLIC_IPV4.some((range) => inRange(value, range, 32))
  }
  const value = parseIpv6(normalized)
  return (
    value !== null &&
    inRange(value, CURRENT_PUBLIC_IPV6, 128) &&
    !NON_PUBLIC_IPV6_GLOBAL.some((range) => inRange(value, range, 128))
  )
}

async function resolveHostname(hostname: string): Promise<ResolvedUrlAddress[]> {
  const normalized = normalizedIp(hostname)
  const literalFamily = isIP(normalized)
  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: normalized, family: literalFamily }]
  }
  const results = await dns.lookup(normalized, { all: true, verbatim: true })
  return results.map((result) => ({
    address: result.address,
    family: result.family as IpFamily,
  }))
}

export interface UrlValidationOptions {
  resolver?: UrlResolver
  /** Explicit local-only escape hatch. Shared/access-token servers disable the route before here. */
  allowPrivate?: boolean
}

/** Validate and return the exact address that the following HTTP connection must use. */
export async function assertUrlAllowed(
  url: URL,
  options: UrlValidationOptions = {},
): Promise<ResolvedUrlAddress> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'only http(s) URLs are allowed')
  }
  if (url.username !== '' || url.password !== '') {
    throw new HttpError(400, 'URL credentials are not allowed; use File or Paste instead')
  }
  let results: ResolvedUrlAddress[]
  try {
    results = await (options.resolver ?? resolveHostname)(normalizedIp(url.hostname))
  } catch {
    throw new HttpError(400, `cannot resolve host '${url.hostname}'`)
  }
  if (
    results.length === 0 ||
    results.some(
      (result) =>
        (result.family !== 4 && result.family !== 6) ||
        isIP(normalizedIp(result.address)) !== result.family,
    )
  ) {
    throw new HttpError(400, `host '${url.hostname}' did not resolve to a valid IP address`)
  }
  const allowPrivate = options.allowPrivate ?? process.env.ALLOW_PRIVATE_URLS === '1'
  if (
    !allowPrivate &&
    results.some((result) => !isPublicIpAddress(result.address, result.family))
  ) {
    throw new HttpError(
      400,
      'URL resolves to a non-public or special-purpose address; download it and use File or Paste instead',
    )
  }
  // Every result was validated. Pin the first one so the HTTP stack cannot perform a second DNS
  // lookup and race validation via rebinding.
  return { ...results[0], address: normalizedIp(results[0].address) }
}

export interface UrlHopResponse {
  status: number
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}

export type PinnedUrlFetcher = (
  url: URL,
  target: ResolvedUrlAddress,
  signal: AbortSignal,
) => Promise<UrlHopResponse>

function responseHeaders(headers: http.IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item)
    } else if (value !== undefined) {
      result.set(name, value)
    }
  }
  return result
}

/** Direct request to the already-validated address, preserving the original Host and TLS SNI. */
async function fetchPinnedUrl(
  url: URL,
  target: ResolvedUrlAddress,
  signal: AbortSignal,
): Promise<UrlHopResponse> {
  const originalHostname = normalizedIp(url.hostname)
  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: target.address,
        family: target.family,
        port: url.port || undefined,
        method: 'GET',
        path: `${url.pathname}${url.search}`,
        headers: {
          Accept: 'application/json, application/x-ndjson, text/plain;q=0.9, */*;q=0.1',
          'Accept-Encoding': 'identity',
          Host: url.host,
          'User-Agent': 'trace-viewer-url-import/1',
        },
        signal,
        ...(url.protocol === 'https:' && isIP(originalHostname) === 0
          ? { servername: originalHostname }
          : {}),
      },
      (response) => {
        resolve({
          status: response.statusCode ?? 0,
          headers: responseHeaders(response.headers),
          body: Readable.toWeb(response) as ReadableStream<Uint8Array>,
        })
      },
    )
    request.once('error', reject)
    request.end()
  })
}

export interface FetchTextOptions extends UrlValidationOptions {
  fetcher?: PinnedUrlFetcher
}

export async function fetchText(initialUrl: URL, options: FetchTextOptions = {}): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    let url = initialUrl
    let redirects = 0
    let response: UrlHopResponse
    while (true) {
      // Resolve and validate every hop, then connect to that exact result. This closes the
      // lookup-then-fetch DNS-rebinding race as well as public-to-private redirects.
      const target = await assertUrlAllowed(url, options)
      response = await (options.fetcher ?? fetchPinnedUrl)(url, target, controller.signal)
      if (response.status < 300 || response.status >= 400) break
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (!location) throw new HttpError(400, 'redirect response is missing Location')
      redirects += 1
      if (redirects > MAX_REDIRECTS) {
        throw new HttpError(400, `too many redirects (maximum ${MAX_REDIRECTS})`)
      }
      url = new URL(location, url)
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined)
      throw new HttpError(400, `fetch failed: HTTP ${response.status}`)
    }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined)
      throw new HttpError(400, 'response exceeds the 25MB limit')
    }
    if (!response.body) return ''
    const reader = response.body.getReader()
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
  } catch (error) {
    if (error instanceof HttpError) throw error
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s`
        : error instanceof Error
          ? error.message
          : String(error)
    throw new HttpError(400, `fetch failed: ${message}`)
  } finally {
    clearTimeout(timer)
  }
}

export interface ImportRouteOptions {
  /** False on any access-token/shared server. URL fetches remain a localhost-only capability. */
  urlImportEnabled?: boolean
}

export function importRoutes(ctx: RouteCtx, options: ImportRouteOptions = {}): Router {
  const router = Router()

  router.post(
    '/api/import',
    asyncHandler(async (req, res) => {
      const body: unknown = req.body
      if (!isRecord(body) || (body.type !== 'text' && body.type !== 'url')) {
        res.status(400).json({ error: "type must be 'text' or 'url'" })
        return
      }
      if (body.type === 'url' && options.urlImportEnabled === false) {
        res.status(403).json({
          error:
            'URL import is disabled on access-token/shared servers. Download the trace and use File or Paste instead.',
          code: 'URL_IMPORT_DISABLED_SHARED_SERVER',
        })
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
          text = await fetchText(url)
          source = url.toString()
        } else {
          if (typeof body.content !== 'string' || body.content === '') {
            throw new HttpError(400, 'content is required for type "text"')
          }
          text = body.content
          source = 'pasted'
        }
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.status).json({ error: error.message })
          return
        }
        throw error
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

      // Duplicate traceIds *within one batch* are genuinely ambiguous — reject.
      const seen = new Set<string>()
      const duplicates = new Set<string>()
      for (const trace of result.traces) {
        if (seen.has(trace.meta.traceId)) duplicates.add(trace.meta.traceId)
        else seen.add(trace.meta.traceId)
      }
      if (duplicates.size > 0) {
        res.status(409).json({
          error: 'duplicate traceIds within the imported batch',
          duplicates: [...duplicates],
        })
        return
      }

      // Import = load & view: keep it in memory only (no data/imported/ file),
      // and re-importing the same trace just replaces the in-memory copy — so
      // it always "imports and shows" instead of erroring on a duplicate.
      const first = result.traces[0]
      const sourceFormat = first.meta.sourceFormat
      const rawLabel = source === 'pasted' ? 'imported (pasted)' : source
      const imported = result.traces.map((parsed) => {
        parsed.meta.extra = { ...(parsed.meta.extra ?? {}), run: 'imported' }
        // Keep the original text in memory so the Raw view works (no file on disk).
        return ctx.store.upsert(parsed, rawLabel, text)
      })

      res.json({
        traceIds: result.traces.map((trace) => trace.meta.traceId),
        traceUids: imported.map((trace) => trace.meta.traceUid ?? trace.meta.traceId),
        format: sourceFormat,
        warnings: [...result.warnings, ...result.traces.flatMap((trace) => trace.warnings)],
      } satisfies ImportResponse)
    }),
  )

  return router
}
