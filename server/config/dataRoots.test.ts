import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DATA_ROOTS, PROJECT_ROOT, parseDataRootSpec, resolveDataRoots } from './dataRoots'

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

    expect(roots).toHaveLength(DEFAULT_DATA_ROOTS.length)
    expect(parseDataRootSpec(roots[0])).toEqual({
      run: 'custom',
      path: DEFAULT_DATA_ROOTS[0],
    })
  })

  it('rejects an empty labelled path', () => {
    expect(() => parseDataRootSpec('work-trial=')).toThrow('invalid data root')
  })
})
