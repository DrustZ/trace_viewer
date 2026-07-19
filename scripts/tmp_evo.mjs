import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/trace/swebench-i01-s275-r03?tab=evolution', { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="evolution-tab"]')
await page.waitForTimeout(800)
await page.screenshot({ path: '/tmp/v05_evolution.png' })
// click another rollout (r01) — expect route navigation
await page.click('[data-testid="evolution-rollout-swebench-i01-s275-r01"]')
await page.waitForTimeout(800)
console.log('url after rollout click:', page.url())
if (errs.length) console.log('PAGEERRORS:', errs.join('; '))
await browser.close()
