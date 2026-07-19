import { useCallback, useRef, useState } from 'react'

const KEY_PREFIX = 'tv.pane.'

export interface ResizeOptions {
  default: number
  min: number
  max: number
}

export interface ResizableWidth {
  width: number
  startResize: (e: React.PointerEvent) => void
  reset: () => void
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v)))

function paneStorageKey(key: string): string {
  return `${KEY_PREFIX}${key}`
}

function loadWidth(key: string, { default: def, min, max }: ResizeOptions): number {
  try {
    const raw = localStorage.getItem(paneStorageKey(key))
    if (raw === null) return def
    const n = Number(raw)
    return Number.isFinite(n) ? clamp(n, min, max) : def
  } catch {
    return def
  }
}

/**
 * Live pixel width for a resizable pane, persisted to localStorage under
 * `tv.pane.<key>`. `startResize` (pointerdown on the edge handle) drags the width
 * via window pointer events clamped to [min, max] and persists on release;
 * `reset` (double-click the handle) restores the default.
 */
export function useResizableWidth(key: string, opts: ResizeOptions): ResizableWidth {
  const { default: def, min, max } = opts
  const [width, setWidth] = useState<number>(() => loadWidth(key, opts))
  const widthRef = useRef(width)
  widthRef.current = width

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = widthRef.current
      const onMove = (ev: PointerEvent) => {
        setWidth(clamp(startWidth + (ev.clientX - startX), min, max))
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        try {
          localStorage.setItem(paneStorageKey(key), String(widthRef.current))
        } catch {
          // storage unavailable / quota — non-fatal
        }
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [key, min, max],
  )

  const reset = useCallback(() => {
    setWidth(def)
    try {
      localStorage.setItem(paneStorageKey(key), String(def))
    } catch {
      // storage unavailable / quota — non-fatal
    }
  }, [key, def])

  return { width, startResize, reset }
}
