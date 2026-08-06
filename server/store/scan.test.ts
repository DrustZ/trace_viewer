import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getScanProgress, scanAll, watch } from './scan'
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

  it('restores a duplicate trace id from a remaining source after unlink', async () => {
    const root = await temporaryRoot()
    const first = path.join(root, 'a.json')
    const second = path.join(root, 'b.json')
    await fs.writeFile(first, nativeTrace('duplicate-id'))
    await fs.writeFile(second, nativeTrace('duplicate-id'))
    const store = new TraceStore()
    await scanAll(store, [`duplicates=${root}`])
    expect(store.get('duplicate-id')?.sourcePath).toBe(second)
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

  it('restores a shadowed trace id when the winning source changes identity', async () => {
    const root = await temporaryRoot()
    const first = path.join(root, 'a.json')
    const second = path.join(root, 'b.json')
    await fs.writeFile(first, nativeTrace('old-duplicate'))
    await fs.writeFile(second, nativeTrace('old-duplicate'))
    const store = new TraceStore()
    await scanAll(store, [`rewrite=${root}`])
    expect(store.get('old-duplicate')?.sourcePath).toBe(second)
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
