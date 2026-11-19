#!/usr/bin/env node
/**
 * Browser verification of the shipped gates. Real interaction, not DOM presence.
 *
 * GATES
 *   1. canonical chain for SalesTable->CustTrans renders FIRST and is badged
 *   2. a chain that schema rank buries (InventTable->InventDim) is still pinned first
 *   3. Copy X++ works and the snippet is a legal select-join
 *   4. zero page errors
 *
 * Run against a dev server: node tests/tiered-find-probe.mjs [baseUrl]
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
  if (m.type() === 'error') errs.push('console: ' + m.text())
})

let fail = 0
const gate = (name, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

// ── gate 1: canonical chain first ─────────────────────────────────────────
await p.goto(`${BASE}/find?from=SalesTable&to=CustTrans`, { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForSelector('.path-item', { timeout: 30000 })
const firstRow = (await p.locator('.path-item').first().innerText()).replace(/\n+/g, ' | ')
const hasPin = (await p.locator('.canonical-pin-badge').count()) > 0
gate('canonical chain renders first', firstRow.includes('CustInvoiceJour'), firstRow.slice(0, 90))
gate('canonical row is badged', hasPin)

// ── gate 2: pinned despite schema rank ────────────────────────────────────
await p.goto(`${BASE}/find?from=InventTable&to=InventDim`, { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForSelector('.path-item', { timeout: 30000 })
const dimRow = (await p.locator('.path-item').first().innerText()).replace(/\n+/g, ' | ')
gate('buried canonical chain is pinned first', dimRow.includes('InventSum'), dimRow.slice(0, 90))

// ── gate 3: Copy X++ ──────────────────────────────────────────────────────
await p.goto(`${BASE}/find?from=SalesTable&to=CustTrans`, { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForSelector('.path-item', { timeout: 30000 })
await p.context().grantPermissions(['clipboard-read', 'clipboard-write'])
const copyBtn = p.locator('.copy-xpp-btn').first()
if (await copyBtn.count()) {
  await copyBtn.click()
  await p.waitForTimeout(350)
  const clip = await p.evaluate(() => navigator.clipboard.readText())
  gate('Copy X++ yields a select-join', /^select \w+/.test(clip) && clip.includes('join') && clip.trim().endsWith(';'), JSON.stringify(clip.split('\n')[0]))
  gate('button confirms copy', (await copyBtn.innerText()).toLowerCase().includes('copied'))
} else {
  gate('Copy X++ button present', false, 'no joinable path in result set')
}

// ── gate 4: provenance + controls ─────────────────────────────────────────
const notice = (await p.locator('.graph-notice').innerText()).replace(/\n+/g, ' ')
gate('provenance names the six flows', /six core/i.test(notice), notice.slice(0, 80))
const controls = await p.locator('.sort-btn').allInnerTexts()
gate('tier + rank controls present', controls.length >= 6, JSON.stringify(controls))

gate('zero page errors', errs.length === 0, errs.slice(0, 2).join(' | '))

await b.close()
console.log(fail === 0 ? '\nall gates passed' : `\n${fail} gate(s) failed`)
process.exit(fail === 0 ? 0 : 1)
