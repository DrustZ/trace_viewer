import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Drawer from './Drawer'

describe('Drawer', () => {
  it('renders nothing while closed', () => {
    expect(
      renderToStaticMarkup(
        <Drawer open={false} onClose={() => {}} title="New run">
          <p>form body</p>
        </Drawer>,
      ),
    ).toBe('')
  })

  it('renders the titled dialog, its body, and both close affordances when open', () => {
    const html = renderToStaticMarkup(
      <Drawer open onClose={() => {}} title="New run">
        <p>form body</p>
      </Drawer>,
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="New run"')
    expect(html).toContain('>New run</h2>')
    expect(html).toContain('form body')
    expect(html).toContain('aria-label="Close drawer"')
    expect(html).toContain('aria-label="Close"')
  })
})
