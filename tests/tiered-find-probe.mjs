import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const b = await chromium.launch({ executablePath: '/home/smolpanda/.nix-profile/bin/chromium', args: ['--no-sandbox'] })
const p = await b.newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message))
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
await p.goto('http://127.0.0.1:5199/find?from=SalesTable&to=CustTrans', { waitUntil: 'networkidle' })
await p.waitForSelector('.path-item', { timeout: 20000 })
const rows = await p.locator('.path-item').count()
const first = (await p.locator('.path-item').first().innerText()).replace(/\n+/g,' | ')
const chips = await p.locator('.tier-chip').count()
const notice = await p.locator('.graph-notice').innerText()
const copyBtns = await p.locator('.copy-xpp-btn').count()
const tiers = await p.locator('.sort-btn').allInnerTexts()
console.log('rows', rows)
console.log('firstRow', first.slice(0,160))
console.log('tierChips', chips, 'copyButtons', copyBtns)
console.log('notice', notice.replace(/\n+/g,' '))
console.log('controls', JSON.stringify(tiers))
// tier filter A
await p.locator('.sort-btn', { hasText: 'A ·' }).click()
await p.waitForTimeout(600)
const rowsA = await p.locator('.path-item').count()
const chipTexts = [...new Set(await p.locator('.tier-chip').allInnerTexts())]
console.log('afterFilterA rows', rowsA, 'chips', JSON.stringify(chipTexts))
// copy X++
if (await p.locator('.copy-xpp-btn').count()) {
  await p.context().grantPermissions(['clipboard-read','clipboard-write'])
  await p.locator('.copy-xpp-btn').first().click()
  await p.waitForTimeout(300)
  const clip = await p.evaluate(() => navigator.clipboard.readText())
  console.log('clipboardHead', JSON.stringify(clip.split('\n').slice(0,3)))
  const btn = await p.locator('.copy-xpp-btn').first().innerText()
  console.log('buttonAfterClick', JSON.stringify(btn))
}
console.log('errors', errs.length ? errs.slice(0,3) : 'none')
await b.close()
