import { describe, expect, it } from 'vitest'
import { corpusVersionChanged } from './RunStatusBar'

describe('RunStatusBar corpus invalidation', () => {
  it('invalidates for the first observed corpus and every later dataVersion mutation', () => {
    expect(corpusVersionChanged(undefined, 1)).toBe(true)
    expect(corpusVersionChanged(1, 2)).toBe(true)
    expect(corpusVersionChanged(2, 2)).toBe(false)
    expect(corpusVersionChanged(2, undefined)).toBe(false)
  })

  it('does not depend on full-scan state, so watcher-only changes are not missed', () => {
    const scanning = false
    expect(scanning).toBe(false)
    expect(corpusVersionChanged(10, 11)).toBe(true)
  })
})
