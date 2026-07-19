import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runGenerate, traceIdPrefix } from './generate'

const SEED = 42
const SCALE = 0.15

// The four runs mirror generateAll.ts (one seed per run) but at a small scale so
// the tree generates fast. traceId prefixing and instanceId sharing are
// independent of scale, so this still exercises the per-run-folder guarantees.
const RUNS = [
  { run: 'run-a', seed: 42 },
  { run: 'run-b', seed: 43 },
  { run: 'run-c', seed: 44 },
  { run: 'run-d', seed: 45 },
] as const

function walk(dir: string, base = dir): string[] {
  const out: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )
  for (const entry of entries) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p, base))
    else out.push(relative(base, p))
  }
  return out
}

function sha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

interface NativeTrace {
  meta: {
    traceId: string
    instanceId: string
    checkpointStep: number
    status: string
    extra?: Record<string, unknown>
  }
  messages: unknown[]
}

/** Parsed native traces of a run dir (excludes the intentionally-corrupt file). */
function nativeTraces(dir: string): Array<{ rel: string; trace: NativeTrace }> {
  return walk(dir)
    .filter(
      (f) => f.startsWith('native/') && f.endsWith('.json') && !f.endsWith('corrupt-example.json'),
    )
    .map((rel) => ({ rel, trace: JSON.parse(readFileSync(join(dir, rel), 'utf8')) as NativeTrace }))
}

describe('generator', () => {
  // base/<run> per-run folders + a second run-a copy for the determinism check.
  let base: string
  let dirA: string
  let dirADup: string

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'trace-gen-'))
    for (const { run, seed } of RUNS) {
      runGenerate({ seed, out: join(base, run), scale: SCALE, runName: run, quiet: true })
    }
    dirA = join(base, 'run-a')
    dirADup = mkdtempSync(join(tmpdir(), 'trace-gen-dup-'))
    runGenerate({ seed: SEED, out: dirADup, scale: SCALE, runName: 'run-a', quiet: true })
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
    rmSync(dirADup, { recursive: true, force: true })
  })

  it('same seed produces a byte-identical output tree', () => {
    const filesA = walk(dirA)
    const filesB = walk(dirADup)
    expect(filesA.length).toBeGreaterThan(0)
    expect(filesA).toEqual(filesB)
    for (const rel of filesA) {
      expect(sha1(join(dirA, rel)), rel).toBe(sha1(join(dirADup, rel)))
    }
  })

  it('native output parses and manifest counts match the file tree', () => {
    const files = walk(dirA)
    const traces = nativeTraces(dirA)
    const harmonyTexts = files.filter((f) => f.startsWith('harmony/') && f.endsWith('.txt'))
    const sidecars = files.filter((f) => f.endsWith('.meta.json'))
    const openaiFiles = files.filter(
      (f) => f.startsWith('openai/') && f.endsWith('.json') && !f.endsWith('.meta.json'),
    )

    for (const { rel, trace } of traces) {
      expect(typeof trace.meta.traceId, rel).toBe('string')
      expect(trace.meta.traceId.length, rel).toBeGreaterThan(0)
      expect(Array.isArray(trace.messages), rel).toBe(true)
    }

    const manifest = JSON.parse(readFileSync(join(dirA, 'manifest.json'), 'utf8'))
    expect(manifest.seed).toBe(SEED)
    expect(manifest.counts.total).toBe(traces.length + harmonyTexts.length + openaiFiles.length)
    // Both harmony and openai showcase traces now emit a .meta.json sidecar.
    expect(sidecars.length).toBe(harmonyTexts.length + openaiFiles.length)
    expect(manifest.showcase.harmony.length).toBe(harmonyTexts.length)
    expect(manifest.showcase.openai.length).toBe(openaiFiles.length)
    const componentSum = Object.values(
      manifest.counts.byComponent as Record<string, number>,
    ).reduce((a, b) => a + b, 0)
    expect(componentSum).toBe(manifest.counts.total)
    // In-flight rollouts exist only at the training frontier (the newest
    // checkpoint); small scales may have a single candidate there.
    expect(manifest.counts.byStatus.executing).toBeGreaterThanOrEqual(1)
    expect(manifest.counts.byStatus.executing).toBeLessThanOrEqual(2)
    const executing = traces.map(({ trace }) => trace).filter((t) => t.meta.status === 'executing')
    const maxStep = Math.max(...traces.map(({ trace }) => trace.meta.checkpointStep as number))
    for (const t of executing) expect(t.meta.checkpointStep).toBe(maxStep)
    expect(manifest.huge_trace).toBe('termbench-ihuge-s150-r01')

    const corrupt = readFileSync(join(dirA, 'native/corrupt-example.json'), 'utf8')
    expect(() => JSON.parse(corrupt)).toThrow()
  })

  it('stamps meta.extra.run and a numeric format_errors on every native trace', () => {
    for (const { rel, trace } of nativeTraces(dirA)) {
      expect(trace.meta.extra?.run, rel).toBe('run-a')
      expect(typeof trace.meta.extra?.format_errors, rel).toBe('number')
    }
  })

  it('every native trace carries meta.extra.spans with exactly one root', () => {
    const traces = nativeTraces(dirA)
    expect(traces.length).toBeGreaterThan(0)
    for (const { rel, trace } of traces) {
      const spans = trace.meta.extra?.spans
      expect(Array.isArray(spans), rel).toBe(true)
      const roots = (spans as Array<{ parentId: string | null; name: string }>).filter(
        (s) => s.parentId === null,
      )
      expect(roots.length, rel).toBe(1)
      expect(roots[0].name, rel).toBe(trace.meta.traceId)
    }
  })

  it('generates run-a..run-d folders, each with traces and its own run stamp', () => {
    for (const { run } of RUNS) {
      const dir = join(base, run)
      expect(existsSync(dir), run).toBe(true)
      const traces = nativeTraces(dir)
      expect(traces.length, run).toBeGreaterThan(0)
      for (const { rel, trace } of traces) {
        expect(trace.meta.extra?.run, rel).toBe(run)
      }
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
      expect(manifest.run).toBe(run)
    }
  })

  it('prefixes traceIds per run (run-a bare, b-/c-/d- otherwise) but keeps instanceIds shared', () => {
    // run-a is bare; others carry their single-letter dash prefix.
    expect(traceIdPrefix('run-a')).toBe('')
    expect(traceIdPrefix('run-b')).toBe('b-')
    expect(traceIdPrefix('run-c')).toBe('c-')
    expect(traceIdPrefix('run-d')).toBe('d-')

    const otherPrefixes = ['b-', 'c-', 'd-']
    const instanceSets: Array<Set<string>> = []
    for (const { run } of RUNS) {
      const prefix = traceIdPrefix(run)
      const instanceIds = new Set<string>()
      for (const { rel, trace } of nativeTraces(join(base, run))) {
        expect(trace.meta.traceId.startsWith(prefix), rel).toBe(true)
        if (run === 'run-a') {
          for (const p of otherPrefixes) expect(trace.meta.traceId.startsWith(p), rel).toBe(false)
        }
        // instanceIds are never prefixed — that is the cross-run join key.
        for (const p of otherPrefixes) expect(trace.meta.instanceId.startsWith(p), rel).toBe(false)
        instanceIds.add(trace.meta.instanceId)
      }
      instanceSets.push(instanceIds)
    }

    // The same instanceIds appear across every run (unprefixed => shareable).
    const shared = instanceSets.reduce((acc, set) => new Set([...acc].filter((id) => set.has(id))))
    expect(shared.size).toBeGreaterThan(0)
  })
})
