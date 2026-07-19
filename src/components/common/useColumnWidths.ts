import { useCallback, useState } from 'react'

/** Minimum column width in px a user can drag a column down to. */
export const MIN_COL_WIDTH = 60

const KEY_PREFIX = 'tv.cols.'

export function colStorageKey(tableId: string): string {
  return `${KEY_PREFIX}${tableId}`
}

export function clampColWidth(w: number): number {
  return Math.max(MIN_COL_WIDTH, Math.round(w))
}

/** Merge persisted widths over defaults, clamping and ignoring junk. */
export function loadColumnWidths(
  tableId: string,
  defaults: Record<string, number>,
): Record<string, number> {
  const out = { ...defaults }
  try {
    const raw = localStorage.getItem(colStorageKey(tableId))
    if (!raw) return out
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const id of Object.keys(defaults)) {
      const v = parsed?.[id]
      if (typeof v === 'number' && Number.isFinite(v)) out[id] = clampColWidth(v)
    }
  } catch {
    // corrupt storage → fall back to defaults
  }
  return out
}

export function saveColumnWidths(tableId: string, widths: Record<string, number>): void {
  try {
    localStorage.setItem(colStorageKey(tableId), JSON.stringify(widths))
  } catch {
    // storage unavailable / quota — non-fatal
  }
}

/** Restore a single column to its default width. */
export function applyReset(
  widths: Record<string, number>,
  colId: string,
  defaults: Record<string, number>,
): Record<string, number> {
  return { ...widths, [colId]: defaults[colId] ?? MIN_COL_WIDTH }
}

export interface ColumnWidths {
  widths: Record<string, number>
  startResize: (colId: string, e: React.PointerEvent) => void
  resetCol: (colId: string) => void
}

/**
 * Per-column pixel widths persisted to localStorage under `tv.cols.<tableId>`.
 * `startResize` drags a column live via window pointer events (min {@link MIN_COL_WIDTH}px)
 * and persists on release; `resetCol` (double-click a handle) restores the default.
 */
export function useColumnWidths(tableId: string, defaults: Record<string, number>): ColumnWidths {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    loadColumnWidths(tableId, defaults),
  )

  const startResize = useCallback(
    (colId: string, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startWidth = widths[colId] ?? defaults[colId] ?? MIN_COL_WIDTH
      const onMove = (ev: PointerEvent) => {
        setWidths((prev) => ({
          ...prev,
          [colId]: clampColWidth(startWidth + (ev.clientX - startX)),
        }))
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setWidths((prev) => {
          saveColumnWidths(tableId, prev)
          return prev
        })
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [widths, defaults, tableId],
  )

  const resetCol = useCallback(
    (colId: string) => {
      setWidths((prev) => {
        const next = applyReset(prev, colId, defaults)
        saveColumnWidths(tableId, next)
        return next
      })
    },
    [defaults, tableId],
  )

  return { widths, startResize, resetCol }
}
