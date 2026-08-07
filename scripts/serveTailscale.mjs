import { execFileSync, spawn } from 'node:child_process'
import { isIP } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tailscale = process.env.TAILSCALE_BIN || '/usr/local/bin/tailscale'

function tailscaleIdentity() {
  const configured = process.env.TRACE_VIEWER_TAILSCALE_IP?.trim()
  const status = JSON.parse(execFileSync(tailscale, ['status', '--json'], { encoding: 'utf8' }))
  const detected = configured || status.Self?.TailscaleIPs?.find((value) => isIP(value) === 4) || ''
  const address = detected.split(/\s+/)[0]
  if (isIP(address) !== 4) throw new Error(`No usable Tailscale IPv4 address: ${address || 'none'}`)
  const dnsName = String(status.Self?.DNSName || '')
    .trim()
    .replace(/\.$/, '')
  return { address, dnsName }
}

const { address, dnsName } = tailscaleIdentity()
const webEnvironment = {
  ...process.env,
  ...(dnsName ? { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: dnsName } : {}),
}
const children = [
  spawn(process.execPath, ['./node_modules/tsx/dist/cli.mjs', 'watch', 'server/index.ts'], {
    cwd: projectRoot,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '8787' },
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
