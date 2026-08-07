import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

export interface NavRailItem {
  label: string
  to: string
}

/** The five workspaces — one job each (see docs/redesign_2026-08-07.md). */
export const NAV_RAIL_PRIMARY: NavRailItem[] = [
  { label: 'Traces', to: '/' },
  { label: 'Runs', to: '/ace' },
  { label: 'Experiments', to: '/ace/experiments' },
  { label: 'Playground', to: '/ace/lab' },
  { label: 'Reviews', to: '/reviews' },
]

/** Secondary destinations kept reachable but out of the main five. */
export const NAV_RAIL_MORE: NavRailItem[] = [
  { label: 'Tasks', to: '/ace/tasks' },
  { label: 'Analysis', to: '/ace/analysis' },
  { label: 'Compare', to: '/compare' },
]

const COLLAPSE_KEY = 'tv.navRailCollapsed'

/**
 * Which nav item owns a pathname. Longest-prefix wins so /ace/tasks/foo maps
 * to Tasks, not Runs; trace detail pages belong to the Traces workspace.
 */
export function navRailActivePath(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (path === '/' || path === '/trace' || path.startsWith('/trace/')) return '/'
  let best = ''
  for (const item of [...NAV_RAIL_PRIMARY, ...NAV_RAIL_MORE]) {
    if (item.to === '/') continue
    if ((path === item.to || path.startsWith(`${item.to}/`)) && item.to.length > best.length) {
      best = item.to
    }
  }
  return best
}

function NavIcon({ label }: { label: string }) {
  const path =
    {
      Traces: 'M4 6h16M4 12h16M4 18h10',
      Runs: 'M12 3a9 9 0 1 0 9 9M10 8l6 4-6 4z',
      Experiments: 'M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 3h8',
      Playground: 'M7 8l-4 4 4 4M17 8l4 4-4 4M13 5l-2 14',
      Reviews: 'M9 12l2 2 4-5M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z',
      Tasks: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
      Analysis: 'M4 20V10M10 20V4M16 20v-7M20 20H4',
      Compare: 'M8 7H3l3-3M3 7l3 3M16 17h5l-3-3M21 17l-3 3M12 3v18',
    }[label] ?? 'M12 5v14M5 12h14'
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}

function NavItem({
  item,
  active,
  collapsed,
}: {
  item: NavRailItem
  active: boolean
  collapsed: boolean
}) {
  return (
    <Link
      to={item.to}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
        active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
      } ${collapsed ? 'justify-center' : ''}`}
    >
      <NavIcon label={item.label} />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  )
}

/**
 * Persistent left navigation: the single global map of the app. Collapsible to
 * an icon strip; the current workspace is highlighted. Dark theme follows the
 * global utility remap in index.css. Bottom padding clears the fixed
 * ThemeToggle anchored bottom-left.
 */
export default function NavRail() {
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(COLLAPSE_KEY) === '1',
  )
  const active = navRailActivePath(pathname)
  const toggle = () =>
    setCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* storage unavailable (private mode / SSR) — collapse stays in-memory */
      }
      return next
    })

  return (
    <nav
      aria-label="Primary"
      data-testid="nav-rail"
      className={`sticky top-0 z-40 flex h-screen shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-slate-200 bg-white px-1.5 pb-14 pt-2 ${
        collapsed ? 'w-12' : 'w-44'
      }`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        className={`mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600 ${
          collapsed ? 'justify-center' : ''
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
        </svg>
        {collapsed ? null : (
          <span className="text-[10px] font-semibold uppercase tracking-wide">Trace Viewer</span>
        )}
      </button>
      {NAV_RAIL_PRIMARY.map((item) => (
        <NavItem key={item.to} item={item} active={active === item.to} collapsed={collapsed} />
      ))}
      {collapsed ? (
        <div className="mx-2 my-2 border-t border-slate-200" role="presentation" />
      ) : (
        <div className="mb-1 mt-4 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          More
        </div>
      )}
      {NAV_RAIL_MORE.map((item) => (
        <NavItem key={item.to} item={item} active={active === item.to} collapsed={collapsed} />
      ))}
    </nav>
  )
}
