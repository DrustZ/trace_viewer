import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function accessTokenRequired(environment = process.env) {
  return environment.TRACE_VIEWER_REQUIRE_ACCESS_TOKEN !== '0'
}

function withinProject(candidate) {
  const relative = path.relative(projectRoot, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function persistentAccessToken() {
  const configured = process.env.TRACE_VIEWER_ACCESS_TOKEN?.trim()
  if (configured) return { token: configured, tokenPath: null }
  const tokenPath = path.resolve(
    process.env.TRACE_VIEWER_ACCESS_TOKEN_FILE ||
      path.join(os.homedir(), '.trace-viewer', 'access-token'),
  )
  if (withinProject(tokenPath)) {
    throw new Error('TRACE_VIEWER_ACCESS_TOKEN_FILE must be outside the served project directory')
  }
  try {
    const existing = readFileSync(tokenPath, 'utf8').trim()
    if (existing.length >= 32) return { token: existing, tokenPath }
    throw new Error(`access-token file is too short: ${tokenPath}`)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') throw error
  }
  mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 })
  const generated = randomBytes(32).toString('base64url')
  try {
    writeFileSync(tokenPath, `${generated}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return { token: generated, tokenPath }
  } catch (error) {
    // Two service starts can race. The process that lost the exclusive create
    // uses the winner's complete token instead of replacing it.
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      const existing = readFileSync(tokenPath, 'utf8').trim()
      if (existing.length >= 32) return { token: existing, tokenPath }
    }
    throw error
  }
}

export function resolveTailscaleIdentity(status, configuredAddress) {
  const selfAddresses = Array.isArray(status?.Self?.TailscaleIPs)
    ? status.Self.TailscaleIPs.filter((value) => typeof value === 'string')
    : []
  const selfIpv4Addresses = selfAddresses.filter((value) => isIP(value) === 4)
  const configured = typeof configuredAddress === 'string' ? configuredAddress.trim() : ''

  if (configured && (configured === '0.0.0.0' || isIP(configured) !== 4)) {
    throw new Error(
      `TRACE_VIEWER_TAILSCALE_IP must be a specific Tailscale IPv4 address: ${configured}`,
    )
  }
  if (configured && !selfIpv4Addresses.includes(configured)) {
    throw new Error(
      `TRACE_VIEWER_TAILSCALE_IP is not assigned to this Tailscale node: ${configured}`,
    )
  }

  const address = configured || selfIpv4Addresses[0] || ''
  if (!address) throw new Error('No usable Tailscale IPv4 address: none')
  const dnsName = String(status.Self?.DNSName || '')
    .trim()
    .replace(/\.$/, '')
  return { address, dnsName }
}

function tailscaleIdentity() {
  const tailscale = process.env.TAILSCALE_BIN || '/usr/local/bin/tailscale'
  const status = JSON.parse(execFileSync(tailscale, ['status', '--json'], { encoding: 'utf8' }))
  return resolveTailscaleIdentity(status, process.env.TRACE_VIEWER_TAILSCALE_IP)
}

export function apiEnvironmentFor(environment, accessToken) {
  const apiEnvironment = {
    ...environment,
    HOST: '127.0.0.1',
    PORT: '8787',
  }
  delete apiEnvironment.TRACE_VIEWER_ACCESS_TOKEN
  delete apiEnvironment.TRACE_VIEWER_ACCESS_TOKEN_FILE
  if (accessToken) apiEnvironment.TRACE_VIEWER_ACCESS_TOKEN = accessToken
  return apiEnvironment
}

function main() {
  const { address, dnsName } = tailscaleIdentity()
  const access = accessTokenRequired()
    ? persistentAccessToken()
    : { token: undefined, tokenPath: null }
  const webEnvironment = {
    ...process.env,
    ...(dnsName ? { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: dnsName } : {}),
  }
  delete webEnvironment.TRACE_VIEWER_ACCESS_TOKEN
  delete webEnvironment.TRACE_VIEWER_ACCESS_TOKEN_FILE
  const apiEnvironment = apiEnvironmentFor(process.env, access.token)
  const children = [
    spawn(process.execPath, ['./node_modules/tsx/dist/cli.mjs', 'watch', 'server/index.ts'], {
      cwd: projectRoot,
      env: apiEnvironment,
      stdio: 'inherit',
    }),
    spawn(
      process.execPath,
      ['./node_modules/vite/bin/vite.js', '--host', address, '--port', '5173', '--strictPort'],
      { cwd: projectRoot, env: webEnvironment, stdio: 'inherit' },
    ),
  ]

  console.log(`[tailscale] Trace Viewer available at http://${address}:5173/`)
  if (dnsName) console.log(`[tailscale] Stable URL: http://${dnsName}:5173/`)
  console.log(
    access.token
      ? access.tokenPath
        ? '[tailscale] API access protection enabled; token stored outside the served project root'
        : '[tailscale] API access protection enabled; token supplied by environment'
      : '[tailscale] Access-token gate disabled; access is restricted by the Tailnet binding',
  )

  let stopping = false
  function stop(signal = 'SIGTERM', exitCode = 0) {
    if (stopping) return
    stopping = true
    for (const child of children) {
      if (!child.killed) child.kill(signal)
    }
    setTimeout(() => process.exit(exitCode), 1_000).unref()
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => stop(signal))
  }

  for (const child of children) {
    child.once('error', (error) => {
      console.error('[tailscale] child process failed:', error)
      stop('SIGTERM', 1)
    })
    child.once('exit', (code, signal) => {
      if (stopping) return
      console.error(`[tailscale] child exited (${signal ?? code ?? 'unknown'}); restarting service`)
      stop('SIGTERM', code || 1)
    })
  }
}

const directEntry = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (directEntry === fileURLToPath(import.meta.url)) main()
