import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'tv.theme'

function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Current theme: stored preference if any, else the OS color-scheme. */
export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return prefersDark() ? 'dark' : 'light'
}

/** Reflect a theme onto <html data-theme> so CSS variables switch. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
}

/** Persist and apply a theme, notifying any mounted useTheme() hooks. */
export function setTheme(theme: Theme): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
  window.dispatchEvent(new CustomEvent<Theme>('tv:theme', { detail: theme }))
}

/** Read + control the active theme; stays in sync across all consumers. */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>(getTheme)

  useEffect(() => {
    const onChange = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail)
    window.addEventListener('tv:theme', onChange)
    return () => window.removeEventListener('tv:theme', onChange)
  }, [])

  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme])

  return { theme, setTheme, toggle }
}
