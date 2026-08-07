import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig } from 'playwright/test'

const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export default defineConfig({
  testDir: './e2e',
  outputDir: path.join(tmpdir(), 'trace-viewer-playwright-results'),
  fullyParallel: true,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: existsSync(localChrome) ? 'chrome' : undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${JSON.stringify(process.execPath)} node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
