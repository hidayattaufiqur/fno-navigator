<script>
  /**
   * Starfield.svelte — constellation backdrop for the graph pane (M5).
   *
   * frost.rip/d9s-style ambience: a near-black field of glowing stars in three
   * parallax depth layers, slowly drifting, twinkling, and reacting to the
   * pointer (stars near the cursor brighten and drift gently toward it).
   * Pure 2D canvas — zero dependencies, no WebGL context taken (Sigma owns
   * the WebGL one). Cost: ~140 stars, one rAF loop, pauses off-screen and on
   * hidden tabs. Reduced-motion users get one static frame.
   *
   * Colors flow through CSS custom props (--clr-star-*) so dark/light theming
   * and the "no hex in JS" rule both hold.
   */
  import { onMount, onDestroy } from 'svelte'

  /** @type {HTMLCanvasElement | null} */
  let canvas = null

  /** @type {Array<{x:number;y:number;depth:{scale:number;speed:number;alpha:number;size:number};phase:number;tw:number;amp:number;size:number;tone:string}>} */
  let stars = []
  /** @type {{x:number;y:number} | null} */
  let pointer = null // relative to canvas CSS px, null when idle
  let rafId = 0
  let running = false
  let reduced = false
  let dpr = 1
  let W = 0
  let H = 0
  /** @type {{core:string;halo:string;accent:string;near:string;bg:string;density:number} | null} */
  let themeVars = null
  /** @type {MutationObserver | null} */
  let themeObs = null
  let visHandler = null
  /** @type {IntersectionObserver | null} */
  let io = null
  let lastT = 0

  const DEPTHS = [
    { scale: 0.55, speed: 0.045, alpha: 0.28, size: 0.5 }, // far
    { scale: 1.0, speed: 0.10, alpha: 0.5, size: 0.7 }, // mid
    { scale: 1.7, speed: 0.18, alpha: 0.85, size: 0.45 }, // near — small luminous dust, clearly < node size
  ]

  /** @type {Record<string, HTMLCanvasElement>} tone-color → halo sprite */
  const haloSprites = {}
  function makeHaloSprite(color) {
    const S = 64
    const c = document.createElement('canvas')
    c.width = c.height = S
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
    grad.addColorStop(0, color)
    grad.addColorStop(0.35, color)
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, S, S)
    return c
  }

  function readThemeVars() {
    const root = getComputedStyle(document.documentElement)
    const v = (n) => root.getPropertyValue(n).trim()
    themeVars = {
      core: v('--clr-star-core') || '#dbe7ff',
      halo: v('--clr-star-halo') || 'rgba(90,148,232,0.5)',
      accent: v('--clr-star-accent') || '#ffd9a0',
      near: v('--clr-star-near') || 'rgba(122,172,240,0.9)',
      bg: v('--clr-star-bg') || 'rgba(3,7,17,0.0)',
      density: parseFloat(v('--clr-star-density')) || 1,
    }
  }

  function spawn() {
    const density = Math.max(0.5, themeVars?.density ?? 1)
    const target = Math.min(260, Math.round(((W * H) / 16000) * density))
    stars = Array.from({ length: target }, (_, i) => {
      const depth = DEPTHS[i % DEPTHS.length]
      const r = Math.random()
      // ~78% neutral blue-white, ~14% blue, ~8% warm accent
      const tone = r < 0.78 ? 'neutral' : r < 0.92 ? 'blue' : 'warm'
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        depth,
        phase: Math.random() * Math.PI * 2,
        tw: 0.4 + Math.random() * 1.6, // twinkle speed
        amp: 0.25 + Math.random() * 0.55, // twinkle amplitude
        size: depth.size * (0.7 + Math.random() * 0.9),
        tone,
        hue: 90 + Math.random() * 270, // warm halo tint (rgba string built at draw)
      }
    })
  }

  function drawStatic() {
    const ctx = canvas?.getContext('2d')
    if (!ctx || !W || !H) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const tv = themeVars
    if (tv?.bg) {
      ctx.fillStyle = tv.bg
      ctx.fillRect(0, 0, W, H)
    }
    for (const s of stars) paintStar(ctx, s, 0.5)
  }

  /**
   * Paint one star with optional pointer proximity boost.
   * @param {CanvasRenderingContext2D} ctx
   * @param {typeof stars[number]} s
   * @param {number} glow 0..1 twinkle value (static 0.5)
   */
  function paintStar(ctx, s, glow) {
    const tv = themeVars
    if (!tv) return
    const px = s.x
    const py = s.y
    if (px < -6 || py < -6 || px > W + 6 || py > H + 6) return

    // Proximity boost: stars within 110px of the cursor brighten + swell.
    let boost = 0
    if (pointer && pointer.x !== null) {
      const d = Math.hypot(px - pointer.x, py - pointer.y)
      if (d < 110) boost = (1 - d / 110) * 0.9
    }

    const a = s.depth.alpha * (1 + s.amp * Math.sin(s.phase + glow * s.tw * 9)) + boost
    const r = s.size * (1 + boost * 0.8)
    // ponytail: hard cap draw radius so no star (even boosted) reads as a node
    // blob; sprite multiplier 4 keeps the halo envelope proportional to the
    // core instead of 8x. Upgrade path: per-tier sprite cache if perf ever
    // regresses (currently ~140 sprites, cached per tone).
    const rMax = 0.9
    const rDraw = Math.min(r, rMax)
    if (a <= 0.01 || rDraw <= 0.1) return

    const base = s.tone === 'warm' ? tv.accent : s.tone === 'blue' ? tv.near : tv.core
    ctx.globalAlpha = a
    // Rasterized halo sprite (pre-rendered radial gradient, cached per tone)
    // replaces per-star shadowBlur — the shadow pass is what tanked software
    // rendering at 2x DPR (166ms/frame → ~50ms). Same look, ~3x faster.
    const sprite = haloSprites[base] || (haloSprites[base] = makeHaloSprite(base))
    const spr = Math.ceil(rDraw * 4)
    ctx.drawImage(sprite, px - spr, py - spr, spr * 2, spr * 2)
  }

  function frame(t) {
    if (!running) return
    rafId = requestAnimationFrame(frame)
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016
    lastT = t
    const ctx = canvas?.getContext('2d')
    if (!ctx || !W || !H) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const tv = themeVars
    if (tv?.bg) {
      ctx.fillStyle = tv.bg
      ctx.fillRect(0, 0, W, H)
    }
    ctx.globalCompositeOperation = 'lighter'

    for (const s of stars) {
      // Slow orbital drift + pointer attraction (tiny, capped)
      s.x += s.depth.speed * dt * 8
      s.y += s.depth.speed * Math.sin(t / 4000 + s.phase) * dt * 4
      if (pointer && pointer.x !== null) {
        const dx = pointer.x - s.x
        const dy = pointer.y - s.y
        const d = Math.hypot(dx, dy)
        if (d < 160) {
          const pull = (1 - d / 160) * 14 * dt * s.depth.scale
          s.x += (dx / (d || 1)) * pull
          s.y += (dy / (d || 1)) * pull
        }
      }
      // Wrap horizontally so the field never thins out
      if (s.x > W + 8) s.x = -8
      if (s.x < -8) s.x = W + 8
      s.phase += dt * s.tw
      paintStar(ctx, s, Math.sin(s.phase))
    }

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
  }

  function resize() {
    const el = canvas
    if (!el) return
    const rect = el.parentElement?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    dpr = Math.min(2, window.devicePixelRatio || 1)
    W = rect.width
    H = rect.height
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    spawn()
    if (!running) drawStatic()
  }

  function onPointerMove(e) {
    const rect = canvas?.getBoundingClientRect()
    if (!rect) return
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerLeave() {
    pointer = null
  }

  onMount(() => {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    readThemeVars()
    if (!canvas) return

    const ro = new ResizeObserver(resize)
    ro.observe(canvas.parentElement)
    resize()

    const host = /** @type {HTMLElement} */ (canvas.parentElement)
    if (!host) return
    host.addEventListener('pointermove', onPointerMove, { passive: true })
    host.addEventListener('pointerleave', onPointerLeave)

    // Theme flips: re-read star colours (no respawn needed)
    themeObs = new MutationObserver(() => { readThemeVars(); if (!running) drawStatic() })
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    // Pause when the pane leaves the viewport
    io = new IntersectionObserver((entries) => {
      const on = entries[0]?.isIntersecting && !document.hidden
      if (on && !reduced && !running) { running = true; lastT = 0; rafId = requestAnimationFrame(frame) }
      else if (!on && running) { running = false; cancelAnimationFrame(rafId) }
    }, { rootMargin: '120px' })
    io.observe(canvas)

    // Pause on hidden tabs
    visHandler = () => {
      if (document.hidden && running) { running = false; cancelAnimationFrame(rafId) }
      else if (!document.hidden && !reduced && !running) { running = true; lastT = 0; rafId = requestAnimationFrame(frame) }
    }
    document.addEventListener('visibilitychange', visHandler)

    if (!reduced) { running = true; rafId = requestAnimationFrame(frame) }
    else drawStatic()

    return () => {
      running = false
      cancelAnimationFrame(rafId)
      ro.disconnect()
      io?.disconnect()
      themeObs?.disconnect()
      document.removeEventListener('visibilitychange', visHandler)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerleave', onPointerLeave)
    }
  })

  onDestroy(() => {})
</script>

<canvas
  bind:this={canvas}
  data-testid="starfield"
  aria-hidden="true"
  class="starfield-canvas"
></canvas>

<style>
  .starfield-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
    border-radius: inherit;
  }
</style>