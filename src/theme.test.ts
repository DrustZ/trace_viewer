import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, getTheme, setTheme } from './theme'

function stubEnv(opts: { stored?: string | null; prefersDark?: boolean } = {}) {
  const store = new Map<string, string>()
  if (opts.stored != null) store.set('tv.theme', opts.stored)
  const dataset: Record<string, string> = {}
  const win = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    matchMedia: (q: string) => ({ matches: q.includes('dark') && !!opts.prefersDark }),
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('localStorage', win.localStorage)
  vi.stubGlobal('matchMedia', win.matchMedia)
  vi.stubGlobal('document', { documentElement: { dataset } })
  vi.stubGlobal('CustomEvent', class {})
  return { store, dataset, win }
}

afterEach(() => vi.unstubAllGlobals())

describe('theme', () => {
  it('returns the stored preference when present', () => {
    stubEnv({ stored: 'dark', prefersDark: false })
    expect(getTheme()).toBe('dark')
  })

  it('falls back to the OS preference when nothing is stored', () => {
    stubEnv({ stored: null, prefersDark: true })
    expect(getTheme()).toBe('dark')
    stubEnv({ stored: null, prefersDark: false })
    expect(getTheme()).toBe('light')
  })

  it('ignores an invalid stored value', () => {
    stubEnv({ stored: 'purple', prefersDark: false })
    expect(getTheme()).toBe('light')
  })

  it('applyTheme writes the data-theme attribute', () => {
    const { dataset } = stubEnv()
    applyTheme('dark')
    expect(dataset.theme).toBe('dark')
  })

  it('setTheme persists, applies, and notifies', () => {
    const { store, dataset, win } = stubEnv({ stored: null })
    setTheme('dark')
    expect(store.get('tv.theme')).toBe('dark')
    expect(dataset.theme).toBe('dark')
    expect(win.dispatchEvent).toHaveBeenCalledOnce()
  })
})
