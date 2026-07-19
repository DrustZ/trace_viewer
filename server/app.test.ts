import { promises as fs, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAny } from '../shared/connectors/registry'
import { createApp } from './app'
import { TraceStore } from './store/traceStore'

const SEED_FALLBACK_TS = '2026-03-04T00:00:00.000Z'

function nativeEntry(opts: {
  traceId: string
  timestamp: string
  checkpointStep: number
  split: 'train' | 'test'
  score: number
  content: string
}) {
  return {
    meta: {
      traceId: opts.traceId,
      instanceId: 'lc-i01',
      component: 'code/leetcode',
      status: 'completed',
      timestamp: opts.timestamp,
      checkpointStep: opts.checkpointStep,
      split: opts.split,
      sourceFormat: 'native',
    },
    messages: [
      { id: '', role: 'user', content: 'Solve the coding task' },
      { id: '', role: 'assistant', channel: 'final', content: opts.content },
    ],
    stats: { score: opts.score },
  }
}

const NATIVE_FIXTURE = JSON.stringify([
  nativeEntry({
    traceId: 'lc-i01-s100-r01',
    timestamp: '2026-03-01T00:00:00.000Z',
    checkpointStep: 100,
    split: 'train',
    score: 0.8,
    content: 'Use three pointers to reverse the linked list iteratively',
  }),
  nativeEntry({
    traceId: 'lc-i01-s100-r02',
    timestamp: '2026-03-02T00:00:00.000Z',
    checkpointStep: 100,
    split: 'train',
    score: 0.2,
    content: 'Recursive approach hits the depth limit',
  }),
  nativeEntry({
    traceId: 'lc-i01-s200-r01',
    timestamp: '2026-03-03T00:00:00.000Z',
    checkpointStep: 200,
    split: 'test',
    score: 0.6,
    content: 'Two-pass sweep with a stack',
  }),
])

const OPENAI_FIXTURE = JSON.stringify({
  id: 'openai-import-1',
  model: 'gpt-test',
  created: 1772668800, // 2026-03-05T00:00:00.000Z
  messages: [{ role: 'user', content: 'What is the capital of France?' }],
  choices: [{ message: { role: 'assistant', content: 'The capital of France is Paris.' } }],
})

const HARMONY_FIXTURE =
  '<|start|>user<|message|>solve the puzzle quickly<|end|>' +
  '<|start|>assistant<|channel|>final<|message|>the puzzle answer is 42<|end|>'

const HARMONY_ID = parseAny(HARMONY_FIXTURE, {}).traces[0].meta.traceId

const IMPORT_FIXTURE = JSON.stringify({
  meta: {
    traceId: 'imported-1',
    instanceId: 'imported-1',
    component: 'code/leetcode',
    status: 'completed',
    timestamp: '2026-03-06T00:00:00.000Z',
    checkpointStep: 0,
    split: 'train',
    sourceFormat: 'native',
  },
  messages: [{ id: '', role: 'user', content: 'imported content payload' }],
})

function seededStore(): TraceStore {
  const store = new TraceStore()
  for (const fixture of [NATIVE_FIXTURE, OPENAI_FIXTURE, HARMONY_FIXTURE]) {
    const result = parseAny(fixture, { fallbackTimestamp: SEED_FALLBACK_TS })
    for (const parsed of result.traces) store.upsert(parsed)
  }
  return store
}

const importDir = mkdtempSync(path.join(os.tmpdir(), 'tv-import-'))
const scanRoot = mkdtempSync(path.join(os.tmpdir(), 'tv-scan-'))

afterAll(() => {
  rmSync(importDir, { recursive: true, force: true })
  rmSync(scanRoot, { recursive: true, force: true })
})

describe('api', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp({ store: seededStore(), importDir, dataRoots: [scanRoot] })
  })

  it('serves health', async () => {
    const res = await request(createApp({ version: 'test' })).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, version: 'test' })
  })

  it('GET /api/meta returns distinct values and filter keys', async () => {
    const res = await request(app).get('/api/meta')
    expect(res.status).toBe(200)
    expect(res.body.components).toEqual([
      'code/leetcode',
      'imported/harmony',
      'imported/openai-chat',
    ])
    expect(res.body.steps).toEqual([0, 100, 200])
    expect(res.body.splits).toEqual(['train', 'test'])
    expect(res.body.statuses).toEqual(['completed'])
    expect(res.body.traceCount).toBe(5)
    expect(res.body.dataVersion).toBeGreaterThan(0)
    expect(res.body.filterKeys.map((k: { id: string }) => k.id)).toContain('score')
    // Progressive-scan progress fields (additive to MetaResponse); no scan runs here.
    expect(res.body.scanning).toBe(false)
    expect(typeof res.body.scannedFiles).toBe('number')
    expect(typeof res.body.totalFiles).toBe('number')
  })

  it('GET /api/traces sorts by time desc by default, total before limit/offset', async () => {
    const res = await request(app).get('/api/traces')
    expect(res.body.total).toBe(5)
    expect(res.body.items.map((s: { meta: { traceId: string } }) => s.meta.traceId)).toEqual([
      'openai-import-1',
      HARMONY_ID,
      'lc-i01-s200-r01',
      'lc-i01-s100-r02',
      'lc-i01-s100-r01',
    ])
    const paged = await request(app).get('/api/traces?limit=2&offset=1')
    expect(paged.body.total).toBe(5)
    expect(paged.body.items).toHaveLength(2)
    expect(paged.body.items[0].meta.traceId).toBe(HARMONY_ID)
  })

  it('GET /api/traces applies the filter DSL with sort and order', async () => {
    const res = await request(app).get('/api/traces?filters=score.gte.0.5&sort=score&order=asc')
    expect(res.body.total).toBe(2)
    expect(res.body.items.map((s: { meta: { traceId: string } }) => s.meta.traceId)).toEqual([
      'lc-i01-s200-r01',
      'lc-i01-s100-r01',
    ])
  })

  it('GET /api/traces sorts undefined values last regardless of order', async () => {
    const res = await request(app).get('/api/traces?sort=score')
    const ids = res.body.items.map((s: { meta: { traceId: string } }) => s.meta.traceId)
    expect(ids).toEqual([
      'lc-i01-s100-r01',
      'lc-i01-s200-r01',
      'lc-i01-s100-r02',
      HARMONY_ID,
      'openai-import-1',
    ])
  })

  it('GET /api/traces?groupBy=instance groups the sorted items', async () => {
    const res = await request(app).get('/api/traces?groupBy=instance&order=asc')
    expect(res.body.total).toBe(5)
    expect(res.body.groups).toHaveLength(3)
    const first = res.body.groups[0]
    expect(first.instanceId).toBe('lc-i01')
    expect(first.component).toBe('code/leetcode')
    expect(first.count).toBe(3)
    expect(first.avgScore).toBeCloseTo((0.8 + 0.2 + 0.6) / 3, 5)
    expect(first.items).toHaveLength(3)
  })

  it('GET /api/traces?q= unions substring and search-index matches', async () => {
    const bySubstring = await request(app).get('/api/traces?q=leetcode')
    expect(bySubstring.body.total).toBe(3)
    const byContent = await request(app).get('/api/traces?q=Paris')
    expect(byContent.body.total).toBe(1)
    expect(byContent.body.items[0].meta.traceId).toBe('openai-import-1')
  })

  it('GET /api/traces/:id returns the full trace, 404 for unknown', async () => {
    const res = await request(app).get('/api/traces/lc-i01-s100-r01')
    expect(res.status).toBe(200)
    expect(res.body.meta.traceId).toBe('lc-i01-s100-r01')
    expect(res.body.messages).toHaveLength(2)
    expect(res.body.stats.score).toBe(0.8)
    const missing = await request(app).get('/api/traces/nope')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'trace not found' })
  })

  it('GET /api/traces/:id/neighbors reports middle and edge positions', async () => {
    const middle = await request(app).get(
      '/api/traces/lc-i01-s100-r02/neighbors?sort=time&order=asc',
    )
    expect(middle.body).toEqual({
      prevId: 'lc-i01-s100-r01',
      nextId: 'lc-i01-s200-r01',
      position: 2,
      total: 5,
    })
    const edge = await request(app).get('/api/traces/openai-import-1/neighbors')
    expect(edge.body).toEqual({ prevId: null, nextId: HARMONY_ID, position: 1, total: 5 })
    // A trace excluded by the filters reports position 0 with no neighbors.
    const filteredOut = await request(app).get(
      '/api/traces/openai-import-1/neighbors?status=failed',
    )
    expect(filteredOut.body).toEqual({ prevId: null, nextId: null, position: 0, total: 0 })
  })

  it('GET /api/traces/:id/siblings returns same instance+step rollouts, score desc', async () => {
    const res = await request(app).get('/api/traces/lc-i01-s100-r02/siblings')
    expect(res.status).toBe(200)
    expect(res.body.map((s: { meta: { traceId: string } }) => s.meta.traceId)).toEqual([
      'lc-i01-s100-r01',
    ])
  })

  it('GET /api/aggregates/tiles applies list params first', async () => {
    const res = await request(app).get('/api/aggregates/tiles?component=code%2Fleetcode')
    expect(res.body.total).toBe(3)
    expect(res.body.completed).toBe(3)
    expect(res.body.avgScore).toBeCloseTo((0.8 + 0.2 + 0.6) / 3, 5)
  })

  it('GET /api/aggregates/curves filters by component', async () => {
    const res = await request(app).get('/api/aggregates/curves?component=code%2Fleetcode')
    expect(res.body.train).toEqual([{ step: 100, avgScore: 0.5, count: 2 }])
    expect(res.body.test).toEqual([{ step: 200, avgScore: 0.6, count: 1 }])
  })

  it('GET /api/evolution/:instanceId returns the series, 404 for unknown', async () => {
    const res = await request(app).get('/api/evolution/lc-i01')
    expect(res.status).toBe(200)
    expect(res.body.points.map((p: { step: number }) => p.step)).toEqual([100, 200])
    expect(
      res.body.points[0].rollouts.map((s: { meta: { traceId: string } }) => s.meta.traceId),
    ).toEqual(['lc-i01-s100-r01', 'lc-i01-s100-r02'])
    const missing = await request(app).get('/api/evolution/nope')
    expect(missing.status).toBe(404)
  })

  it('GET /api/search returns snippet hits, [] for short queries', async () => {
    const res = await request(app).get('/api/search?q=linked')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].traceId).toBe('lc-i01-s100-r01')
    expect(res.body[0].component).toBe('code/leetcode')
    expect(res.body[0].score).toBe(0.8)
    expect(res.body[0].snippet).toContain('linked list')
    const short = await request(app).get('/api/search?q=P')
    expect(short.body).toEqual([])
  })

  it('POST /api/import (text) persists the raw source and serves it back', async () => {
    const res = await request(app)
      .post('/api/import')
      .send({ type: 'text', content: IMPORT_FIXTURE })
    expect(res.status).toBe(200)
    expect(res.body.traceIds).toEqual(['imported-1'])
    expect(res.body.format).toBe('native')
    const persisted = await fs.readFile(path.join(importDir, 'imported-1.json'), 'utf8')
    expect(persisted).toBe(IMPORT_FIXTURE)
    const raw = await request(app).get('/api/traces/imported-1/raw')
    expect(raw.status).toBe(200)
    expect(raw.headers['content-type']).toContain('text/plain')
    expect(raw.text).toBe(IMPORT_FIXTURE)
    // Seeded traces have no sourcePath, so raw is a 404 for them.
    const noRaw = await request(app).get('/api/traces/lc-i01-s100-r01/raw')
    expect(noRaw.status).toBe(404)
  })

  it('POST /api/import rejects unparseable content (422) and bad bodies (400)', async () => {
    const unparseable = await request(app)
      .post('/api/import')
      .send({ type: 'text', content: 'complete garbage' })
    expect(unparseable.status).toBe(422)
    expect(unparseable.body.warnings).toBeInstanceOf(Array)
    const badType = await request(app).post('/api/import').send({ type: 'zip' })
    expect(badType.status).toBe(400)
  })

  it('POST /api/ai-filter answers with rules-based filters', async () => {
    // Force the rules path even when the shell exports a real ANTHROPIC_API_KEY.
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const res = await request(app)
      .post('/api/ai-filter')
      .send({ query: 'failed traces with score under 0.5' })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('rules')
    expect(res.body.filter.conditions).toContainEqual({ key: 'score', op: 'lt', value: 0.5 })
    expect(res.body.filter.conditions).toContainEqual({ key: 'status', op: 'eq', value: 'failed' })
    const missing = await request(app).post('/api/ai-filter').send({})
    expect(missing.status).toBe(400)
    vi.unstubAllEnvs()
  })

  it('responds 400 to malformed JSON bodies', async () => {
    const res = await request(app)
      .post('/api/ai-filter')
      .set('Content-Type', 'application/json')
      .send('{not json')
    expect(res.status).toBe(400)
    expect(res.body.error).toBeTruthy()
  })

  it('POST /api/refresh rescans the roots, applying sidecar meta', async () => {
    await fs.writeFile(
      path.join(scanRoot, 'scanned.json'),
      JSON.stringify({
        meta: {
          traceId: 'scanned-1',
          instanceId: 'scanned-1',
          component: 'code/original',
          status: 'completed',
          timestamp: '2026-03-07T00:00:00.000Z',
          checkpointStep: 0,
          split: 'train',
          sourceFormat: 'native',
        },
        messages: [{ id: '', role: 'user', content: 'scanned content' }],
      }),
    )
    await fs.writeFile(
      path.join(scanRoot, 'scanned.meta.json'),
      JSON.stringify({ meta: { component: 'sidecar/component' }, statsOverrides: { score: 0.9 } }),
    )
    const res = await request(app).post('/api/refresh')
    expect(res.status).toBe(200)
    expect(res.body.traces).toBe(1)
    expect(res.body.dataVersion).toBeGreaterThan(0)
    // Refresh replaces the seeded store contents entirely.
    const gone = await request(app).get('/api/traces/lc-i01-s100-r01')
    expect(gone.status).toBe(404)
    const scanned = await request(app).get('/api/traces/scanned-1')
    expect(scanned.status).toBe(200)
    expect(scanned.body.meta.component).toBe('sidecar/component')
    expect(scanned.body.stats.score).toBe(0.9)
  })
})

// ---------------------------------------------------------------------------
// Run scoping (evolution/siblings/aggregates) and per-message search.
// Separate store: run-b shares instanceId 'lc-i01' with the run-a fixtures,
// plus a long trace whose tail sits far past the old 20k-per-trace index cap.
// ---------------------------------------------------------------------------

const RUN_B_FIXTURE = JSON.stringify({
  meta: {
    traceId: 'b-lc-i01-s100-r01',
    instanceId: 'lc-i01',
    component: 'code/leetcode',
    status: 'completed',
    timestamp: '2026-03-02T12:00:00.000Z',
    checkpointStep: 100,
    split: 'train',
    sourceFormat: 'native',
    extra: { run: 'run-b' },
  },
  messages: [
    { id: '', role: 'user', content: 'Solve the coding task' },
    { id: '', role: 'assistant', channel: 'final', content: 'run-b takes a different path' },
  ],
  stats: { score: 0.4 },
})

const LONG_TRACE_FIXTURE = JSON.stringify({
  meta: {
    traceId: 'long-1',
    instanceId: 'long-1',
    component: 'stress/long',
    status: 'completed',
    timestamp: '2026-03-08T00:00:00.000Z',
    checkpointStep: 0,
    split: 'train',
    sourceFormat: 'native',
  },
  messages: [
    // 5 × ~6.5k chars — the joined head alone exceeds the old 20k cap.
    ...Array.from({ length: 5 }, () => ({
      id: '',
      role: 'user',
      content: 'fillertoken padding lorem '.repeat(250),
    })),
    {
      id: '',
      role: 'assistant',
      channel: 'commentary',
      content: 'the elusive xylocarp appears only here at the very end',
      toolCalls: [
        {
          id: 'tc-1',
          name: 'grep_tool',
          arguments: '{"pattern":"quokkagrep"',
          parseError: 'Unexpected end of JSON input zebrafail',
        },
      ],
    },
  ],
})

describe('run scoping and per-message search', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    const store = new TraceStore()
    for (const fixture of [NATIVE_FIXTURE, RUN_B_FIXTURE, LONG_TRACE_FIXTURE]) {
      const result = parseAny(fixture, { fallbackTimestamp: SEED_FALLBACK_TS })
      for (const parsed of result.traces) store.upsert(parsed)
    }
    app = createApp({ store, importDir, dataRoots: [scanRoot] })
  })

  it('GET /api/evolution/:instanceId?run= keeps rollouts within one run', async () => {
    const runA = await request(app).get('/api/evolution/lc-i01?run=run-a')
    expect(runA.status).toBe(200)
    expect(runA.body.points.map((p: { step: number }) => p.step)).toEqual([100, 200])
    expect(
      runA.body.points[0].rollouts.map((s: { meta: { traceId: string } }) => s.meta.traceId),
    ).toEqual(['lc-i01-s100-r01', 'lc-i01-s100-r02']) // b- trace excluded

    const runB = await request(app).get('/api/evolution/lc-i01?run=run-b')
    expect(runB.body.points.map((p: { step: number }) => p.step)).toEqual([100])
    expect(
      runB.body.points[0].rollouts.map((s: { meta: { traceId: string } }) => s.meta.traceId),
    ).toEqual(['b-lc-i01-s100-r01'])

    // No ?run= keeps the legacy all-runs union.
    const all = await request(app).get('/api/evolution/lc-i01')
    expect(all.body.points[0].rollouts).toHaveLength(3)
    // A run with no rollouts for the instance is a 404, not an empty series.
    const missing = await request(app).get('/api/evolution/lc-i01?run=run-z')
    expect(missing.status).toBe(404)
  })

  it('GET /api/traces/:id/siblings excludes cross-run rollouts', async () => {
    const runA = await request(app).get('/api/traces/lc-i01-s100-r02/siblings')
    expect(runA.body.map((s: { meta: { traceId: string } }) => s.meta.traceId)).toEqual([
      'lc-i01-s100-r01',
    ])
    const runB = await request(app).get('/api/traces/b-lc-i01-s100-r01/siblings')
    expect(runB.body).toEqual([])
  })

  it('GET /api/aggregates/components applies run filters but ignores component conditions', async () => {
    const runB = await request(app).get('/api/aggregates/components?filters=run.eq.run-b')
    expect(runB.body).toHaveLength(1)
    expect(runB.body[0]).toMatchObject({
      component: 'code/leetcode',
      split: 'train',
      count: 1,
      avgScore: 0.4,
    })

    // Component conditions (exact param and DSL) are dropped: the table keeps
    // showing every component under the run-a selection.
    const runA = await request(app).get(
      '/api/aggregates/components?component=stress%2Flong&filters=run.eq.run-a;component.eq.stress%2Flong',
    )
    const rows = runA.body.map((r: { component: string; split: string; count: number }) => [
      r.component,
      r.split,
      r.count,
    ])
    expect(rows).toEqual([
      ['code/leetcode', 'train', 2], // run-b rollout excluded
      ['code/leetcode', 'test', 1],
      ['stress/long', 'train', 1],
    ])
  })

  it('GET /api/aggregates/curves applies run filters but ignores split/step conditions', async () => {
    const all = await request(app).get('/api/aggregates/curves')
    expect(all.body.train).toHaveLength(1)
    expect(all.body.train[0]).toMatchObject({ step: 100, count: 3 })
    expect(all.body.train[0].avgScore).toBeCloseTo((0.8 + 0.2 + 0.4) / 3, 10)

    const runA = await request(app).get(
      '/api/aggregates/curves?filters=run.eq.run-a%3Bsplit.eq.train%3Bstep.eq.100',
    )
    // run-b excluded; the split/step conditions are dropped so both series survive.
    expect(runA.body.train).toEqual([{ step: 100, avgScore: 0.5, count: 2 }])
    expect(runA.body.test).toEqual([{ step: 200, avgScore: 0.6, count: 1 }])
  })

  it('GET /api/search reaches late messages, tool calls and parse errors, one hit per trace', async () => {
    const late = await request(app).get('/api/search?q=xylocarp')
    expect(late.body.map((h: { traceId: string }) => h.traceId)).toEqual(['long-1'])
    expect(late.body[0].snippet).toContain('xylocarp')

    const toolArg = await request(app).get('/api/search?q=quokkagrep')
    expect(toolArg.body.map((h: { traceId: string }) => h.traceId)).toEqual(['long-1'])

    const parseErr = await request(app).get('/api/search?q=zebrafail')
    expect(parseErr.body.map((h: { traceId: string }) => h.traceId)).toEqual(['long-1'])

    // 5 matching messages in one trace still dedupe to a single hit,
    // and the q= list membership stays trace-unique.
    const filler = await request(app).get('/api/search?q=fillertoken')
    expect(filler.body).toHaveLength(1)
    const list = await request(app).get('/api/traces?q=xylocarp')
    expect(list.body.total).toBe(1)
  })
})
