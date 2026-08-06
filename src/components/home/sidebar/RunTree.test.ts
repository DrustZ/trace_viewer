import { describe, expect, it } from 'vitest'
import { runOptions } from './RunTree'

describe('runOptions', () => {
  it('uses discovered runs instead of a hard-coded allowlist', () => {
    expect(
      runOptions([{ run: 'work-trial', count: 334, avgScore: null }], '').map((item) => item.run),
    ).toEqual(['work-trial'])
  })

  it('preserves a selected deep-linked run while it is undiscovered', () => {
    const options = runOptions([{ run: 'run-a', count: 2, avgScore: 0.5 }], 'work-trial')
    expect(options).toEqual([
      { run: 'run-a', count: 2, avgScore: 0.5, discovered: true },
      { run: 'work-trial', count: 0, avgScore: null, discovered: false },
    ])
  })
})
