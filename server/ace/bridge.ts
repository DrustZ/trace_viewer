import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { aceChildEnvironment } from './childEnvironment'

/** Current ACE package entry point. Keep the module and source-path probe together. */
export const ACE_BRIDGE_MODULE = 'ace.experiments.cockpit_bridge'
export const ACE_BRIDGE_SOURCE_PARTS = ['src', 'ace', 'experiments', 'cockpit_bridge.py'] as const

export function aceBridgeSourcePath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ...ACE_BRIDGE_SOURCE_PARTS)
}

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
        : code === 'immutable_target_exists' ||
            code === 'exact_config_mismatch' ||
            code === 'run_already_active' ||
            code === 'control_conflict'
          ? 409
          : code === 'missing_credentials' || code === 'capability_unavailable'
            ? 422
            : code === 'runtime_error' ||
                code === 'bridge_unavailable' ||
                code === 'invalid_bridge_response' ||
                code === 'bridge_timeout' ||
                code === 'bridge_output_limit' ||
                code === 'start_timeout'
              ? 502
              : 400
  }
}

export interface AceBridgeConfig {
  projectRoot: string
  python?: string
  /** Test override; production waits up to 30 seconds for the durable manifest commit point. */
  startReadyTimeoutMs?: number
}

interface ActiveRun {
  child: ChildProcessWithoutNullStreams
  startedAt: string
  completion: Promise<unknown>
}

const OUTPUT_LIMIT = 64 * 1024 * 1024
const STDERR_LIMIT = 2 * 1024 * 1024
const START_READY_PREFIX = 'ACE_COCKPIT_READY '
const DEFAULT_START_READY_TIMEOUT_MS = 30_000
const START_TERMINATE_GRACE_MS = 250

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
  private readonly startReadyTimeoutMs: number

  constructor(config: AceBridgeConfig) {
    this.projectRoot = path.resolve(config.projectRoot)
    this.python = path.resolve(
      config.python ?? path.join(this.projectRoot, '.venv', 'bin', 'python'),
    )
    this.startReadyTimeoutMs = config.startReadyTimeoutMs ?? DEFAULT_START_READY_TIMEOUT_MS
  }

  private launch<T>(
    command: AceBridgeCommand,
    params: Record<string, unknown>,
    timeoutMs: number,
    stderrRedactions: readonly string[] = [],
  ): { child: ChildProcessWithoutNullStreams; completion: Promise<T> } {
    const child = spawn(this.python, ['-m', ACE_BRIDGE_MODULE, command], {
      cwd: this.projectRoot,
      env: aceChildEnvironment(),
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
            const safeStderr = stderrRedactions.reduce(
              (text, secret) => text.replaceAll(secret, '[redacted]'),
              stderr,
            )
            error.message = `${error.message} (${safeStderr.trim().slice(-500)})`
          }
          reject(error)
        }
      })
    })
    // A bridge that exits before reading stdin (missing venv, import error)
    // makes this write EPIPE; without a handler that is an uncaught 'error'
    // event that crashes the whole server. The failure itself is already
    // reported through the child's error/close path above.
    child.stdin.on('error', () => {})
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

  private waitForReady(
    launched: { child: ChildProcessWithoutNullStreams; completion: Promise<unknown> },
    runId: string,
    launchToken: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let buffer = ''
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        launched.child.stderr.off('data', onData)
        if (error === undefined) resolve()
        else reject(error)
      }
      const onData = (chunk: string) => {
        buffer += chunk
        if (buffer.length > STDERR_LIMIT) {
          launched.child.kill('SIGTERM')
          finish(
            new AceBridgeError('bridge_output_limit', 'ACE bridge READY output exceeded 2 MiB'),
          )
          return
        }
        while (true) {
          const newline = buffer.indexOf('\n')
          if (newline < 0) break
          const line = buffer.slice(0, newline).trimEnd()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith(START_READY_PREFIX)) continue
          let marker: unknown
          try {
            marker = JSON.parse(line.slice(START_READY_PREFIX.length))
          } catch {
            finish(
              new AceBridgeError('invalid_bridge_response', 'ACE bridge READY marker is invalid'),
            )
            return
          }
          if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) {
            finish(
              new AceBridgeError('invalid_bridge_response', 'ACE bridge READY marker is invalid'),
            )
            return
          }
          const ready = marker as Record<string, unknown>
          // A line from another launch must never satisfy this request.
          if (ready.launchToken !== launchToken) continue
          if (ready.schemaVersion !== 1 || ready.runId !== runId) {
            finish(
              new AceBridgeError('invalid_bridge_response', 'ACE bridge READY identity mismatch'),
            )
            return
          }
          finish()
          return
        }
      }
      launched.child.stderr.on('data', onData)
      const timer = setTimeout(() => {
        launched.child.kill('SIGTERM')
        finish(new AceBridgeError('start_timeout', 'ACE run did not reach its durable READY state'))
      }, this.startReadyTimeoutMs)
      void launched.completion.then(
        () =>
          finish(
            new AceBridgeError(
              'invalid_bridge_response',
              'ACE bridge exited before its durable READY marker',
            ),
          ),
        (error: unknown) => finish(error),
      )
    })
  }

  private terminateBeforeReady(child: ChildProcessWithoutNullStreams): void {
    child.kill('SIGTERM')
    if (child.exitCode !== null || child.signalCode !== null) return
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, START_TERMINATE_GRACE_MS)
    force.unref()
    child.once('close', () => clearTimeout(force))
  }

  async start(
    runId: string,
    params: Record<string, unknown>,
  ): Promise<{ runId: string; startedAt: string }> {
    if (this.activeRuns.has(runId)) {
      throw new AceBridgeError('run_already_active', `ACE run is already active: ${runId}`)
    }
    const startedAt = new Date().toISOString()
    const launchToken = randomBytes(32).toString('hex')
    const launched = this.launch<unknown>(
      'start',
      { ...params, runId, launchToken },
      24 * 60 * 60 * 1000,
      [launchToken],
    )
    const active: ActiveRun = { child: launched.child, startedAt, completion: launched.completion }
    this.activeRuns.set(runId, active)
    let readyAccepted = false
    void launched.completion.then(
      () => {
        if (this.activeRuns.get(runId) === active) this.activeRuns.delete(runId)
      },
      (error: unknown) => {
        if (readyAccepted) {
          console.error(
            `[ace bridge] run ${runId} failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        if (this.activeRuns.get(runId) === active) this.activeRuns.delete(runId)
      },
    )
    try {
      await this.waitForReady(launched, runId, launchToken)
      readyAccepted = true
    } catch (error) {
      // Keep the failed launch registered until the process actually exits.
      // Otherwise an uncooperative pre-READY child and an immediate retry can
      // race for the same run id. SIGKILL bounds that quarantine.
      this.terminateBeforeReady(launched.child)
      throw error
    }
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
