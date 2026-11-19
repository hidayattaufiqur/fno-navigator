#!/usr/bin/env node
/**
 * Legend + copy gate: the shipped page must show the tiered-engine vocabulary,
 * not the retired pathScoring.js vocabulary.
 *
 * Regression this exists for: the old deck documented qualityClass, weighted
 * score, reason chips and a sampled search — none of which exist. A reader
 * learned the wrong system from "What do badges mean?".
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

await p.goto(`${BASE}/find?from=SalesTable&to=CustTrans`, { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForSelector('.path-item', { timeout: 30000 })
await p.waitForTimeout(600)

// ── legend content ────────────────────────────────────────────────────────
await p.locator('.legend-summary').click()
await p.waitForTimeout(250)
const legend = await p.locator('.legend-body').innerText()
const headings = await p.locator('.legend-group-heading').allInnerTexts()
const sections = await p.locator('.legend-section-title').allInnerTexts()

gate('legend has 3 groups', headings.length === 3, JSON.stringify(headings))
gate('legend has 10 sections', sections.length === 10, `${sections.length}`)
// Headings render upper-cased by CSS, so compare case-insensitively.
gate(
  'group 2 renamed to Join quality',
  headings.some((h) => h.trim().toLowerCase() === 'join quality'),
  JSON.stringify(headings)
)

const mustHave = ['canonical', 'inferred', 'Tier chips', 'Weakest hop', 'Bridge warnings', 'Copy X++', 'Story', 'Evidence']
for (const term of mustHave) gate(`legend explains "${term}"`, legend.includes(term))

const mustNotHave = ['qualityClass', 'weighted score', 'Business flow', 'cleanest path', 'reason chip', 'Search space sampled', 'class-3']
for (const dead of mustNotHave)
  gate(`retired vocabulary gone: "${dead}"`, !legend.toLowerCase().includes(dead.toLowerCase()))

// ── live page strings ─────────────────────────────────────────────────────
const lede = await p.locator('header .lede').innerText().catch(() => '')
gate('lede names the AOT graph, not 43,616 seed', /27,582/.test(lede) && !/43,616/.test(lede), lede.replace(/\n+/g, ' ').slice(0, 80))

// badge tooltips come from the deck
const pinTitle = (await p.locator('.canonical-pin-badge').first().getAttribute('title')) ?? ''
gate('canonical tooltip is the arbitrated why note', pinTitle.length > 20 && !/verified by a D365FO domain owner$/.test(pinTitle), pinTitle.slice(0, 70))

const inferredTitle = (await p.locator('.inferred-badge').first().getAttribute('title')) ?? ''
gate('inferred tooltip from deck', inferredTitle === 'Algorithm-ranked fallback: no arbitrated canonical chain for this pair.', inferredTitle)

const bridgeTitles = await p.locator('.bridge-flag').evaluateAll((els) => els.map((e) => e.getAttribute('title')))
gate(
  'bridge tooltips are fixed deck strings',
  bridgeTitles.length > 0 && bridgeTitles.every((t) => t === 'Both neighbours join the same field, so rows pair up freely.' || t === 'Broad setup table used as a bridge; rows may multiply.'),
  JSON.stringify([...new Set(bridgeTitles)].slice(0, 2))
)

gate('zero page errors', errs.length === 0, errs.slice(0, 2).join(' | '))

await b.close()
console.log(fail === 0 ? '\nall copy gates passed' : `\n${fail} gate(s) failed`)
process.exit(fail === 0 ? 0 : 1)
