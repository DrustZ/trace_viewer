import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import NavRail, { NAV_RAIL_MORE, NAV_RAIL_PRIMARY, navRailActivePath } from './NavRail'

function render(pathname: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[pathname]}>
      <NavRail />
    </MemoryRouter>,
  )
}

function activeLinks(html: string): string[] {
  return [...html.matchAll(/<a[^>]*aria-current="page"[^>]*href="([^"]*)"/g)].map(
    (match) => match[1],
  )
}

describe('NavRail', () => {
  it('renders the five workspaces plus the More group', () => {
    const html = render('/')
    for (const item of [...NAV_RAIL_PRIMARY, ...NAV_RAIL_MORE]) {
      expect(html).toContain(`>${item.label}</span>`)
      expect(html).toContain(`href="${item.to}"`)
    }
    expect(html).toContain('>More<')
  })

  it('highlights exactly the item owning the current route', () => {
    expect(activeLinks(render('/'))).toEqual(['/'])
    expect(activeLinks(render('/ace'))).toEqual(['/ace'])
    expect(activeLinks(render('/ace/experiments'))).toEqual(['/ace/experiments'])
    expect(activeLinks(render('/reviews'))).toEqual(['/reviews'])
  })

  it('maps nested and detail routes to their owning workspace', () => {
    expect(navRailActivePath('/trace/abc%2Fdef')).toBe('/')
    expect(navRailActivePath('/ace/tasks/scenario-42')).toBe('/ace/tasks')
    expect(navRailActivePath('/ace/lab/')).toBe('/ace/lab')
    expect(navRailActivePath('/ace/analysis')).toBe('/ace/analysis')
    expect(navRailActivePath('/compare')).toBe('/compare')
    expect(navRailActivePath('/nowhere')).toBe('')
  })
})

describe('page-level nav rows are gone (NavRail is the only map)', () => {
  const pagesDir = path.resolve(__dirname, '../../pages')
  const pages = [
    'HomePage.tsx',
    'AceRunsPage.tsx',
    'AceTasksPage.tsx',
    'AceAnalysisPage.tsx',
    'AceExperimentsPage.tsx',
    'AceInteractiveLabPage.tsx',
    'ReviewPage.tsx',
  ]

  it.each(pages)('%s no longer builds its own header link row', (page) => {
    const source = readFileSync(path.join(pagesDir, page), 'utf8')
    expect(source).not.toContain('← Traces')
    expect(source).not.toMatch(/>\s*Interactive lab\s*<\/Link>/)
    expect(source).not.toMatch(/>\s*Experiment matrix\s*<\/Link>/)
    expect(source).not.toMatch(/>\s*Task explorer\s*<\/Link>/)
    expect(source).not.toMatch(/>\s*Human review\s*<\/Link>/)
    expect(source).not.toMatch(/>\s*Aggregate analysis\s*<\/Link>/)
    expect(source).not.toMatch(/>\s*A\/B matrix\s*<\/Link>/)
    expect(source).not.toMatch(/>\s*ACE runs\s*<\/Link>/)
  })
})
