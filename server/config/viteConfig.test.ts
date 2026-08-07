import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPrivateViewerUrl, PRIVATE_FS_DENY } from '../../vite.config'

describe('Vite private filesystem denylist', () => {
  it('preserves default secret rules and denies Viewer state plus every local corpus file', () => {
    expect(PRIVATE_FS_DENY).toEqual(
      expect.arrayContaining(['.env', '.env.*', '*.{crt,pem}', '**/.git/**']),
    )
    expect(PRIVATE_FS_DENY).toContain(`${path.resolve('.trace-viewer')}/**`)
    expect(PRIVATE_FS_DENY).toContain(`${path.resolve('data')}/**`)
  })

  it.each([
    '/data/runs/private.json',
    '/DATA/imported/private.json?download=1',
    '/.trace-viewer/access-token',
    '/%2etrace-viewer/data-roots.json',
    '/%2564ata/runs/private.json',
  ])('blocks the private direct URL %s before Vite fallback handling', (url) => {
    expect(isPrivateViewerUrl(url)).toBe(true)
  })

  it('does not block application and API URLs', () => {
    expect(isPrivateViewerUrl('/ace/tasks')).toBe(false)
    expect(isPrivateViewerUrl('/api/traces/id')).toBe(false)
    expect(isPrivateViewerUrl('/assets/index.js')).toBe(false)
  })
})
