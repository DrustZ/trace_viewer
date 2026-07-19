import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors: string[] = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`) })
await page.goto('http://localhost:5173/?group=instance', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const groups = page.locator('[data-testid="group-row"]')
await groups.first().scrollIntoViewIfNeeded()
console.log('group rows:', await groups.count())
console.log('first group:', (await groups.first().innerText()).replace(/\n/g, ' | ').slice(0, 200))
// expand the first group
const toggle = page.locator('[data-testid="group-toggle"]').first()
if (await toggle.count()) { await toggle.click() } else { await groups.first().click() }
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/w1_group.png' })
// checkpoint chips text
const chips = await page.locator('[data-testid="group-row"]').first().innerText()
console.log('after expand first group:', chips.replace(/\n/g, ' | ').slice(0, 250))
console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
