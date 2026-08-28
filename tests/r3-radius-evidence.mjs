#!/usr/bin/env node
/** r3 evidence capture: interactive radius = sm(6px) on /tables and /tables/[name], both themes. */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire('/home/smolpanda/e2e-tools/package.json')
const { chromium } = require('playwright')

const BASE = process.argv[2] || 'http://127.0.0.1:4173'
const OUT = 'artifacts/design-audit/shots/r3'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/home/smolpanda/.local/bin/chromium-fhs',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
})

const shots = []
const radiusChecks = []
for (const theme of ['dark', 'light']) {
  for (const [label, path] of [
    ['tables', '/tables'],
    ['tables-name', '/tables/InventTable'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.emulateMedia({ colorScheme: theme })
    await page.addInitScript((t) => localStorage.setItem('theme', t), theme)
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    const f = `${OUT}/${label}-${theme}.png`
    await page.screenshot({ path: f, fullPage: false })
    shots.push(f)

    // radius assertions on interactive elements present on this page
    const sel = label === 'tables'
      ? ['.mod-pill', '.table-chip', '.flow-link', '.flow-list a']
      : ['.toc-pill', '.cat-pill', '.rel-sort-btn', '.trace-link', '.rel-source']
    const res = await page.evaluate((sels) => {
      const out = []
      for (const s of sels) {
        const el = document.querySelector(s)
        if (!el) continue
        out.push({ sel: s, radius: getComputedStyle(el).borderRadius, cls: el.className })
      }
      return out
    }, sel)
    radiusChecks.push({ theme, label, results: res })
    console.log(`${theme} ${label}:`, JSON.stringify(res))
    await page.close()
  }
}
await browser.close()
const bad = radiusChecks.flatMap((c) =>
  c.results.filter((r) => r.radius !== '6px').map((r) => `${c.theme}/${c.label} ${r.sel} = ${r.radius}`))
console.log(bad.length ? `BAD: ${bad.join('; ')}` : `ALL ${radiusChecks.flatMap((c) => c.results).length} interactive elements = 6px`)
console.log(`shots: ${shots.join(', ')}`)
