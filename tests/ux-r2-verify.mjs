// UX round 2 verification probe — run AFTER the fix against the new build.
// Covers all acceptance criteria with measured numbers:
//   #1 scroll-spy class transitions, #2 overlap rects, #3 scroll-top behavior,
//   #4 sort pill computed styles, plus mobile overflow + zoom hit-test.
// Usage: node tests/ux-r2-verify.mjs http://127.0.0.1:4174
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:4174'
const OUT = '/home/smolpanda/evidence/graph-ux/round2'
const fs = await import('node:fs')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/home/smolpanda/.nix-profile/bin/chromium',
  args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
})

const log = []
const errors = []
function note(s) { log.push(s); console.log(s) }

async function newPage(w, h, dark = true, path = '/tables/InventTable') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light' })
  const p = await ctx.newPage()
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1400)
  return { ctx, p }
}

function pillState(p) {
  return p.evaluate(() => ({
    pills: [...document.querySelectorAll('.toc-pill')].map((x) => ({
      t: x.textContent.trim(), active: x.classList.contains('active'), graph: x.classList.contains('toc-graph'),
    })),
    scrollY: Math.round(window.scrollY),
  }))
}

// ── #1 scroll-spy: scroll through sections, log active pill at each position ──
{
  const { ctx, p } = await newPage(1440, 900)
  await p.evaluate(() => window.scrollTo(0, 0))
  await p.waitForTimeout(400)
  note('SPY at top: ' + JSON.stringify((await pillState(p)).pills.map((x) => x.t)))
  await p.screenshot({ path: `${OUT}/r2-spy-after.png` })

  // walk down in steps, capture the active pill whenever it changes
  const seen = []
  let last = null
  const maxY = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  for (let y = 0; y <= maxY; y += 120) {
    await p.evaluate((yy) => window.scrollTo(0, yy), y)
    await p.waitForTimeout(60)
    const st = await pillState(p)
    const active = st.pills.find((x) => x.active)?.t ?? '(none)'
    if (active !== last) { seen.push(`y=${st.scrollY} → active=${active} graphPillBlue=${st.pills.find((x) => x.t === 'Graph')?.graph}`); last = active }
  }
  note('SPY transitions:\n  ' + seen.join('\n  '))

  // click a TOC pill → active + scroll target lands below sticky TOC
  await p.evaluate(() => window.scrollTo(0, 400))
  await p.waitForTimeout(200)
  await p.click('.toc-pill:nth-child(4)') // Schema FK
  await p.waitForTimeout(900)
  const afterClick = await p.evaluate(() => {
    const el = document.getElementById('section-schema')
    const r = el.getBoundingClientRect()
    const toc = document.querySelector('.toc-pills').getBoundingClientRect()
    return {
      scrollY: Math.round(window.scrollY),
      sectionTop: Math.round(r.top),
      tocHeight: Math.round(toc.height),
      activePill: [...document.querySelectorAll('.toc-pill')].find((x) => x.classList.contains('active'))?.textContent.trim(),
      headingWithin: r.top >= 0 && r.top <= toc.height + 20,
    }
  })
  note('CLICK Schema FK pill: ' + JSON.stringify(afterClick))
  await p.screenshot({ path: `${OUT}/r2-click-schema.png` })
  await ctx.close()
}

// ── #2 overlap: rect non-intersection at 1440×900 / 1280×800 / 390×844 ──
for (const [w, h] of [[1440, 900], [1280, 800], [390, 844]]) {
  const { ctx, p } = await newPage(w, h)
  const maxY = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  await p.evaluate((y) => window.scrollTo(0, y), Math.min(3000, maxY))
  await p.waitForTimeout(500)
  const r = await p.evaluate(() => {
    const pills = [...document.querySelectorAll('.toc-pill')]
    const tog = document.querySelector('.theme-toggle').getBoundingClientRect()
    const toc = document.querySelector('.toc-pills').getBoundingClientRect()
    const pillRects = pills.map((x) => { const b = x.getBoundingClientRect(); return { t: x.textContent.trim(), l: Math.round(b.left), r: Math.round(b.right) } })
    const pillOverlaps = pillRects.filter((x) => x.r > tog.left && x.l < tog.right).map((x) => x.t)
    const bandOverlaps = !(toc.right <= tog.left || toc.left >= tog.right || toc.bottom <= tog.top || toc.top >= tog.bottom)
    return {
      vw: innerWidth,
      toc: { l: Math.round(toc.left), r: Math.round(toc.right) },
      tog: { l: Math.round(tog.left), r: Math.round(tog.right) },
      pillOverlaps,
      bandOverlaps,
      docOverflow: document.documentElement.scrollWidth > innerWidth,
      scrollW: document.documentElement.scrollWidth,
    }
  })
  note(`OVERLAP ${w}x${h}: pillUnderToggle=${JSON.stringify(r.pillOverlaps)} bandUnderToggle=${r.bandOverlaps} docOverflow=${r.docOverflow} (scrollW=${r.scrollW})`)
  await ctx.close()
}

// ── #3 scroll-top: visible after 800px, click → top, hidden at top, zoom hit-test ──
{
  const { ctx, p } = await newPage(1440, 900)
  await p.evaluate(() => window.scrollTo(0, 800))
  await p.waitForTimeout(500)
  const vis = await p.evaluate(() => {
    const b = document.querySelector('.scroll-top')
    if (!b) return { exists: false }
    const r = b.getBoundingClientRect()
    return {
      exists: true, opacity: getComputedStyle(b).opacity, visible: b.classList.contains('visible'),
      inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      right: Math.round(r.right), bottom: Math.round(r.bottom),
    }
  })
  note('SCROLLTOP at 800px: ' + JSON.stringify(vis))
  await p.screenshot({ path: `${OUT}/r2-top.png` })
  await ctx.close()

  // zoom hit-test: open Graph tab (?graph=1) so zoom buttons exist
  const g = await newPage(1440, 900, true, '/tables/InventTable?graph=1')
  await g.p.waitForTimeout(2000)
  // bring the graph pane into view so the zoom buttons are on-screen
  await g.p.evaluate(() => {
    const sec = document.getElementById('section-graph')
    if (sec) sec.scrollIntoView({ block: 'center' })
  })
  await g.p.waitForTimeout(800)
  const zoomState = await g.p.evaluate(() => {
    const zi = document.querySelector('[data-testid="zoom-in"]')
    if (!zi) return { zoomPresent: false }
    const zr = zi.getBoundingClientRect()
    const fab = document.querySelector('.scroll-top')
    if (!fab) return { zoomPresent: true, fabMissing: true }
    const fr = fab.getBoundingClientRect()
    const hit = document.elementFromPoint(zr.left + zr.width / 2, zr.top + zr.height / 2)
    return {
      zoomPresent: true, zoomRect: { l: Math.round(zr.left), r: Math.round(zr.right), t: Math.round(zr.top), b: Math.round(zr.bottom) },
      fabRect: { l: Math.round(fr.left), r: Math.round(fr.right), t: Math.round(fr.top), b: Math.round(fr.bottom) },
      hitIsZoom: !!hit?.closest?.('[data-testid="zoom-in"]'),
      fabVisible: fab.classList.contains('visible'),
      zoomOnScreen: zr.top >= 0 && zr.bottom <= innerHeight,
    }
  })
  note('ZOOM hit-test: ' + JSON.stringify(zoomState))
  await g.ctx.close()

  // click scroll-top → scrollY ~0, hidden
  const c = await newPage(1440, 900)
  await c.p.evaluate(() => window.scrollTo(0, 800))
  await c.p.waitForTimeout(300)
  await c.p.click('.scroll-top')
  await c.p.waitForTimeout(1200)
  const after = await c.p.evaluate(() => ({
    scrollY: Math.round(window.scrollY),
    visible: document.querySelector('.scroll-top').classList.contains('visible'),
  }))
  note('SCROLLTOP after click: ' + JSON.stringify(after))
  await c.p.screenshot({ path: `${OUT}/r2-top-clicked.png` })
  await c.ctx.close()
}

// ── #4 sort pill sizes (before values from baseline state log) ──
{
  const { ctx, p } = await newPage(1440, 900)
  await p.evaluate(() => window.scrollTo(0, 3000))
  await p.waitForTimeout(400)
  const s = await p.evaluate(() => {
    const btn = document.querySelector('.rel-sort-btn')
    const mod = document.querySelector('.mod-pill')
    const bar = document.querySelector('.rel-sort-bar')
    const cs = (el) => el ? getComputedStyle(el) : null
    const sb = cs(btn); const mp = cs(mod)
    return {
      sortBtn: sb ? { padding: sb.padding, fontSize: sb.fontSize, height: sb.height, lineHeight: sb.lineHeight } : null,
      modPill: mp ? { padding: mp.padding, fontSize: mp.fontSize, height: mp.height } : null,
      barOverflow: bar ? bar.scrollWidth > bar.clientWidth : null,
    }
  })
  note('SORT PILLS: ' + JSON.stringify(s))
  await p.screenshot({ path: `${OUT}/r2-sortpills-after.png` })
  await ctx.close()
}

// ── #5 mobile overflow: 390px rel-sort-bar + page ──
{
  const { ctx, p } = await newPage(390, 844)
  await p.evaluate(() => window.scrollTo(0, 3000))
  await p.waitForTimeout(400)
  const m = await p.evaluate(() => {
    const bar = document.querySelector('.rel-sort-bar')
    const toc = document.querySelector('.toc-pills')
    return {
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      scrollW: document.documentElement.scrollWidth,
      barScrollW: bar.scrollWidth, barClientW: bar.clientWidth,
      barRects: [...bar.querySelectorAll('.rel-sort-btn')].map((x) => { const b = x.getBoundingClientRect(); return { t: x.textContent.trim(), l: Math.round(b.left), r: Math.round(b.right) } }),
      tocScrollW: toc.scrollWidth, tocClientW: toc.clientWidth,
    }
  })
  note('MOBILE 390: ' + JSON.stringify(m))
  await p.screenshot({ path: `${OUT}/r2-mobile.png` })
  await ctx.close()
}

// ── #6 light mode sanity ──
{
  const { ctx, p } = await newPage(1440, 900, false)
  await p.evaluate(() => window.scrollTo(0, 900))
  await p.waitForTimeout(400)
  const l = await p.evaluate(() => ({
    htmlLight: document.documentElement.classList.contains('light'),
    activePill: [...document.querySelectorAll('.toc-pill')].find((x) => x.classList.contains('active'))?.textContent.trim() ?? null,
    fabBg: getComputedStyle(document.querySelector('.scroll-top')).background,
  }))
  note('LIGHT: ' + JSON.stringify(l))
  await ctx.close()
}

note('CONSOLE_ERRORS: ' + (errors.join(' | ') || '(none)'))
fs.writeFileSync(`${OUT}/r2-verify-state.txt`, log.join('\n'))
await browser.close()
