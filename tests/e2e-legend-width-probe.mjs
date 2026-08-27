// E2E width probe for the /find legend+finder container (task t_ba814f62).
//
// The legend used to be capped at max-width: 1076px, which binds as soon as
// the content column (viewport − 280px nav − 84px gutters) exceeds 1076px,
// i.e. viewport > 1440px. On wide desktops (or 80-90% zoom where the CSS
// viewport balloons past 1920px) that left a dead strip on the right of the
// legend body.
//
// This probe measures the gap between the right edge of .legend-body and the
// right edge of the content box (the page's usable column) and asserts:
//   - 1440px viewport (scrollbar-width control): legend fills, gap ≈ 0
//   - 1920px viewport: legend fills, gap ≈ 0   ← the regression guard
//   - 2400px viewport (≈80% zoom on a 1920 desktop): legend still grows but
//     stays under the 1760px sane cap (no edge-to-edge full-bleed text)
//   - 390px mobile: no horizontal overflow, legend fits the content box,
//     single-column stack unchanged
//
// Usage: node tests/e2e-legend-width-probe.mjs [baseUrl]

import { chromium as chromiumPkg } from 'playwright'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join as pjoin } from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:4174'

const failures = []
const pass = (label) => console.log(`  ok  ${label}`)
const fail = (label, detail = '') => {
  failures.push(label)
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}
const section = (s) => console.log(`\n## ${s}`)

// ── Chromium bootstrap (system chromium; npm playwright revision is absent) ──

const candidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  pjoin(homedir(), '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'),
  pjoin(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
  '/home/smolpanda/.nix-profile/bin/chromium',
].filter(Boolean)

let browser = null
for (const exe of candidates) {
  if (!existsSync(exe)) continue
  try {
    browser = await chromiumPkg.launch({ executablePath: exe, args: ['--no-sandbox'] })
    console.log(`  (launched chromium: ${exe})`)
    break
  } catch (err) {
    console.log(`  (launch failed for ${exe}: ${String(err.message).split('\n')[0]})`)
  }
}
if (!browser) {
  console.error('No usable chromium binary found')
  process.exit(2)
}

// ── Measurement ─────────────────────────────────────────────────────────────
//
// Returns { legendW, legendRight, contentRight, gap, scrollW } where gap is
// the dead space between the legend body's right edge and the content box's
// right edge (the page's usable column, i.e. border-box minus right padding).
async function measure(page) {
  await page.goto(`${BASE}/find`, { waitUntil: 'domcontentloaded' })
  // Legend lives at the results header (DESIGN.md §/find.5) — search first.
  // The Svelte client mounts async; typing before the input's on:input binds
  // silently fills the DOM value and never triggers the FK-map lazy load, so
  // no suggestions render. Retry once if the first attempt produced none.
  await page.waitForSelector('.find-btn', { state: 'visible', timeout: 15000 })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForTimeout(800)
    await page.click('#source-input')
    await page.type('#source-input', 'InventTable', { delay: 10 })
    const ok = await page
      .locator('.suggestions li')
      .first()
      .waitFor({ state: 'visible', timeout: 12000 })
      .then(() => true)
      .catch(() => false)
    if (ok) break
    await page.evaluate(() => { document.querySelector('#source-input').value = '' })
  }
  await page.locator('.suggestions li').first().click()
  await page.click('#target-input')
  await page.type('#target-input', 'CustTable', { delay: 10 })
  await page.locator('.suggestions li').first().waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('.suggestions li').first().click()
  await page.getByRole('button', { name: 'Find paths' }).click()
  await page.waitForSelector('.path-list li', { timeout: 30000 })
  await page.locator('.legend-summary').click()
  await page.waitForSelector('details.legend[open]', { timeout: 2500 })
  return page.evaluate(() => {
    const body = document.querySelector('.legend-body')
    const content = document.querySelector('.content')
    const bodyBox = body.getBoundingClientRect()
    const contentBox = content.getBoundingClientRect()
    const padRight = parseFloat(getComputedStyle(content).paddingRight)
    const contentRight = contentBox.right - padRight
    return {
      legendW: Math.round(bodyBox.width),
      legendRight: Math.round(bodyBox.right),
      contentRight: Math.round(contentRight),
      gap: Math.round(contentRight - bodyBox.right),
      scrollW: document.documentElement.scrollWidth,
      viewportW: window.innerWidth,
    }
  })
}

section('legend/finder fills the content column (no right-side dead space)')

const results = []
for (const viewport of [
  { width: 1440, height: 900, label: '1440 (100% zoom control)' },
  { width: 1920, height: 1080, label: '1920 (wide desktop)' },
  { width: 2400, height: 1200, label: '2400 (~80% zoom on 1920)' },
]) {
  const p = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
  const errors = []
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  p.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))
  const m = await measure(p)
  results.push({ label: viewport.label, ...m })

  const tag = `legend width @ ${viewport.label}`
  console.log(`  ${viewport.label}: legendW=${m.legendW}px contentRight=${m.contentRight}px gap=${m.gap}px (${m.viewportW}px vp)`)

  if (m.gap < 0) {
    fail(`${tag}: legend overflows content column`, `gap=${m.gap}px`)
  } else {
    // Usable column = viewport − 260px nav (DESIGN.md) − 84px gutters. When it
    // fits under the 1760px ceiling the legend must fill it (gap ≈ 0); beyond
    // the cap a gutter is the intended anti-full-bleed behavior.
    const usable = m.viewportW - 260 - 84
    if (usable <= 1760 && m.gap > 4) {
      fail(`${tag}: unused right margin`, `legend ends ${m.gap}px short of the content column`)
    } else if (usable > 1760 && Math.abs(m.gap - (usable - 1760)) > 2) {
      fail(`${tag}: cap slack wrong`, `gap=${m.gap}px expected ${usable - 1760}px vs 1760px cap`)
    } else {
      pass(`${tag}: fills column or caps at 1760px ceiling (gap ${m.gap}px, usable ${usable}px)`)
    }
  }

  // Sane cap: at very wide viewports the legend must not balloon full-bleed.
  if (m.legendW > 1761) fail(`${tag}: exceeds 1760px sane cap`, `legendW=${m.legendW}px`)
  else pass(`${tag}: within 1760px sane cap (legendW=${m.legendW}px)`)

  if (errors.filter((e) => !e.includes('favicon')).length) fail(`${tag}: no page errors`, errors.join(' | '))
  else pass(`${tag}: no page errors`)

  await p.close()
}

// Mobile: 390px must be untouched — single column, fits, no overflow.
{
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  p.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))
  const m = await measure(p)
  results.push({ label: '390 (mobile)', ...m })
  console.log(`  390: legendW=${m.legendW}px contentRight=${m.contentRight}px gap=${m.gap}px scrollW=${m.scrollW}px`)

  // Legend must fit the content box. Page-level scrollW on this page already
  // overshoots the viewport by 4px on the pre-fix tree (off-canvas nav +
  // finder-form width), so guard the legend strictly and allow that known
  // 4px page overshoot; the point is that OUR change adds nothing.
  if (m.gap < -1 || m.scrollW > m.viewportW + 6) {
    fail('mobile 390px: no horizontal overflow', `gap=${m.gap}px scrollW=${m.scrollW}px (vp ${m.viewportW}px)`)
  } else pass(`mobile 390px: no horizontal overflow (gap ${m.gap}px, scrollW=${m.scrollW}px)`)

  const xs = await p.evaluate(() => {
    const boxes = [...document.querySelectorAll('.legend-group')].map((el) => Math.round(el.getBoundingClientRect().x))
    return new Set(boxes).size
  })
  if (xs !== 1) fail('mobile 390px: single-column stack unchanged', `distinct x=${xs}`)
  else pass('mobile 390px: single-column stack unchanged')

  if (errors.filter((e) => !e.includes('favicon')).length) fail('mobile 390px: no page errors', errors.join(' | '))
  else pass('mobile 390px: no page errors')

  await p.close()
}

await browser.close()

console.log('\n## width measurements')
for (const r of results) {
  console.log(`  ${r.label}: legendW=${r.legendW}px gap=${r.gap}px scrollW=${r.scrollW}px`)
}

console.log(`\n=== ${failures.length ? `FAILED (${failures.length})` : 'ALL PASSED'} ===`)
process.exit(failures.length ? 1 : 0)