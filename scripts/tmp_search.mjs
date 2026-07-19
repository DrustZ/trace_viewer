import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/trace/swebench-i01-s275-r01', { waitUntil: 'networkidle' })
const input = page.locator('[data-testid="trace-search"]')
await input.click()
await input.fill('pytest')
await page.waitForTimeout(600)
const count = await page.locator('[data-testid="search-count"]').textContent()
console.log('match count text:', JSON.stringify(count))
const before = await page.evaluate(() => {
  const els = [document.scrollingElement, ...document.querySelectorAll('*')]
  return els.filter(e => e && e.scrollHeight > e.clientHeight + 50).map(e => e.scrollTop)
})
await input.press('Enter')
await page.waitForTimeout(700)
const after = await page.evaluate(() => {
  const els = [document.scrollingElement, ...document.querySelectorAll('*')]
  return els.filter(e => e && e.scrollHeight > e.clientHeight + 50).map(e => e.scrollTop)
})
console.log('scroll before:', JSON.stringify(before), 'after:', JSON.stringify(after))
const marks = await page.locator('mark').count()
console.log('highlight marks visible:', marks)
await page.screenshot({ path: '/tmp/v05_search.png' })
if (errs.length) console.log('PAGEERRORS:', errs.join('; '))
await browser.close()
