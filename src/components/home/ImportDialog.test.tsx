import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { URL_IMPORT_LOCAL_ONLY_NOTICE, UrlImportInput } from './ImportDialog'

describe('ImportDialog URL security guidance', () => {
  it('renders the shared-server restriction beside the URL field', () => {
    const html = renderToStaticMarkup(
      <UrlImportInput value="" onChange={vi.fn()} onSubmit={vi.fn()} />,
    )

    expect(html).toContain('type="url"')
    expect(html).toContain(URL_IMPORT_LOCAL_ONLY_NOTICE)
    expect(html).toContain('URL fetch is localhost-only')
    expect(html).toContain('use File or Paste')
  })
})
