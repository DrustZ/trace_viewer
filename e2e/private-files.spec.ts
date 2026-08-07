import path from 'node:path'
import { expect, test } from 'playwright/test'

test('Vite never serves trace corpus files directly, including through /@fs', async ({
  request,
}) => {
  const fixture = path.resolve('data/runs/run-a/manifest.json')
  for (const url of [
    '/.trace-viewer/access-token',
    '/data/runs/run-a/manifest.json',
    `/@fs/${fixture}`,
  ]) {
    const response = await request.get(url)
    expect(response.status(), url).toBe(403)
    expect(await response.text(), url).not.toContain('base_timestamp')
  }
})
