// UX round 2 baseline probe — run BEFORE the fix against the current build
// (any preview that serves the d1dbbad tables page). Captures pre-fix state:
//   - TOC pill classes + active state (expect: Graph pill permanently .toc-graph blue, no .active)
//   - TOC row vs theme-toggle bounding-rect overlap at scroll-pinned position
//   - rel-sort-btn computed styles
//   - scroll-to-top presence (expect: none)
// Usage: node tests/ux-r2-baseline.mjs http://127.0.0.1:5000
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5000'
const OUT = '/home/smolpanda/evidence/graph-ux/round2'
const fs = await import('node:fs')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/home/smolpanda/.nix-profile/bin/chromium',
  args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(`${BASE}/tables/InventTable`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const log = []
async function readState(label) {
  const s = await page.evaluate(() => {
    const pills = [...document.querySelectorAll('.toc-pill')].map((p) => ({
      text: p.textContent.trim(),
      cls: p.className,
      active: p.classList.contains('active'),
      graph: p.classList.contains('toc-graph'),
    }))
    const toc = document.querySelector('.toc-pills')
    const toggle = document.querySelector('.theme-toggle')
    const tocR = toc?.getBoundingClientRect()
    const togR = toggle?.getBoundingClientRect()
    const overlap = tocR && togR
      ? !(tocR.right <= togR.left || tocR.left >= togR.right || tocR.bottom <= togR.top || tocR.top >= togR.bottom)
      : null
    const sortBtn = document.querySelector('.rel-sort-btn')
    const modPill = document.querySelector('.mod-pill')
    const cs = (el) => el ? getComputedStyle(el) : null
    const sb = cs(sortBtn)
    const mp = cs(modPill)
    return {
      scrollY: window.scrollY,
      pills,
      tocRect: tocR ? { top: tocR.top, bottom: tocR.bottom, left: tocR.left, right: tocR.right, w: tocR.width, h: tocR.height } : null,
      toggleRect: togR ? { top: togR.top, bottom: togR.bottom, left: togR.left, right: togR.right } : null,
      overlap,
      scrollTopBtn: !!document.querySelector('.scroll-top'),
      sortBtn: sb ? { padding: sb.padding, fontSize: sb.fontSize, height: sb.height, lineHeight: sb.lineHeight, border: sb.border, borderRadius: sb.borderRadius } : null,
      modPill: mp ? { padding: mp.padding, fontSize: mp.fontSize, height: mp.height } : null,
      sections: [...document.querySelectorAll('.detail-section')].map((s) => ({
        id: s.id, top: s.getBoundingClientRect().top,
      })),
    }
  })
  log.push(`=== ${label} (scrollY=${s.scrollY}) ===\n${JSON.stringify(s, null, 1)}`)
  return s
}
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(400)
const atTop = readState('AT_TOP')
await page.screenshot({ path: `${OUT}/r2-spy-before.png` })

// 2) Scroll so TOC pins (sticky), section mid-page
await page.evaluate(() => window.scrollTo(0, 900))
await page.waitForTimeout(500)
const pinned = readState('SCROLL_900')
await page.screenshot({ path: `${OUT}/r2-overlap.png` })

// 3) Deep scroll for sort pill + scroll-top check
await page.evaluate(() => window.scrollTo(0, 2600))
await page.waitForTimeout(500)
const deep = readState('SCROLL_2600')
await page.screenshot({ path: `${OUT}/r2-sortpills-before.png` })

console.log(log.join('\n'))
fs.writeFileSync(`${OUT}/r2-baseline-state.txt`, log.join('\n') + `\n\nCONSOLE_ERRORS:\n${errors.join('\n') || '(none)'}\n`)
await browser.close()
