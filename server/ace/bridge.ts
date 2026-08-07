import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import path from 'node:path'

export type AceBridgeCommand =
  | 'start'
  | 'control'
  | 'checkpoints'
  | 'replay'
  | 'fork'
  | 'historical-replay'
  | 'save-regression'
  | 'analyze'
  | 'capabilities'

interface BridgeSuccess<T> {
  schemaVersion: 1
  ok: true
  result: T
}

interface BridgeFailure {
  schemaVersion: 1
  ok: false
  error: { code: string; message: string; details?: unknown }
}

export class AceBridgeError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AceBridgeError'
    this.code = code
    this.details = details
    this.status =
      code === 'not_found'
        ? 404
        : code === 'immutable_target_exists' || code === 'exact_config_mismatch'
          ? 409
          : code === 'missing_credentials' || code === 'capability_unavailable'
            ? 422
            : code === 'runtime_error'
              ? 502
              : 400
  }
}

export interface AceBridgeConfig {
  projectRoot: string
  python?: string
}

interface ActiveRun {
  child: ChildProcessWithoutNullStreams
  startedAt: string
  completion: Promise<unknown>
}

const OUTPUT_LIMIT = 64 * 1024 * 1024
const STDERR_LIMIT = 2 * 1024 * 1024

function parseEnvelope<T>(stdout: string): T {
  let envelope: BridgeSuccess<T> | BridgeFailure
  try {
    envelope = JSON.parse(stdout) as BridgeSuccess<T> | BridgeFailure
  } catch {
    throw new AceBridgeError('invalid_bridge_response', 'ACE bridge returned invalid JSON')
  }
  if (envelope.schemaVersion !== 1 || typeof envelope.ok !== 'boolean') {
    throw new AceBridgeError(
      'invalid_bridge_response',
      'ACE bridge returned an unsupported envelope',
    )
  }
  if (!envelope.ok) {
    throw new AceBridgeError(envelope.error.code, envelope.error.message, envelope.error.details)
  }
  return envelope.result
}

export class AceBridgeClient {
  readonly projectRoot: string
  readonly python: string
  private activeRuns = new Map<string, ActiveRun>()

  constructor(config: AceBridgeConfig) {
    this.projectRoot = path.resolve(config.projectRoot)
    this.python = path.resolve(
      config.python ?? path.join(this.projectRoot, '.venv', 'bin', 'python'),
    )
  }

  private launch<T>(
    command: AceBridgeCommand,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): { child: ChildProcessWithoutNullStreams; completion: Promise<T> } {
    const child = spawn(this.python, ['-m', 'ace.cockpit_bridge', command], {
      cwd: this.projectRoot,
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let outputExceeded = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + chunk.length > OUTPUT_LIMIT) {
        outputExceeded = true
        child.kill('SIGTERM')
        return
      }
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_LIMIT)
    })
    const completion = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new AceBridgeError('bridge_timeout', `ACE bridge ${command} timed out`))
      }, timeoutMs)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(new AceBridgeError('bridge_unavailable', error.message))
      })
      child.once('close', (_code) => {
        clearTimeout(timer)
        if (outputExceeded) {
          reject(new AceBridgeError('bridge_output_limit', 'ACE bridge output exceeded 64 MiB'))
          return
        }
        try {
          resolve(parseEnvelope<T>(stdout.trim()))
        } catch (error) {
          if (error instanceof AceBridgeError && stderr.trim() !== '') {
            error.message = `${error.message} (${stderr.trim().slice(-500)})`
          }
          reject(error)
        }
      })
    })
    child.stdin.end(JSON.stringify(params))
    return { child, completion }
  }

  call<T>(
    command: Exclude<AceBridgeCommand, 'start'>,
    params: Record<string, unknown>,
    timeoutMs = 120_000,
  ): Promise<T> {
    return this.launch<T>(command, params, timeoutMs).completion
  }

  start(runId: string, params: Record<string, unknown>): { runId: string; startedAt: string } {
    if (this.activeRuns.has(runId)) {
      throw new AceBridgeError('run_already_active', `ACE run is already active: ${runId}`)
    }
    const startedAt = new Date().toISOString()
    const launched = this.launch<unknown>('start', params, 24 * 60 * 60 * 1000)
    const active: ActiveRun = { child: launched.child, startedAt, completion: launched.completion }
    this.activeRuns.set(runId, active)
    void launched.completion
      .catch((error: unknown) => {
        console.error(
          `[ace bridge] run ${runId} failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
      .finally(() => {
        if (this.activeRuns.get(runId) === active) this.activeRuns.delete(runId)
      })
    return { runId, startedAt }
  }

  active(runId: string): { pid: number | undefined; startedAt: string } | null {
    const run = this.activeRuns.get(runId)
    return run ? { pid: run.child.pid, startedAt: run.startedAt } : null
  }

  activeRunIds(): string[] {
    return [...this.activeRuns.keys()].sort()
  }
}
