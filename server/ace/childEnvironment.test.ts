import { describe, expect, it } from 'vitest'
import { aceChildEnvironment } from './childEnvironment'

describe('ACE child environment', () => {
  it('keeps provider/runtime values but strips Viewer access credentials', () => {
    expect(
      aceChildEnvironment({
        ANTHROPIC_API_KEY: 'provider-key',
        PYTHONPATH: '/workspace',
        TRACE_VIEWER_ACCESS_TOKEN: 'viewer-secret',
        TRACE_VIEWER_ACCESS_TOKEN_FILE: '/private/token-file',
      }),
    ).toEqual({ ANTHROPIC_API_KEY: 'provider-key', PYTHONPATH: '/workspace' })
  })
})
