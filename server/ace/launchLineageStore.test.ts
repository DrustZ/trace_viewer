import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AceLaunchLineageStore } from './launchLineageStore'

describe('ACE Viewer launch-lineage store', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  })

  it('persists immutable fresh-rerun ancestry and reloads it after restart', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-launch-lineage-'))
    roots.push(root)
    const file = path.join(root, '.trace-viewer', 'lineage.jsonl')
    const lineage = {
      relation: 'fresh_task_rerun' as const,
      parentTraceUid: 'simulation:parent:trace-1',
      parentSourceTraceId: 'trace-1',
      parentRunId: 'parent',
      fidelity: 'scenario_fresh_rerun_state_regenerated',
      stateExact: false,
      configExact: false,
      llmExact: false,
      policyChanged: true,
    }
    const first = new AceLaunchLineageStore(file)
    await first.append('child', lineage)
    await first.append('child', lineage)

    const reloaded = new AceLaunchLineageStore(file)
    expect(await reloaded.get('child')).toEqual(lineage)
    expect((await fs.readFile(file, 'utf8')).trim().split('\n')).toHaveLength(1)
    await expect(reloaded.append('child', { ...lineage, policyChanged: false })).rejects.toThrow(
      'different immutable ancestry',
    )
  })

  it('salvages valid records around a malformed partial line', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-launch-lineage-'))
    roots.push(root)
    const file = path.join(root, 'lineage.jsonl')
    await fs.writeFile(
      file,
      `${JSON.stringify({
        schemaVersion: 1,
        runId: 'valid',
        createdAt: '2026-08-06T00:00:00Z',
        lineage: { relation: 'fresh_task_rerun', parentTraceUid: 'trace-1' },
      })}\n{"partial":`,
    )
    const store = new AceLaunchLineageStore(file)
    expect(await store.get('valid')).toMatchObject({ parentTraceUid: 'trace-1' })
  })
})
