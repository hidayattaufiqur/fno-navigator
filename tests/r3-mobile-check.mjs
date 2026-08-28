#!/usr/bin/env node
/** r3 mobile 390px check: no horizontal overflow + interactive radius = 6px. */
import { createRequire } from 'node:module'
const require = createRequire('/home/smolpanda/e2e-tools/package.json')
const { chromium } = require('playwright')

const BASE = process.argv[2] || 'http://localhost:4173'
const browser = await chromium.launch({
  executablePath: '/home/smolpanda/.local/bin/chromium-fhs',
  args: ['--no-sandbox'],
})
for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.emulateMedia({ colorScheme: theme })
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme)
  await page.goto(`${BASE}/tables/InventTable`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const r = await page.evaluate(() => {
    const sels = ['.toc-pill', '.cat-pill', '.rel-sort-btn', '.trace-link', '.rel-source']
    return sels.map((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).borderRadius : null }).filter(Boolean)
  })
  console.log(theme, 'overflowX:', overflow, 'radii:', r.join(','))
  await page.screenshot({ path: `artifacts/design-audit/shots/r3/tables-name-mob-${theme}.png` })
  await page.close()
}
await browser.close()
