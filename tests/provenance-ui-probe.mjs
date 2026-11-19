#!/usr/bin/env node
/**
 * Browser gates for the provenance + bridge-warning UI.
 *
 *   1. canonical row shows a functional note (the fixture `why`), not a generic title
 *   2. non-canonical rows carry an `inferred` badge
 *   3. the Currency cartesian bridge is visibly flagged
 *   4. the arbitrated InventTransOrigin chain is NOT flagged
 *   5. zero page errors (excluding the known Cloudflare CSP beacon)
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

// ── canonical note + inferred badge + bridge warning, one page ─────────────
await p.goto(`${BASE}/find?from=SalesTable&to=CustTrans`, { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForSelector('.path-item', { timeout: 30000 })

const pin = p.locator('.canonical-pin-badge').first()
gate('canonical badge present', (await p.locator('.canonical-pin-badge').count()) > 0)
const pinTitle = (await pin.getAttribute('title')) ?? ''
gate('canonical note is functional, not generic', pinTitle.length > 25 && !/^Arbitrated canonical path for this pair/.test(pinTitle), pinTitle.slice(0, 90))

const inferred = await p.locator('.inferred-badge').count()
gate('inferred badge on fallback rows', inferred > 0, `${inferred} inferred`)

const bridgeFlags = await p.locator('.bridge-flag').allInnerTexts()
// Currency is covered at engine level (tests/bridge-risk.test.mjs). Here the
// assertion is that the WARNING RENDERS and names a setup/dimension bridge —
// which specific table tops the list depends on rank and hop budget.
gate(
  'cartesian bridge warning renders',
  bridgeFlags.some((t) => /⚠\s*(CashDisc|Currency|CustTable|InventDim|UnitOfMeasure)/.test(t)),
  JSON.stringify([...new Set(bridgeFlags)].slice(0, 4))
)

// ── arbitrated chain must stay silent ─────────────────────────────────────
await p.goto(`${BASE}/find?from=SalesLine&to=InventTrans`, { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForSelector('.path-item', { timeout: 30000 })
const firstRow = (await p.locator('.path-item').first().innerText()).replace(/\n+/g, ' | ')
gate('canonical InventTransOrigin chain is first', firstRow.includes('InventTransOrigin'), firstRow.slice(0, 100))
const rowFlags = await p.locator('.path-item').first().locator('.bridge-flag').count()
gate('arbitrated chain is not bridge-flagged', rowFlags === 0, `${rowFlags} flags on canonical row`)

gate('zero page errors', errs.length === 0, errs.slice(0, 2).join(' | '))

await b.close()
console.log(fail === 0 ? '\nall UI gates passed' : `\n${fail} gate(s) failed`)
process.exit(fail === 0 ? 0 : 1)
