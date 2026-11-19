#!/usr/bin/env node
/**
 * Filter contract: every control must change what the user sees.
 *
 * The defect this gate exists for: clicking a tier or rank control changed
 * nothing until "Find paths" was pressed again, so all four controls appeared
 * broken. And `minTier: A` deleted the arbitrated canonical chain for 10 of 37
 * pairs because those chains contain a C or D hop.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const BASE = process.argv[2] ?? 'http://127.0.0.1:5199'
const b = await chromium.launch({ executablePath: '/home/smolpanda/.nix-profile/bin/chromium', args: ['--no-sandbox'] })
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
p.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('cloudflareinsights')) errs.push('console: ' + m.text())
})

let fail = 0
const gate = (name, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

const snapshot = async () => ({
  rows: await p.locator('.path-item').count(),
  first: (await p.locator('.path-item').first().innerText()).replace(/\n+/g, ' ').slice(0, 64),
  first3: (await p.locator('.path-item').evaluateAll((els) =>
    els.slice(0, 3).map((e) => e.innerText.replace(/\n+/g, ' ').slice(0, 50))
  )).join(' // '),
  // tier chips of NON-canonical rows only: the pinned chain is exempt from
  // minTier by design (it carries the arbitrated answer, which may include a
  // C or D hop), so including it would test the wrong thing.
  chips: [
    ...new Set(
      await p.locator('.path-item:not(:has(.canonical-pin-badge)) .tier-chip').allInnerTexts()
    ),
  ]
    .sort()
    .join(''),
  canon: await p.locator('.canonical-pin-badge').count(),
})

await p.goto(`${BASE}/find?from=SalesTable&to=CustTrans`, { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForSelector('.path-item', { timeout: 30000 })
await p.waitForTimeout(700)

// ── defaults are A + Story ────────────────────────────────────────────────
const aPressed = await p.locator('button[aria-pressed="true"]:has-text("A · joinable")').count()
const storyPressed = await p.locator('button[aria-pressed="true"]:has-text("Story")').count()
gate('default minimum join is A', aPressed === 1)
gate('default rank is Story', storyPressed === 1)

const d0 = await snapshot()
gate('canonical chain visible at default A', d0.canon > 0, `${d0.canon} pinned · ${d0.first}`)
gate('A default shows only tier-A hops (canonical chain exempt)', !/[BCD]/.test(d0.chips), `non-canonical chips=${d0.chips}`)

// ── clicking a tier changes the result set WITHOUT pressing Find ──────────
await p.locator('button:has-text("D · all")').click()
await p.waitForTimeout(1400)
const d1 = await snapshot()
gate('tier click re-runs automatically', d1.first !== d0.first || d1.chips !== d0.chips, `${d0.chips} → ${d1.chips}`)
gate('D · all admits weaker hops', /[BCD]/.test(d1.chips), `chips=${d1.chips}`)

// ── rank toggle changes ordering ─────────────────────────────────────────
await p.locator('button:has-text("Evidence")').click()
await p.waitForTimeout(1400)
const d2 = await snapshot()
// The pinned canonical row is #1 under BOTH rankers (that is the point of
// pinning), so the toggle must be judged on the rows BELOW it.
gate(
  'rank toggle reorders the inferred rows',
  d2.first3 !== d1.first3,
  `story="${d1.first3.slice(0, 60)}" evidence="${d2.first3.slice(0, 60)}"`
)

// ── back to Story: canonical pin restored and first ──────────────────────
await p.locator('button:has-text("Story")').click()
await p.waitForTimeout(1400)
const d3 = await snapshot()
gate('Story restores canonical chain first', d3.canon > 0 && /CustInvoiceJour/.test(d3.first), d3.first)

// ── max hops changes enumeration ─────────────────────────────────────────
const before = await snapshot()
// max hops is a button group, and it re-runs on click like the other filters —
// pressing "Find paths" is no longer required.
await p.locator('button[aria-pressed]:has-text("2")').first().click()
await p.waitForTimeout(1600)
const after = await snapshot()
gate('max hops affects the result set', after.rows !== before.rows || after.first !== before.first, `${before.rows} → ${after.rows} rows`)

gate('zero page errors', errs.length === 0, errs.slice(0, 2).join(' | '))

await b.close()
console.log(fail === 0 ? '\nall filter gates passed' : `\n${fail} gate(s) failed`)
process.exit(fail === 0 ? 0 : 1)
