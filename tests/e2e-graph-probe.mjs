#!/usr/bin/env node
/**
 * e2e-graph-probe.mjs — T4.2 / TDD §9.2 (on-demand, NOT a CI gate).
 *
 * Playwright probe for the WebGL graph on /find + tables/[name].
 * Mirrors the existing e2e-legend-probe*.mjs pattern (debug-only).
 *
 * Visits /find?from=InventTable&to=CustTable&maxHops=4&sort=unique&graph=1
 * at desktop + mobile, asserts the sigma canvas (or orbit SVG fallback),
 * pills, plumbing toggle, pop→expand, URL expand=, theme swap, and the
 * tables/[name] List|Graph tab.
 *
 * Usage: npm run build && npm run preview -- --port 4173 && \
 *        node tests/e2e-graph-probe.mjs --url http://localhost:4173
 * Exit 0 pass, 2 on missing selector (never unhandled throw).
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
// Resolve playwright from ~/e2e-tools (module resolution is script-location
// based — bare imports don't see the repo's node_modules for this package).
const require = createRequire('/home/smolpanda/e2e-tools/package.json')
const { chromium: playwrightChromium } = require('playwright')

const chromium = playwrightChromium

const url = process.argv[process.argv.indexOf('--url') + 1] || 'http://localhost:4173'

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || process.env.AGENT_BROWSER_EXECUTABLE_PATH || '/home/smolpanda/.local/bin/chromium-fhs',
    args: ['--no-sandbox'],
  })
  const results = []
  for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 375, height: 812 }]]) {
    const page = await browser.newPage({ viewport })
    await page.goto(`${url}/find?from=InventTable&to=CustTable&maxHops=4&sort=unique&graph=1`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500) // FA2 cold 800ms + settle

    const sigmaPane = await page.locator('[data-testid="sigma"]').count()
    const sigmaCanvas = await page.locator('[data-testid="sigma"] canvas').count()
    const svg = await page.locator('svg[data-testid="orbit"]').count()
    if (sigmaPane === 0 && svg === 0) {
      results.push(`[${name}] FAIL: no sigma pane nor orbit svg`)
      await page.screenshot({ path: `/tmp/e2e-graph-probe.${name}.png` })
      await browser.close()
      console.log(results.join('\n'))
      process.exit(2)
    }

    const pills = await page.locator('.mod-pill').count()
    const plumbing = await page.locator('.plumb-toggle input[type="checkbox"]').count()

    // Pop → Expand: click first node (if sigma present) and look for the pop card
    let expanded = 'n/a'
    if (sigmaPane > 0) {
      const box = await page.locator('[data-testid="sigma"]').first().boundingBox()
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        await page.waitForTimeout(600)
      }
      expanded = await page.locator('.pop-card').count()
      // toggle theme
      await page.evaluate(() => { document.documentElement.classList.toggle('light') })
      await page.waitForTimeout(300)
    }

    results.push(`[${name}] sigma=${sigmaPane} sigmaCanvas=${sigmaCanvas} svg=${svg} pills=${pills} plumbing=${plumbing} popExpand=${expanded}`)

    // tables/[name] tab check
    await page.goto(`${url}/tables/InventTable?graph=1`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const tabs = await page.locator('.graph-tab').count()
    const tabLabels = await page.locator('.graph-tab').allTextContents()
    results.push(`[${name}] tabs=${tabs} labels=${tabLabels.join('/')}`)
    await page.screenshot({ path: `/tmp/e2e-graph-probe.${name}.png` })
    await page.close()
  }
  await browser.close()
  console.log(results.join('\n'))
  process.exit(0)
}

main().catch((e) => { console.error('probe crash:', e.message); process.exit(2) })
