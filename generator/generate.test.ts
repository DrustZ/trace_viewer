import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runGenerate } from './generate'

const SEED = 42
const SCALE = 0.15

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

describe('generator', () => {
  let dirA: string
  let dirB: string

  beforeAll(() => {
    dirA = mkdtempSync(join(tmpdir(), 'trace-gen-a-'))
    dirB = mkdtempSync(join(tmpdir(), 'trace-gen-b-'))
    runGenerate({ seed: SEED, out: dirA, scale: SCALE, quiet: true })
    runGenerate({ seed: SEED, out: dirB, scale: SCALE, quiet: true })
  })

  afterAll(() => {
    rmSync(dirA, { recursive: true, force: true })
    rmSync(dirB, { recursive: true, force: true })
  })

  it('same seed produces a byte-identical output tree', () => {
    const filesA = walk(dirA)
    const filesB = walk(dirB)
    expect(filesA.length).toBeGreaterThan(0)
    expect(filesA).toEqual(filesB)
    for (const rel of filesA) {
      expect(sha1(join(dirA, rel)), rel).toBe(sha1(join(dirB, rel)))
    }
  })

  it('native output parses and manifest counts match the file tree', () => {
    const files = walk(dirA)
    const nativeTraces = files.filter(
      (f) => f.startsWith('native/') && f.endsWith('.json') && !f.endsWith('corrupt-example.json'),
    )
    const harmonyTexts = files.filter((f) => f.startsWith('harmony/') && f.endsWith('.txt'))
    const harmonySidecars = files.filter((f) => f.endsWith('.meta.json'))
    const openaiFiles = files.filter((f) => f.startsWith('openai/') && f.endsWith('.json'))

    for (const rel of nativeTraces) {
      const trace = JSON.parse(readFileSync(join(dirA, rel), 'utf8'))
      expect(typeof trace.meta.traceId, rel).toBe('string')
      expect(trace.meta.traceId.length, rel).toBeGreaterThan(0)
      expect(Array.isArray(trace.messages), rel).toBe(true)
    }

    const manifest = JSON.parse(readFileSync(join(dirA, 'manifest.json'), 'utf8'))
    expect(manifest.seed).toBe(SEED)
    expect(manifest.counts.total).toBe(
      nativeTraces.length + harmonyTexts.length + openaiFiles.length,
    )
    expect(harmonySidecars.length).toBe(harmonyTexts.length)
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
    const executing = nativeTraces
      .map((rel) => JSON.parse(readFileSync(join(dirA, rel), 'utf8')))
      .filter((t) => t.meta.status === 'executing')
    const maxStep = Math.max(
      ...nativeTraces.map(
        (rel) => JSON.parse(readFileSync(join(dirA, rel), 'utf8')).meta.checkpointStep as number,
      ),
    )
    for (const t of executing) expect(t.meta.checkpointStep).toBe(maxStep)
    expect(manifest.huge_trace).toBe('termbench-ihuge-s150-r01')

    const corrupt = readFileSync(join(dirA, 'native/corrupt-example.json'), 'utf8')
    expect(() => JSON.parse(corrupt)).toThrow()
  })

  it('every native trace carries meta.extra.spans with exactly one root', () => {
    const nativeTraces = walk(dirA).filter(
      (f) => f.startsWith('native/') && f.endsWith('.json') && !f.endsWith('corrupt-example.json'),
    )
    expect(nativeTraces.length).toBeGreaterThan(0)
    for (const rel of nativeTraces) {
      const trace = JSON.parse(readFileSync(join(dirA, rel), 'utf8'))
      const spans = trace.meta.extra?.spans
      expect(Array.isArray(spans), rel).toBe(true)
      const roots = (spans as Array<{ parentId: string | null; name: string }>).filter(
        (s) => s.parentId === null,
      )
      expect(roots.length, rel).toBe(1)
      expect(roots[0].name, rel).toBe(trace.meta.traceId)
    }
  })
})
