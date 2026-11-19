#!/usr/bin/env node
/**
 * Back-navigation must never leave a stale or blank page.
 *
 * TWO DEFECTS THIS GATES (both reported 2026-11-19):
 *   A. Find a path, press browser back → stuck on /find, results gone, page
 *      looks unchanged so the back press appears to do nothing.
 *   B. From /find click a table in a path, press back → the URL returns to /find
 *      but the DOM is still the TABLE page: 0 finder controls, h2 still the table
 *      name. The find component threw during remount and never replaced it.
 *
 * Root cause of B: the module-level store restored `pathResults`, whose
 * `steps[].edge` objects point into a graph that is not loaded on a fresh mount.
 * A step with no table name made roleOf/isPlumbingTable throw, killing the
 * component mid-render.
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
  if (m.type() === 'error' && !m.text().includes('cloudflareinsights')) errs.push('console: ' + m.text().slice(0, 100))
})

let fail = 0
const gate = (name, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

const FIND = '/find?from=SalesLine&to=SalesTable'

// ── A: back to /find keeps a usable page ──────────────────────────────────
await p.goto(BASE + FIND, { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForSelector('.path-item', { timeout: 30000 })
await p.goto(BASE + '/', { waitUntil: 'networkidle' })
await p.goBack()
await p.waitForTimeout(2200)
const controlsA = await p.locator('.finder-controls').count()
const rowsA = await p.locator('.path-item').count()
gate('A: back to /find renders the form', controlsA > 0, `${controlsA} control groups`)
gate('A: back to /find restores results', rowsA > 0, `${rowsA} rows`)

// ── B: table page → back → find page, not a stale table DOM ───────────────
await p.goto(BASE + FIND, { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForSelector('.path-item', { timeout: 30000 })
const link = p.locator('.path-item .path-table-link').first()
const href = await link.getAttribute('href')
await link.click()
await p.waitForTimeout(1600)
gate('B: table page opened', p.url().includes('/tables/'), p.url())

await p.goBack()
await p.waitForTimeout(2400)
const controlsB = await p.locator('.finder-controls').count()
const h2 = await p.locator('h2').first().innerText().catch(() => '(none)')
const rowsB = await p.locator('.path-item').count()
gate('B: back returns the finder form', controlsB > 0, `${controlsB} control groups, h2="${h2}"`)
gate('B: DOM is not the stale table page', !/^SalesLine$/.test(h2.trim()), `h2="${h2}"`)
gate('B: results re-rendered', rowsB > 0, `${rowsB} rows`)

// ── the path table link must not be a full page load that loses state ─────
gate('no page errors during navigation', errs.length === 0, errs.slice(0, 2).join(' | '))

await b.close()
console.log(fail === 0 ? '\nall navigation gates passed' : `\n${fail} gate(s) failed`)
process.exit(fail === 0 ? 0 : 1)
