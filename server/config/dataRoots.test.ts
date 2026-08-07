import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DATA_ROOTS,
  loadLocalDataRoots,
  PROJECT_ROOT,
  parseDataRootSpec,
  resolveDataRoots,
} from './dataRoots'

describe('data root configuration', () => {
  it('keeps repository defaults and resolves relative extras from a stable base', () => {
    const base = path.join(PROJECT_ROOT, 'config-test-base')
    const roots = resolveDataRoots(
      [`work-trial=${path.join(base, 'external')}`, 'relative-corpus'].join(path.delimiter),
      base,
    )

    expect(roots.slice(0, 2)).toEqual(DEFAULT_DATA_ROOTS)
    expect(parseDataRootSpec(roots[2])).toEqual({
      run: 'work-trial',
      path: path.join(base, 'external'),
    })
    expect(parseDataRootSpec(roots[3])).toEqual({ path: path.join(base, 'relative-corpus') })
  })

  it('lets an environment entry label an existing default without scanning it twice', () => {
    const roots = resolveDataRoots(`custom=${DEFAULT_DATA_ROOTS[0]}`)

    const matching = roots.filter((spec) => parseDataRootSpec(spec).path === DEFAULT_DATA_ROOTS[0])
    expect(matching).toHaveLength(1)
    expect(parseDataRootSpec(matching[0])).toEqual({
      run: 'custom',
      path: DEFAULT_DATA_ROOTS[0],
    })
  })

  it('keeps sibling ACE discovery additive when TRACE_DATA_ROOTS is set', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'tv-ace-roots-'))
    const custom = path.join(fixture, 'custom')
    const aceProject = path.join(fixture, 'ac_express')
    const corpus = path.join(aceProject, 'data')
    const episodes = path.join(aceProject, 'runs', 'episodes')
    mkdirSync(custom)
    mkdirSync(corpus, { recursive: true })
    mkdirSync(episodes, { recursive: true })

    try {
      const roots = resolveDataRoots(`custom-run=${custom}`, PROJECT_ROOT, {
        aceProjectRoot: aceProject,
      }).map((spec) => parseDataRootSpec(spec))

      expect(roots).toContainEqual({ path: custom, run: 'custom-run' })
      expect(roots).toContainEqual({ path: corpus, run: 'production' })
      expect(roots).toContainEqual({ path: episodes })
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('rejects an empty labelled path', () => {
    expect(() => parseDataRootSpec('work-trial=')).toThrow('invalid data root')
  })

  it('loads the versioned local registry and keeps environment labels authoritative', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'tv-local-roots-'))
    const registry = path.join(fixture, 'data-roots.json')
    const corpus = path.join(fixture, 'corpus')
    mkdirSync(corpus)
    writeFileSync(registry, JSON.stringify({ schemaVersion: 1, roots: [`saved=${corpus}`] }))
    try {
      const saved = loadLocalDataRoots(registry)
      expect(saved).toEqual([`saved=${corpus}`])
      const roots = resolveDataRoots(`environment=${corpus}`, PROJECT_ROOT, {
        persistedRoots: saved,
        aceProjectRoot: path.join(fixture, 'missing-ace'),
      })
      expect(parseDataRootSpec(roots.find((spec) => spec.includes(corpus)) as string)).toEqual({
        path: corpus,
        run: 'environment',
      })
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('rejects an invalid local registry instead of silently scanning arbitrary content', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'tv-local-roots-invalid-'))
    const registry = path.join(fixture, 'data-roots.json')
    writeFileSync(registry, JSON.stringify({ roots: ['/tmp'] }))
    try {
      expect(() => loadLocalDataRoots(registry)).toThrow('schemaVersion 1')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
