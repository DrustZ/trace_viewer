import type { Trace } from '@shared/schema/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StateToolsTab } from './StateToolsTab'

describe('StateToolsTab', () => {
  it('separates model-visible and actual results for an unknown write outcome', () => {
    const trace = {
      evaluation: {
        worldDiff: [],
        ledger: [
          {
            name: 'issue_refund',
            args: { order_id: 'order_1' },
            result: 'Error: response was lost',
            actualResult: { success: true, refund_id: 'refund_1' },
            ok: false,
            executed: true,
            outcomeKnown: false,
          },
        ],
      },
    } as unknown as Trace

    const html = renderToStaticMarkup(<StateToolsTab trace={trace} />)
    expect(html).toContain('Unknown tool outcome')
    expect(html).toContain('Model-visible result')
    expect(html).toContain('Actual tool outcome')
    expect(html).toContain('response was lost')
    expect(html).toContain('refund_1')
  })
})
