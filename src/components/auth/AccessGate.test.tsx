import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AccessPrompt } from './AccessGate'

describe('AccessPrompt', () => {
  it('clearly asks for a token without exposing or persisting it', () => {
    const html = renderToStaticMarkup(<AccessPrompt busy={false} error={null} onUnlock={vi.fn()} />)

    expect(html).toContain('Trace Viewer is locked')
    expect(html).toContain('type="password"')
    expect(html).toContain('Paste token')
    expect(html).toContain('HttpOnly browser session')
    expect(html).toContain('not saved in local storage')
    expect(html).toContain('Unlock Trace Viewer')
  })

  it('shows failed authentication feedback and a busy state', () => {
    const html = renderToStaticMarkup(
      <AccessPrompt busy error="invalid access token" onUnlock={vi.fn()} />,
    )

    expect(html).toContain('invalid access token')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Unlocking…')
    expect(html).toContain('disabled=""')
  })
})
