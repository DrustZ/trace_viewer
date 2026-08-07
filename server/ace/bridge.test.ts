import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ACE_BRIDGE_MODULE, AceBridgeClient, aceBridgeSourcePath } from './bridge'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  )
})

async function fakeBridge(body: string): Promise<{ projectRoot: string; executable: string }> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-viewer-bridge-'))
  temporaryDirectories.push(projectRoot)
  const executable = path.join(projectRoot, 'fake-python')
  await fs.writeFile(
    executable,
    `#!${process.execPath}\nlet input = ''\nprocess.stdin.setEncoding('utf8')\nprocess.stdin.on('data', chunk => { input += chunk })\nprocess.stdin.on('end', () => {\n  const params = JSON.parse(input)\n${body}\n})\n`,
  )
  await fs.chmod(executable, 0o755)
  return { projectRoot, executable }
}

describe('ACE bridge package location', () => {
  it('tracks the current ACE experiments package after the domain migration', () => {
    expect(ACE_BRIDGE_MODULE).toBe('ace.experiments.cockpit_bridge')
    expect(aceBridgeSourcePath('/workspace/ac_express')).toBe(
      path.join('/workspace/ac_express', 'src', 'ace', 'experiments', 'cockpit_bridge.py'),
    )
  })
})

describe('ACE bridge durable start handshake', () => {
  it('does not accept a run until the child reports the trace-bound READY identity', async () => {
    const fixture = await fakeBridge(`
  process.stderr.write('ACE_COCKPIT_READY ' + JSON.stringify({
    schemaVersion: 1,
    launchToken: params.launchToken,
    runId: params.runId,
  }) + '\\n')
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, result: { done: true } }))
  }, 150)
`)
    const client = new AceBridgeClient({
      projectRoot: fixture.projectRoot,
      python: fixture.executable,
      startReadyTimeoutMs: 1_000,
    })

    await expect(client.start('ready-run', {})).resolves.toMatchObject({ runId: 'ready-run' })
    expect(client.active('ready-run')).not.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(client.active('ready-run')).toBeNull()
  })

  it('surfaces executable and bridge-envelope failures before returning 202', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-viewer-missing-'))
    temporaryDirectories.push(directory)
    const missing = new AceBridgeClient({
      projectRoot: directory,
      python: path.join(directory, 'missing-python'),
      startReadyTimeoutMs: 100,
    })
    await expect(missing.start('missing-run', {})).rejects.toMatchObject({
      code: 'bridge_unavailable',
      status: 502,
    })
    expect(missing.active('missing-run')).toBeNull()

    const fixture = await fakeBridge(`
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    ok: false,
    error: { code: 'missing_credentials', message: 'fixture credentials are missing' },
  }))
`)
    const rejected = new AceBridgeClient({
      projectRoot: fixture.projectRoot,
      python: fixture.executable,
      startReadyTimeoutMs: 1_000,
    })
    await expect(rejected.start('rejected-run', {})).rejects.toMatchObject({
      code: 'missing_credentials',
      status: 422,
    })
    expect(rejected.active('rejected-run')).toBeNull()
  })

  it('ignores another launch token and fails when the child exits without our READY marker', async () => {
    const fixture = await fakeBridge(`
  process.stderr.write('ACE_COCKPIT_READY ' + JSON.stringify({
    schemaVersion: 1,
    launchToken: '0'.repeat(64),
    runId: params.runId,
  }) + '\\n')
  process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, result: { done: true } }))
`)
    const client = new AceBridgeClient({
      projectRoot: fixture.projectRoot,
      python: fixture.executable,
      startReadyTimeoutMs: 1_000,
    })

    await expect(client.start('wrong-token-run', {})).rejects.toMatchObject({
      code: 'invalid_bridge_response',
      status: 502,
    })
    expect(client.active('wrong-token-run')).toBeNull()
  })

  it('kills and clears a child that never reaches READY', async () => {
    const fixture = await fakeBridge(`
  process.on('SIGTERM', () => {})
  setInterval(() => {}, 10_000)
`)
    const client = new AceBridgeClient({
      projectRoot: fixture.projectRoot,
      python: fixture.executable,
      startReadyTimeoutMs: 25,
    })

    await expect(client.start('timeout-run', {})).rejects.toMatchObject({
      code: 'start_timeout',
      status: 502,
    })
    await expect(client.start('timeout-run', {})).rejects.toMatchObject({
      code: 'run_already_active',
      status: 409,
    })
    await expect.poll(() => client.active('timeout-run'), { timeout: 1_000 }).toBeNull()
  })
})
