import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import { createApp } from '../app'
import { TraceStore } from '../store/traceStore'
import { publicDataLocation } from './publicView'

let root = ''
let sourcePath = ''
let app: ReturnType<typeof createApp>
const rawSource = '{"private":"raw source remains available"}'

function fixture(traceId: string, checkpointStep: number, dataLocation: string): ParsedTrace {
  return {
    meta: {
      traceId,
      instanceId: 'shared-instance',
      component: 'test/public-view',
      status: 'completed',
      timestamp: `2026-01-0${checkpointStep + 1}T00:00:00.000Z`,
      checkpointStep,
      split: 'test',
      sourceFormat: 'native',
      dataLocation,
      extra: { run: 'privacy-test' },
    },
    messages: [
      { id: '', role: 'user', content: 'question with enough content' },
      { id: '', role: 'assistant', channel: 'final', content: 'answer with enough content' },
    ],
    warnings: [],
  }
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-public-view-'))
  sourcePath = path.join(root, 'private-source.json')
  await fs.writeFile(sourcePath, rawSource)
  const store = new TraceStore()
  store.upsert(fixture('private-1', 1, sourcePath), sourcePath)
  store.upsert(fixture('private-2', 1, path.join(root, 'second.json')))
  store.upsert(fixture('private-3', 2, path.join(root, 'third.json')))
  app = createApp({ store, dataRoots: [root] })
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function expectPublicLocation(value: unknown): void {
  expect(typeof value).toBe('string')
  expect(path.isAbsolute(String(value))).toBe(false)
  expect(String(value)).not.toContain(root)
}

describe('public trace serialization', () => {
  it('redacts cross-platform absolute locations but preserves URLs and logical paths', () => {
    expect(publicDataLocation('data/runs/a.json')).toBe('data/runs/a.json')
    expect(publicDataLocation('https://example.test/traces/1')).toBe(
      'https://example.test/traces/1',
    )
    const fileUrl = publicDataLocation('file:///Users/alice/private/trace.json')
    expect(fileUrl).not.toContain('/Users/alice')
    expect(path.isAbsolute(String(fileUrl))).toBe(false)
    expect(publicDataLocation('FILE:///Users/alice/private/trace.json')).not.toContain(
      '/Users/alice',
    )
    expect(publicDataLocation('C:\\Users\\alice\\private\\trace.json')).toBe('trace.json')
  })

  it('redacts list, detail, sibling, and evolution payloads', async () => {
    const list = await request(app).get('/api/traces')
    expect(list.status).toBe(200)
    for (const item of list.body.items) expectPublicLocation(item.meta.dataLocation)

    const detail = await request(app).get('/api/traces/private-1')
    expect(detail.status).toBe(200)
    expectPublicLocation(detail.body.meta.dataLocation)

    const siblings = await request(app).get('/api/traces/private-1/siblings')
    expect(siblings.status).toBe(200)
    expect(siblings.body).toHaveLength(1)
    expectPublicLocation(siblings.body[0].meta.dataLocation)

    const evolution = await request(app).get('/api/evolution/shared-instance?run=privacy-test')
    expect(evolution.status).toBe(200)
    for (const point of evolution.body.points) {
      for (const rollout of point.rollouts) expectPublicLocation(rollout.meta.dataLocation)
    }
  })

  it('keeps the private source path internally for the raw endpoint', async () => {
    const raw = await request(app).get('/api/traces/private-1/raw')
    expect(raw.status).toBe(200)
    expect(raw.text).toBe(rawSource)
  })
})
