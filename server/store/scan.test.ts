import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getScanProgress, scanAll, scanFile, watch } from './scan'
import { TraceStore } from './traceStore'

const temporaryRoots: string[] = []

async function temporaryRoot(prefix = 'trace-viewer-scan-'): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

function nativeTrace(traceId: string, run?: string): string {
  return JSON.stringify({
    meta: {
      traceId,
      ...(run ? { extra: { run } } : {}),
    },
    messages: [
      { role: 'user', content: 'question with enough content' },
      { role: 'assistant', channel: 'final', content: 'answer with enough content' },
    ],
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true })))
})

describe('trace scanner data roots', () => {
  it('uses an explicit run label for a generic external data directory', async () => {
    const parent = await temporaryRoot()
    const root = path.join(parent, 'data')
    await fs.mkdir(root)
    await fs.writeFile(path.join(root, 'trace.json'), nativeTrace('external-1', 'wrong-run'))
    const store = new TraceStore()

    const result = await scanAll(store, [`work-trial=${root}`])

    expect(result).toMatchObject({ files: 1, traces: 1, warnings: 0 })
    expect(store.getFull('external-1')?.meta.extra?.run).toBe('work-trial')
    expect(getScanProgress().scanRoots[0]).toMatchObject({
      run: 'work-trial',
      mode: 'fixed',
      state: 'ready',
      files: 1,
      scannedFiles: 1,
      traces: 1,
      warnings: 0,
    })
  })

  it('derives an unlabelled direct root from its basename, never imported', async () => {
    const parent = await temporaryRoot()
    const root = path.join(parent, 'data')
    await fs.mkdir(root)
    await fs.writeFile(path.join(root, 'trace.json'), nativeTrace('external-2'))
    const store = new TraceStore()

    await scanAll(store, [root])

    expect(store.getFull('external-2')?.meta.extra?.run).toBe('data')
  })

  it('stamps production corpus/run identity from an explicit production root', async () => {
    const root = await temporaryRoot()
    await fs.writeFile(path.join(root, 'same-id.json'), nativeTrace('same-id'))
    const store = new TraceStore()

    await scanAll(store, [`production=${root}`])

    const trace = store.getFull('same-id')
    expect(trace?.meta).toMatchObject({
      sourceTraceId: 'same-id',
      corpusId: 'production',
      runId: 'production',
    })
    expect(trace?.meta.traceUid).toMatch(/^trace_[0-9a-f]{24}$/)
  })

  it('treats episodes as a runs root and excludes batch/checkpoint artifacts', async () => {
    const parent = await temporaryRoot()
    const episodes = path.join(parent, 'episodes')
    const batch = path.join(episodes, 'run-one')
    await fs.mkdir(batch, { recursive: true })
    await fs.writeFile(path.join(batch, 'episode.json'), nativeTrace('shared-source-id'))
    await fs.writeFile(
      path.join(batch, 'episode.meta.json'),
      JSON.stringify({
        meta: { extra: { scenario_id: 'scenario-a', environment_seed: 7 } },
        evaluation: {
          grade: { passed: true, checks: [] },
          metrics: { status: 'completed' },
          flags: [],
        },
      }),
    )
    await fs.writeFile(
      path.join(batch, 'batch.json'),
      JSON.stringify({
        schema_version: 2,
        batch_id: 'run-one',
        schedule_digest: 'schedule123',
        episodes: [
          {
            scenario_id: 'scenario-a',
            environment_seed: 7,
            file: 'episode.json',
            status: 'completed',
            split: 'holdout',
            grade: { passed: true },
          },
        ],
      }),
    )
    await fs.writeFile(
      path.join(batch, 'episode.checkpoints.json'),
      JSON.stringify({ entries: [] }),
    )
    const store = new TraceStore()

    const result = await scanAll(store, [episodes])

    expect(result).toMatchObject({ files: 1, traces: 1, warnings: 0 })
    const trace = store.getFull('shared-source-id')
    expect(trace?.meta).toMatchObject({
      corpusId: 'simulation',
      runId: 'run-one',
      instanceId: 'scenario-a',
      pairKey: 'schedule123:scenario-a:7',
      split: 'test',
    })
    expect(trace?.evaluation?.outcome).toBe('pass')
  })

  it('retains the last good trace across corrupt, partial, and invalid-sidecar rescans', async () => {
    const root = await temporaryRoot()
    const source = path.join(root, 'live.json')
    const sidecar = path.join(root, 'live.meta.json')
    const complete = JSON.stringify({
      conversation: [
        { role: 'user', agent_type: 'user', content: 'original question', timestamp: 1 },
        { role: 'assistant', agent_type: 'beta', content: 'original answer', timestamp: 2 },
      ],
    })
    await fs.writeFile(source, complete)
    await fs.writeFile(sidecar, JSON.stringify({ meta: { component: 'ace/good' } }))
    const store = new TraceStore()
    await scanAll(store, [`live=${root}`])
    const uid = store.getFull('live')?.meta.traceUid as string

    await fs.writeFile(sidecar, '{half written')
    const invalidSidecar = await scanFile(store, source, `live=${root}`)
    expect(invalidSidecar.committed).toBe(false)
    expect(store.getFull(uid)?.meta.component).toBe('ace/good')

    await fs.writeFile(sidecar, JSON.stringify({ meta: { component: 'ace/new' } }))
    await fs.writeFile(
      source,
      '{"conversation":[{"role":"user","agent_type":"user","content":"partial","timestamp":1},{"role":"assistant"',
    )
    const partial = await scanFile(store, source, `live=${root}`)
    expect(partial.committed).toBe(false)
    expect(store.getFull(uid)?.messages.map((message) => message.content)).toEqual([
      'original question',
      'original answer',
    ])

    await fs.writeFile(source, '{not json')
    const corrupt = await scanFile(store, source, `live=${root}`)
    expect(corrupt.committed).toBe(false)
    expect(store.getFull(uid)?.meta.component).toBe('ace/good')
  })

  it('assigns overlapping roots to the most-specific configured ancestor', async () => {
    const broad = await temporaryRoot()
    const runs = path.join(broad, 'runs')
    const child = path.join(runs, 'nested-run')
    await fs.mkdir(child, { recursive: true })
    await fs.writeFile(path.join(child, 'trace.json'), nativeTrace('overlap-1'))
    const store = new TraceStore()

    await scanAll(store, [`broad-label=${broad}`, runs])

    expect(store.getFull('overlap-1')?.meta.extra?.run).toBe('nested-run')
    const statuses = getScanProgress().scanRoots
    expect(statuses.find((item) => item.run === 'broad-label')).toMatchObject({ files: 0 })
    expect(statuses.find((item) => item.mode === 'runs')).toMatchObject({
      files: 1,
      traces: 1,
    })
  })

  it('reports aggregate per-root warnings and safe labels without file contents or host paths', async () => {
    const root = await temporaryRoot()
    const missing = path.join(root, 'not-created')
    await fs.writeFile(path.join(root, 'good.json'), nativeTrace('good'))
    await fs.writeFile(path.join(root, 'bad.json'), '{not valid json')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await scanAll(new TraceStore(), [`audit=${root}`, missing])
    const snapshot = getScanProgress()

    expect(result).toMatchObject({ files: 2, traces: 1, warnings: 1 })
    expect(snapshot).toMatchObject({ scanning: false, scannedFiles: 2, totalFiles: 2 })
    expect(snapshot.scanRoots[0]).toMatchObject({
      run: 'audit',
      state: 'ready',
      files: 2,
      scannedFiles: 2,
      traces: 1,
      warnings: 1,
    })
    expect(snapshot.scanRoots[1]).toMatchObject({ state: 'missing', files: 0, traces: 0 })
    expect(snapshot.scanRoots[0]).not.toHaveProperty('path')
    expect(JSON.stringify(snapshot)).not.toContain(root)
    expect(JSON.stringify(snapshot)).not.toContain('{not valid json')
  })

  it('watches the resolved path from the same labelled root spec', async () => {
    const root = await temporaryRoot()
    const store = new TraceStore()
    const watcher = watch(store, [`live-run=${root}`])
    try {
      await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
      await fs.writeFile(path.join(root, 'live.json'), nativeTrace('live-1'))

      await vi.waitFor(() => expect(store.size).toBe(1), { timeout: 3_000 })
      expect(store.getFull('live-1')?.meta.extra?.run).toBe('live-run')
      await vi.waitFor(
        () =>
          expect(getScanProgress().scanRoots.find((item) => item.run === 'live-run')).toMatchObject(
            {
              files: 1,
              scannedFiles: 1,
              traces: 1,
            },
          ),
        { timeout: 3_000 },
      )

      await fs.rm(path.join(root, 'live.json'))
      await vi.waitFor(() => expect(store.size).toBe(0), { timeout: 3_000 })
      await vi.waitFor(
        () =>
          expect(getScanProgress().scanRoots.find((item) => item.run === 'live-run')).toMatchObject(
            {
              files: 0,
              scannedFiles: 0,
              traces: 0,
            },
          ),
        { timeout: 3_000 },
      )
    } finally {
      await watcher.close()
    }
  })

  it('publishes batch.updated only after a complete manifest parses', async () => {
    const root = await temporaryRoot()
    const store = new TraceStore()
    const events: Array<{ type: string; runId?: string }> = []
    store.subscribe((event) => events.push(event))
    const watcher = watch(store, [`live-batch=${root}`])
    const manifestPath = path.join(root, 'batch.json')
    try {
      await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
      await fs.writeFile(manifestPath, '{partial')
      await new Promise((resolve) => setTimeout(resolve, 450))
      expect(events).toEqual([])

      await fs.writeFile(
        manifestPath,
        JSON.stringify({ schema_version: 3, batch_id: 'run-live', episodes: [] }),
      )
      await vi.waitFor(
        () =>
          expect(events).toContainEqual(
            expect.objectContaining({ type: 'batch.updated', runId: 'run-live' }),
          ),
        { timeout: 2_000, interval: 25 },
      )
    } finally {
      await watcher.close()
    }
  })

  it('does not publish sibling trace updates for a heartbeat-only manifest rewrite', async () => {
    const root = await temporaryRoot()
    const manifestPath = path.join(root, 'batch.json')
    await fs.writeFile(path.join(root, 'episode.json'), nativeTrace('episode-1', 'run-live'))
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        schema_version: 3,
        batch_id: 'run-live',
        heartbeat_at: '2026-08-06T00:00:00.000Z',
        episodes: [],
      }),
    )
    const store = new TraceStore()
    await scanAll(store, [`live-batch=${root}`])
    const events: Array<{ type: string; runId?: string }> = []
    store.subscribe((event) => events.push(event))
    const watcher = watch(store, [`live-batch=${root}`])
    try {
      await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          schema_version: 3,
          batch_id: 'run-live',
          heartbeat_at: '2026-08-06T00:00:01.000Z',
          episodes: [],
        }),
      )
      await vi.waitFor(
        () =>
          expect(events).toContainEqual(
            expect.objectContaining({ type: 'batch.updated', runId: 'run-live' }),
          ),
        { timeout: 2_000, interval: 25 },
      )
      await new Promise((resolve) => setTimeout(resolve, 450))
      expect(events.filter((event) => event.type === 'trace.upserted')).toEqual([])
      expect(events.filter((event) => event.type === 'batch.updated')).toHaveLength(1)
    } finally {
      await watcher.close()
    }
  })

  it('does not double-count an atomic-save add event for an already-known corrupt source', async () => {
    const root = await temporaryRoot()
    const sourcePath = path.join(root, 'bad.json')
    await fs.writeFile(sourcePath, '{not valid json')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = new TraceStore()
    await scanAll(store, [`atomic=${root}`])
    const watcher = watch(store, [`atomic=${root}`])
    try {
      await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
      // Some editors replace a file atomically and chokidar reports `add` even though
      // the scanner already counted that path. Emit that exact watcher condition.
      watcher.emit('add', sourcePath)

      await vi.waitFor(
        () =>
          expect(getScanProgress().scanRoots.find((item) => item.run === 'atomic')).toMatchObject({
            files: 1,
            scannedFiles: 1,
            traces: 0,
            warnings: 2,
          }),
        { timeout: 3_000 },
      )
      expect(getScanProgress()).toMatchObject({ totalFiles: 1, scannedFiles: 1 })
    } finally {
      await watcher.close()
    }
  })

  it('keeps duplicate producer ids independent and legacy lookup becomes unique after unlink', async () => {
    const root = await temporaryRoot()
    const first = path.join(root, 'a.json')
    const second = path.join(root, 'b.json')
    await fs.writeFile(first, nativeTrace('duplicate-id'))
    await fs.writeFile(second, nativeTrace('duplicate-id'))
    const store = new TraceStore()
    await scanAll(store, [`duplicates=${root}`])
    expect(store.size).toBe(2)
    expect(store.lookup('duplicate-id').kind).toBe('ambiguous')
    expect(store.traceUidsForSource(first)).toHaveLength(1)
    expect(store.traceUidsForSource(second)).toHaveLength(1)
    const watcher = watch(store, [`duplicates=${root}`])
    try {
      await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
      await fs.rm(second)

      await vi.waitFor(() => expect(store.get('duplicate-id')?.sourcePath).toBe(first), {
        timeout: 3_000,
      })
      expect(getScanProgress().scanRoots.find((item) => item.run === 'duplicates')).toMatchObject({
        files: 1,
        scannedFiles: 1,
        traces: 1,
      })
    } finally {
      await watcher.close()
    }
  })

  it('removes only the rewritten source identity when a duplicate changes producer id', async () => {
    const root = await temporaryRoot()
    const first = path.join(root, 'a.json')
    const second = path.join(root, 'b.json')
    await fs.writeFile(first, nativeTrace('old-duplicate'))
    await fs.writeFile(second, nativeTrace('old-duplicate'))
    const store = new TraceStore()
    await scanAll(store, [`rewrite=${root}`])
    expect(store.size).toBe(2)
    expect(store.lookup('old-duplicate').kind).toBe('ambiguous')
    const watcher = watch(store, [`rewrite=${root}`])
    try {
      await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
      await fs.writeFile(second, nativeTrace('new-identity'))

      await vi.waitFor(
        () => {
          expect(store.get('old-duplicate')?.sourcePath).toBe(first)
          expect(store.get('new-identity')?.sourcePath).toBe(second)
        },
        { timeout: 3_000 },
      )
      expect(store.size).toBe(2)
      expect(getScanProgress().scanRoots.find((item) => item.run === 'rewrite')).toMatchObject({
        files: 2,
        scannedFiles: 2,
        traces: 2,
      })
    } finally {
      await watcher.close()
    }
  })

  it('surfaces a root-specific watcher error in live diagnostics', async () => {
    const root = await temporaryRoot()
    const store = new TraceStore()
    await scanAll(store, [`watch-error=${root}`])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const watcher = watch(store, [`watch-error=${root}`])
    try {
      await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
      watcher.emit('error', Object.assign(new Error('watch permission lost'), { path: root }))

      expect(getScanProgress().scanRoots.find((item) => item.run === 'watch-error')).toMatchObject({
        state: 'error',
        warnings: 1,
      })
    } finally {
      await watcher.close()
    }
  })
})
