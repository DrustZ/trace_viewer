import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://localhost:5173/trace/nemotron-i03-s300-r03?tab=evolution', { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="evolution-chart"]')
const box = await page.locator('[data-testid="evolution-chart"]').boundingBox()
let t = ''
for (const fx of [0.3, 0.5, 0.7]) {
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.45, { steps: 8 })
  await page.waitForTimeout(250)
  t = (await page.locator('.recharts-tooltip-wrapper').innerText().catch(() => '')).trim()
  if (t) break
}
console.log(JSON.stringify({ tooltip: t.replace(/\n/g, ' | ') }))
await browser.close()
