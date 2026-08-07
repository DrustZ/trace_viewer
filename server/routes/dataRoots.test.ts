import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import { DataRootManager } from '../store/dataRootManager'
import { TraceStore } from '../store/traceStore'

function writeTrace(directory: string, fileName: string, traceId: string): void {
  writeFileSync(
    path.join(directory, fileName),
    JSON.stringify({
      meta: {
        traceId,
        instanceId: traceId,
        component: 'test/local-folder',
        status: 'completed',
        timestamp: '2026-08-06T00:00:00.000Z',
        checkpointStep: 0,
        split: 'test',
        sourceFormat: 'native',
      },
      messages: [{ id: 'm-0', role: 'user', content: 'hello' }],
    }),
  )
}

describe('local data-root API', () => {
  let fixture: string
  let initial: string
  let target: string
  let store: TraceStore
  let manager: DataRootManager
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    fixture = mkdtempSync(path.join(os.tmpdir(), 'tv-folder-route-'))
    initial = path.join(fixture, 'initial')
    target = path.join(fixture, 'target')
    mkdirSync(initial)
    mkdirSync(target)
    writeTrace(target, 'first.json', 'folder-first')
    store = new TraceStore()
    manager = new DataRootManager(store, [`taken=${initial}`], { allowedParents: [fixture] })
    app = createApp({ store, dataRootManager: manager })
  })

  afterEach(async () => {
    await manager.close()
    rmSync(fixture, { recursive: true, force: true })
  })

  it('lists opaque, account-safe root summaries without absolute paths', async () => {
    const response = await request(app).get('/api/data-roots')

    expect(response.status).toBe(200)
    expect(response.body.roots).toEqual([
      expect.objectContaining({
        label: 'taken',
        run: 'taken',
        dynamic: false,
        persistent: true,
      }),
    ])
    expect(response.body.persistenceAvailable).toBe(false)
    expect(response.body.roots[0]).not.toHaveProperty('path')
    expect(JSON.stringify(response.body)).not.toContain(initial)
  })

  it.each([
    ['relative path', 'relative/folder', undefined, 400],
    ['filesystem root', path.parse(process.cwd()).root, undefined, 400],
    ['home directory', os.homedir(), undefined, 400],
    ['missing directory', '/definitely/not/a/trace-viewer-directory', undefined, 400],
  ])('rejects %s', async (_case, folderPath, label, status) => {
    const response = await request(app)
      .post('/api/data-roots')
      .send({ path: folderPath, ...(label === undefined ? {} : { label }) })

    expect(response.status, JSON.stringify(response.body)).toBe(status)
    expect(response.body.error).toEqual(expect.any(String))
  })

  it('rejects a readable folder outside the configured workspace boundary', async () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), 'tv-outside-root-'))
    try {
      const response = await request(app).post('/api/data-roots').send({ path: outside })
      expect(response.status).toBe(403)
      expect(response.body.error).toContain('TRACE_VIEWER_ALLOWED_DATA_PARENTS')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('does not ingest a symlink below a watched root that points outside it', async () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), 'tv-symlink-target-'))
    try {
      writeTrace(outside, 'secret.json', 'outside-secret')
      symlinkSync(outside, path.join(target, 'outside-link'), 'dir')
      const added = await request(app)
        .post('/api/data-roots')
        .send({ path: target, label: 'symlink-safe' })
      expect(added.status).toBe(201)
      expect(store.lookup('outside-secret').kind).toBe('missing')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects malformed and duplicate labels', async () => {
    const malformed = await request(app)
      .post('/api/data-roots')
      .send({ path: target, label: 'not a label' })
    expect(malformed.status).toBe(400)

    const duplicate = await request(app)
      .post('/api/data-roots')
      .send({ path: target, label: 'TAKEN' })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toContain('already in use')
  })

  it('requires a unique effective label for unlabelled folders with the same basename', async () => {
    const first = path.join(fixture, 'first-parent', 'data')
    const second = path.join(fixture, 'second-parent', 'data')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })

    const added = await request(app).post('/api/data-roots').send({ path: first })
    expect(added.status).toBe(201)
    expect(added.body.root).toMatchObject({ label: 'data', run: null })

    const collision = await request(app).post('/api/data-roots').send({ path: second })
    expect(collision.status).toBe(409)
    expect(collision.body.error).toContain('choose a unique label')

    const labelled = await request(app)
      .post('/api/data-roots')
      .send({ path: second, label: 'second-data' })
    expect(labelled.status).toBe(201)
    expect(labelled.body.root).toMatchObject({ label: 'second-data', run: 'second-data' })
  })

  it('rejects duplicate and overlapping normalized directories', async () => {
    const duplicate = await request(app)
      .post('/api/data-roots')
      .send({ path: path.join(initial, '.') })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toContain('already watched')

    const child = path.join(initial, 'nested')
    mkdirSync(child)
    const overlap = await request(app).post('/api/data-roots').send({ path: child })
    expect(overlap.status).toBe(409)
    expect(overlap.body.error).toContain('overlaps')
  })

  it('rejects ambiguous startup labels and overlaps before any scan can overwrite identity', () => {
    const first = path.join(fixture, 'first-parent', 'data')
    const second = path.join(fixture, 'second-parent', 'data')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })

    expect(() => new DataRootManager(new TraceStore(), [first, second])).toThrow(
      'give each root a unique label',
    )
    expect(
      () =>
        new DataRootManager(new TraceStore(), [
          `parent=${first}`,
          `child=${path.join(first, 'nested')}`,
        ]),
    ).toThrow('startup data roots overlap')
  })

  it('scans immediately, then keeps watching message files without a restart', async () => {
    const added = await request(app)
      .post('/api/data-roots')
      .send({ path: target, label: 'live-run' })

    expect(added.status).toBe(201)
    expect(added.body).toEqual(
      expect.objectContaining({
        root: expect.objectContaining({ label: 'live-run', run: 'live-run', dynamic: true }),
        indexedTraces: 1,
        warnings: 0,
        traceCount: 1,
      }),
    )
    expect(added.body.root).not.toHaveProperty('path')

    writeTrace(target, 'second.json', 'folder-second')
    await vi.waitFor(() => expect(store.size).toBe(2), { timeout: 4_000, interval: 50 })
    expect(store.lookup('folder-second').kind).toBe('found')
  })

  it('atomically persists a UI-added root when a machine-local registry is configured', async () => {
    await manager.close()
    const registry = path.join(fixture, 'private', 'data-roots.json')
    manager = new DataRootManager(store, [`taken=${initial}`], {
      persistenceFile: registry,
      allowedParents: [fixture],
    })
    app = createApp({ store, dataRootManager: manager })

    const added = await request(app)
      .post('/api/data-roots')
      .send({ path: target, label: 'saved-run' })

    expect(added.status).toBe(201)
    expect(added.body.root).toMatchObject({
      label: 'saved-run',
      dynamic: true,
      persistent: true,
    })
    expect(JSON.parse(readFileSync(registry, 'utf8'))).toEqual({
      schemaVersion: 1,
      roots: [`saved-run=${realpathSync(target)}`],
    })
    const listed = await request(app).get('/api/data-roots')
    expect(listed.body.persistenceAvailable).toBe(true)
    expect(JSON.stringify(listed.body)).not.toContain(target)
  })
})
