import { describe, expect, it } from 'vitest'
import { recordedCheckpoint } from '../schema/provenance'
import { nativeConnector } from './native'

const ctx = { sourcePath: '/data/t.json', fallbackTimestamp: '2026-01-02T03:04:05.000Z' }

const fullTrace = {
  meta: {
    traceId: 't-1',
    instanceId: 'inst-1',
    component: 'swe/mini',
    status: 'failed',
    timestamp: '2025-05-05T00:00:00.000Z',
    checkpointStep: 7,
    split: 'test',
    sourceFormat: 'native',
  },
  messages: [
    { id: 'm-0', role: 'user', content: 'hi' },
    { id: 'm-1', role: 'assistant', channel: 'final', content: 'hello' },
  ],
  stats: { inputTokens: 10, outputTokens: 20 },
  warnings: ['source-side warning'],
}

describe('nativeConnector.detect', () => {
  it('accepts a single trace object', () => {
    expect(nativeConnector.detect(JSON.stringify(fullTrace))).toBe(true)
  })

  it('accepts an array of traces and JSONL', () => {
    expect(nativeConnector.detect(JSON.stringify([fullTrace]))).toBe(true)
    expect(nativeConnector.detect(`\n${JSON.stringify(fullTrace)}\n`)).toBe(true)
  })

  it('rejects openai-chat, harmony and garbage', () => {
    expect(nativeConnector.detect('{"messages":[{"role":"user","content":"x"}]}')).toBe(false)
    expect(nativeConnector.detect('<|start|>user<|message|>hi<|end|>')).toBe(false)
    expect(nativeConnector.detect('not json at all')).toBe(false)
    expect(nativeConnector.detect('')).toBe(false)
  })
})

describe('nativeConnector.parse', () => {
  it('parses a full trace and passes stats through as overrides', () => {
    const result = nativeConnector.parse(JSON.stringify(fullTrace), ctx)
    expect(result.warnings).toEqual([])
    expect(result.traces).toHaveLength(1)
    const trace = result.traces[0]
    expect(trace.meta).toMatchObject({
      traceId: 't-1',
      instanceId: 'inst-1',
      component: 'swe/mini',
      status: 'failed',
      timestamp: '2025-05-05T00:00:00.000Z',
      checkpointStep: 7,
      split: 'test',
      sourceFormat: 'native',
      dataLocation: '/data/t.json',
    })
    expect(trace.messages).toHaveLength(2)
    expect(trace.statsOverrides).toEqual({ inputTokens: 10, outputTokens: 20 })
    expect(trace.warnings).toEqual(['source-side warning'])
  })

  it('fills defaults when meta only has traceId', () => {
    const minimal = { meta: { traceId: 't-min' }, messages: [] }
    const result = nativeConnector.parse(JSON.stringify(minimal), ctx)
    expect(result.traces[0].meta).toEqual({
      traceId: 't-min',
      instanceId: 't-min',
      component: 'imported/native',
      status: 'completed',
      timestamp: '2026-01-02T03:04:05.000Z',
      checkpointStep: 0,
      split: 'train',
      sourceFormat: 'native',
      dataLocation: '/data/t.json',
      extra: { normalization: { checkpointStep: 'default' } },
    })
  })

  it('keeps an explicit native step zero real and preserves source extra', () => {
    const source = {
      ...fullTrace,
      meta: { ...fullTrace.meta, checkpointStep: 0, extra: { note: 'real initial checkpoint' } },
    }
    const trace = nativeConnector.parse(JSON.stringify(source), ctx).traces[0]
    expect(recordedCheckpoint(trace.meta)).toBe(0)
    expect(trace.meta.extra).toEqual({ note: 'real initial checkpoint' })
  })

  it('round-trips explicit unknown lifecycle and split without inventing values', () => {
    const source = {
      ...fullTrace,
      meta: { ...fullTrace.meta, status: 'unknown', split: 'unknown' },
    }
    const trace = nativeConnector.parse(JSON.stringify(source), ctx).traces[0]
    expect(trace.meta.status).toBe('unknown')
    expect(trace.meta.split).toBe('unknown')
  })

  it('uses epoch when no timestamp anywhere', () => {
    const result = nativeConnector.parse(
      JSON.stringify({ meta: { traceId: 'x' }, messages: [] }),
      {},
    )
    expect(result.traces[0].meta.timestamp).toBe('1970-01-01T00:00:00.000Z')
    expect(result.traces[0].meta.dataLocation).toBeUndefined()
  })

  it('preserves unrecognized top-level fields in meta.extra', () => {
    const withExtra = { ...fullTrace, runId: 42, notes: { a: 1 } }
    const result = nativeConnector.parse(JSON.stringify(withExtra), ctx)
    expect(result.traces[0].meta.extra).toEqual({ runId: 42, notes: { a: 1 } })
  })

  it('parses an array of traces', () => {
    const second = { meta: { traceId: 't-2' }, messages: [] }
    const result = nativeConnector.parse(JSON.stringify([fullTrace, second]), ctx)
    expect(result.traces.map((t) => t.meta.traceId)).toEqual(['t-1', 't-2'])
    expect(result.warnings).toEqual([])
  })

  it('skips malformed array entries with a warning', () => {
    const result = nativeConnector.parse(JSON.stringify([fullTrace, { nope: true }]), ctx)
    expect(result.traces).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('entry 2')
  })

  it('parses JSONL, skipping one bad line with a line-numbered warning', () => {
    const good1 = JSON.stringify({ meta: { traceId: 'l-1' }, messages: [] })
    const good2 = JSON.stringify({ meta: { traceId: 'l-2' }, messages: [] })
    const result = nativeConnector.parse(`${good1}\n{oops\n${good2}\n`, ctx)
    expect(result.traces.map((t) => t.meta.traceId)).toEqual(['l-1', 'l-2'])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('line 2')
  })

  it('never throws on garbage or empty input', () => {
    for (const bad of ['', '   ', 'total garbage', '{"meta":{},"messages":"no"}', '[1,2]']) {
      const result = nativeConnector.parse(bad, ctx)
      expect(result.traces).toEqual([])
      expect(result.warnings.length).toBeGreaterThan(0)
    }
  })
})
