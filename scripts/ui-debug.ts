/**
 * Headless UI debug harness — navigate the running app, capture a screenshot,
 * and report console output / page errors / failed requests.
 *
 * Usage:
 *   npx tsx scripts/ui-debug.ts [path] [--out /tmp/shot.png] [--base http://localhost:5173]
 *     [--width 1440] [--height 900] [--wait 500] [--click "css selector"] [--full]
 *
 * Exit code 1 when the page produced errors — usable as a smoke check.
 */
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: '/tmp/trace-viewer-ui.png' },
    base: { type: 'string', default: 'http://localhost:5173' },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '900' },
    wait: { type: 'string', default: '600' },
    click: { type: 'string', multiple: true },
    full: { type: 'boolean', default: false },
  },
})

const path = positionals[0] ?? '/'
const url = new URL(path, values.base).toString()

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: Number(values.width), height: Number(values.height) },
})

const consoleLines: string[] = []
const errors: string[] = []
page.on('console', (msg) => {
  const line = `[console.${msg.type()}] ${msg.text()}`
  consoleLines.push(line)
  if (msg.type() === 'error') errors.push(line)
})
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`))
page.on('requestfailed', (req) => {
  if (!req.url().includes('favicon')) {
    errors.push(`[requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`)
  }
})
page.on('response', (res) => {
  if (res.status() >= 400) errors.push(`[http ${res.status()}] ${res.url()}`)
})

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 })
} catch (err) {
  console.error(`NAVIGATION FAILED: ${url}\n${(err as Error).message}`)
  await browser.close()
  process.exit(1)
}

for (const selector of values.click ?? []) {
  try {
    await page.click(selector, { timeout: 3_000 })
    await page.waitForTimeout(300)
    consoleLines.push(`[clicked] ${selector}`)
  } catch {
    errors.push(`[clickfailed] ${selector}`)
  }
}

await page.waitForTimeout(Number(values.wait))
await page.screenshot({ path: values.out, fullPage: values.full })

const title = await page.title()
await browser.close()

console.log(`url: ${url}`)
console.log(`title: ${title}`)
console.log(`screenshot: ${values.out}`)
if (consoleLines.length > 0) console.log(`\nconsole (${consoleLines.length}):\n${consoleLines.slice(0, 40).join('\n')}`)
if (errors.length > 0) {
  console.log(`\nERRORS (${errors.length}):\n${errors.join('\n')}`)
  process.exit(1)
}
console.log('\nno page errors')
