import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/trace/swebench-i01-s275-r01', { waitUntil: 'networkidle' })
await page.click('[data-testid="toggle-timeline"]')
await page.waitForSelector('[data-testid="timeline-minimap"]')
const before = await page.evaluate(() => {
  const els = [document.scrollingElement, ...document.querySelectorAll('*')]
  return els.filter(e => e && e.scrollHeight > e.clientHeight + 50).map(e => e.scrollTop)
})
const bars = page.locator('[data-testid="timeline-minimap"] button')
const n = await bars.count()
await bars.nth(n - 1).click()
await page.waitForTimeout(700)
const after = await page.evaluate(() => {
  const els = [document.scrollingElement, ...document.querySelectorAll('*')]
  return els.filter(e => e && e.scrollHeight > e.clientHeight + 50).map(e => e.scrollTop)
})
console.log('minimap bars:', n)
console.log('scrollTops before:', JSON.stringify(before), 'after:', JSON.stringify(after))
console.log('scrolled:', JSON.stringify(before) !== JSON.stringify(after))
if (errs.length) console.log('PAGEERRORS:', errs.join('; '))
await browser.close()
