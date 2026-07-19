import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyReset,
  clampColWidth,
  colStorageKey,
  loadColumnWidths,
  MIN_COL_WIDTH,
  saveColumnWidths,
} from './useColumnWidths'

const DEFAULTS = { traceId: 260, instance: 150, status: 120 }

// Minimal Map-backed localStorage stub (vitest runs in the node environment).
function installLocalStorage() {
  const store = new Map<string, string>()
  const mock = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = mock
  return store
}

beforeEach(() => {
  installLocalStorage()
})

afterEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = undefined
})

describe('useColumnWidths helpers', () => {
  it('returns default widths when nothing is stored', () => {
    expect(loadColumnWidths('traces', DEFAULTS)).toEqual(DEFAULTS)
  })

  it('clamps widths to the minimum', () => {
    expect(clampColWidth(10)).toBe(MIN_COL_WIDTH)
    expect(clampColWidth(4.6)).toBe(MIN_COL_WIDTH)
    expect(clampColWidth(300.4)).toBe(300)
    // stored below-min values are clamped on load
    saveColumnWidths('traces', { ...DEFAULTS, instance: 10 })
    expect(loadColumnWidths('traces', DEFAULTS).instance).toBe(MIN_COL_WIDTH)
  })

  it('reset restores a column to its default', () => {
    const custom = { ...DEFAULTS, traceId: 500 }
    expect(applyReset(custom, 'traceId', DEFAULTS)).toEqual(DEFAULTS)
  })

  it('round-trips through persistence', () => {
    const custom = { traceId: 320, instance: 90, status: 200 }
    saveColumnWidths('traces', custom)
    expect(localStorage.getItem(colStorageKey('traces'))).toBe(JSON.stringify(custom))
    expect(loadColumnWidths('traces', DEFAULTS)).toEqual(custom)
  })

  it('ignores corrupt storage and non-numeric fields', () => {
    localStorage.setItem(colStorageKey('traces'), '{ not json')
    expect(loadColumnWidths('traces', DEFAULTS)).toEqual(DEFAULTS)
    saveColumnWidths('traces', { traceId: 'wide' } as unknown as Record<string, number>)
    expect(loadColumnWidths('traces', DEFAULTS).traceId).toBe(DEFAULTS.traceId)
  })
})
