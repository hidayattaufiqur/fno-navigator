<script>
  // JARVIS/HUD holographic table graph (M6 rewrite): three.js + 3d-force-graph,
  // lazy-loaded, EffectComposer + UnrealBloomPass glow, glowing icosahedron
  // cores + additive halo sprites, flowing directional light particles,
  // holographic sprite labels (centre + hover neighbourhood), idle auto-orbit
  // with pause-on-drag, hover lights direct connections and dims the rest,
  // click eases the camera to the node. Public API matches the old SigmaGraph:
  // props nodes/edges/meta/centre/height/onnodeclick/onready/tooltip,
  // bind:this addToGraph/resetToSlice/focusTable/nodeDisplayPos.
  import { onMount, onDestroy, createEventDispatcher } from 'svelte'
  import { canonicalModule } from '$lib/utils.js'
  import { tableDefs } from '$lib/data/flows'
  import Starfield from './Starfield.svelte'
  import { graphState } from '$lib/stores/graphState.js'

  export let nodes = []
  export let edges = []
  export let meta = null // trace seed hints (unused in 3D; positions are force-simulated)
  export let centre = null // neighbourhood anchor (pinned label)
  export let height = 520
  export let onnodeclick = () => {} // (table: string) => void
  export let onready = () => {} // fired once the sim has warmed and camera is framed
  export let tooltip = true // edge hover tooltips with per-field copy (Q6)

  const dispatch = createEventDispatcher()

  let phase = 'loading' // 'loading' | 'ready' | 'fallback'
  let container = null

  let THREE = null
  let ForceGraph3DFactory = null // lazy factory fn from '3d-force-graph'
  let Graph = null // 3d-force-graph instance
  let composer = null
  let bloom = null
  let resizeObs = null
  let animPaused = false // engine loop paused off-screen / hidden tab
  let visObs = null // IntersectionObserver (pause when pane leaves viewport)
  let visHandler = null
  let unsubscribeState = null
  let nodeObjs = new Map() // table -> { core, halo, label }
  let linkObjs = new Map() // link id -> { lineMat, particleColor accessor ctx }
  let hoveredId = null
  let reducedMotion = false
  let tip = null // { x, y, fields, rarity, isPlumbing }
  let copiedKey = ''
  let copyTimer = null
  let orbitTimer = null
  let readyNotified = false

  // internal working data (props are the page's slice; expansions merge here)
  let sliceNodes = []
  let sliceEdges = []
  let prevSig = ''

  // ── colors ────────────────────────────────────────────────────────────────
  const MODULE_COLORS = {
    Sales: '#60a5fa', Procurement: '#ffb700', Production: '#fb923c',
    Inventory: '#00f3ff', Project: '#818cf8', Finance: '#22d3ee',
    HR: '#e879f9', Service: '#2dd4bf',
  }
  function moduleColor(table) {
    const m = canonicalModule(tableDefs[table]?.module)
    return m && MODULE_COLORS[m] ? MODULE_COLORS[m] : '#8ba8d8'
  }
  function moduleName(table) {
    return canonicalModule(tableDefs[table]?.module) ?? 'Unknown'
  }
  function edgeColor(e) {
    const m = canonicalModule(tableDefs[e.from]?.module)
    return (m && MODULE_COLORS[m]) || '#5a94e8'
  }

  // ── data translation <-> graphData ────────────────────────────────────────
  function graphDataOf() {
    return {
      nodes: sliceNodes.map((t) => ({
        id: t,
        table: t,
        module: moduleName(t),
        color: moduleColor(t),
        isCentre: t === centre,
        val: 1,
      })),
      links: sliceEdges.map((e, i) => ({
        id: i,
        source: e.from,
        target: e.to,
        fields: e.fields || [],
        thickness: e.thickness,
        isPlumbing: !!e.isPlumbing,
        bestClass: e.bestClass || 0,
        color: edgeColor(e),
      })),
    }
  }

  function rebuildGraph(opts = {}) {
    nodeObjs.clear()
    linkObjs.clear()
    Graph.graphData(graphDataOf())
    Graph.nodeThreeObject(buildNodeObject)
    Graph.linkMaterial(linkMaterialFor)
    if (opts.fit) Graph.zoomToFit(opts.fitMs || 500, 60)
    Graph.d3ReheatSimulation()
    applyHover(null)
  }

  // ── textures (shared, cached) ────────────────────────────────────────────
  let glowTex = null
  function makeGlowTexture() {
    if (glowTex) return glowTex
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.3, 'rgba(255,255,255,0.55)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
    glowTex = new THREE.CanvasTexture(c)
    return glowTex
  }

  let labelTexCache = new Map()
  let dotTex = null
  function labelTexture(text, accent) {
    const key = `${text}|${accent}`
    if (labelTexCache.has(key)) return labelTexCache.get(key)
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 128
    const g = c.getContext('2d')
    g.clearRect(0, 0, 512, 128)
    const w = Math.min(g.measureText('X').width * 17 + 56, 480)
    g.font = '700 42px "0xProto", ui-monospace, monospace'
    const tw = Math.min(g.measureText(text).width + 56, 500)
    g.fillStyle = 'rgba(3, 7, 17, 0.66)'
    if (g.roundRect) {
      g.beginPath()
      g.roundRect((512 - tw) / 2, 14, tw, 100, 14)
      g.fill()
    }
    g.shadowColor = accent
    g.shadowBlur = 18
    g.fillStyle = accent || '#dbe7ff'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 256, 66)
    const tex = new THREE.CanvasTexture(c)
    tex.anisotropy = 4
    labelTexCache.set(key, tex)
    return tex
  }

  function buildNodeObject(node) {
    const accent = node.color
    const group = new THREE.Group()
    // glowing icosahedron core
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.6, 0),
      new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 1.1,
        roughness: 0.3,
        metalness: 0.1,
      }),
    )
    group.add(core)
    // additive halo sprite (bloom driver + hover glow)
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: new THREE.Color(accent),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    halo.scale.setScalar(11)
    group.add(halo)
    // holographic label — starts with a 1px dot texture (real texture swapped
    // in only when the label is shown)
    if (!dotTex) {
      const dc = document.createElement('canvas')
      dc.width = dc.height = 2
      dotTex = new THREE.CanvasTexture(dc)
    }
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: dotTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    )
    label.scale.set(46, 11.5, 1)
    label.position.y = 9.5
    group.add(label)
    nodeObjs.set(node.table, { core, halo, label, accent })
    return group
  }

  function linkMaterialFor(link) {
    const accent = '#5a94e8'
    const mat = new THREE.LineBasicMaterial({
      color: link.color || accent,
      transparent: true,
      opacity: link.isPlumbing ? 0.18 : 0.4,
      depthWrite: false,
    })
    linkObjs.set(link.id, { lineMat: mat, source: link.source, target: link.target, link })
    return mat
  }

  // ── hover: light direct connections, dim the rest ────────────────────────
  function applyHover(hovered) {
    hoveredId = hovered
    if (!Graph || !nodeObjs.size) return
    const neighbors = new Set()
    if (hovered) {
      for (const e of sliceEdges) {
        if (e.from === hovered) neighbors.add(e.to)
        if (e.to === hovered) neighbors.add(e.from)
      }
      neighbors.add(hovered)
    }
    for (const [table, obj] of nodeObjs) {
      const isCtr = table === centre
      if (!hovered) {
        obj.halo.material.opacity = 0.85
        obj.label.material.opacity = isCtr ? 1 : 0
        if (isCtr) obj.label.material.map = labelTexture(table, obj.accent)
        obj.core.material.emissiveIntensity = 1.1
        obj.core.scale.setScalar(1)
      } else if (table === hovered || isCtr || neighbors.has(table)) {
        obj.halo.material.opacity = table === hovered ? 1 : 0.9
        obj.label.material.opacity = 0.95
        obj.label.material.map = labelTexture(table, obj.accent)
        obj.core.material.emissiveIntensity = table === hovered ? 2.2 : 1.7
        obj.core.scale.setScalar(table === hovered ? 1.35 : 1.18)
      } else {
        obj.halo.material.opacity = 0.15
        obj.label.material.opacity = 0
        obj.core.material.emissiveIntensity = 0.25
        obj.core.scale.setScalar(0.85)
      }
    }
    const showPlumbing = $graphState.showPlumbing
    for (const { lineMat, source, target, link } of linkObjs.values()) {
      const lit = !hovered || source === hovered || target === hovered
      if (link.isPlumbing && !showPlumbing) {
        lineMat.opacity = lit ? 0.08 : 0.03
      } else {
        lineMat.opacity = lit ? 0.5 : 0.12
      }
    }
  }

  // ── mount ─────────────────────────────────────────────────────────────────
  onMount(async () => {
    let webglOk = false
    try {
      const c = document.createElement('canvas')
      webglOk = Boolean(c.getContext('webgl2') || c.getContext('webgl'))
    } catch {}
    if (!webglOk) {
      console.warn('[ForceGraph3D] WebGL unsupported — falling back.')
      phase = 'fallback'
      dispatch('fallback')
      return
    }

    try {
      const [fgMod, threeMod] = await Promise.all([import('3d-force-graph'), import('three')])
      ForceGraph3DFactory = fgMod.default
      THREE = threeMod
    } catch (err) {
      console.warn('[ForceGraph3D] dynamic import failed — falling back:', err)
      phase = 'fallback'
      dispatch('fallback')
      return
    }

    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    sliceNodes = [...nodes]
    sliceEdges = [...edges]
    prevSig = ''
    readyNotified = false

    Graph = ForceGraph3DFactory()(container)
    // 3d-force-graph 1.80.0 defaults waitForLoadComplete=true but never exposes
    // it (nor backgroundImageUrl) through the linked props, so finishLoad() never
    // fires and scene.visible stays false → the renderer draws nothing. Flip it
    // ourselves: a transparent-canvas graph with no async load has nothing to wait for.
    Graph.scene().visible = true
    Graph.graphData(graphDataOf())
      .backgroundColor('rgba(0,0,0,0)') // transparent → starfield shows through
      .nodeRelSize(4.5)
      .nodeThreeObject(buildNodeObject)
      .nodeThreeObjectExtend(false)
      .linkMaterial(linkMaterialFor)
      .linkDirectionalParticles(reducedMotion ? 0 : 3)
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleWidth(1.6)
      .linkDirectionalParticleColor((l) => (hoveredId && l.source !== hoveredId && l.target !== hoveredId ? '#1e3a5f' : '#7ad0ff'))
      .linkDirectionalParticleResolution(8)
      .d3VelocityDecay(0.35)
      .d3AlphaDecay(0.06)
      .d3AlphaMin(0.008)
    // NOTE: no .d3ReheatSimulation() here — it calls resetCountdown() which flips
    // engineRunning=true before the debounced(1ms) graphData digest has assigned
    // state.layout, so the first tickFrame() hits `undefined.tick()` inside the rAF
    // callback (before the next rAF is scheduled) and the render loop dies forever.
    // The layout branch itself does stop().alpha(1) + resetCountdown() when it runs.
    if (!reducedMotion) {
      Graph.controls().autoRotate = true
      Graph.controls().autoRotateSpeed = 0.55
    }

    // bloom
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
      ])
      composer = new EffectComposer(Graph.renderer())
      composer.addPass(new RenderPass(Graph.scene(), Graph.camera()))
      bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth || 100, height), 0.9, 0.5, 0.85)
      composer.addPass(bloom)
      Graph.postProcessingComposer(composer)
    } catch (err) {
      console.warn('[ForceGraph3D] bloom unavailable, plain render:', err)
    }

    Graph.cameraPosition({ x: 200, y: 150, z: 280 }, { x: 0, y: 0, z: 0 }, 0)

    Graph.onNodeHover((node) => applyHover(node ? node.table : null))
    Graph.onNodeClick((node) => { if (node) onnodeclick(node.table) })
    Graph.onBackgroundClick(() => applyHover(null))
    if (tooltip) Graph.onLinkHover((link) => { link ? showTip(link) : (tip = null) })

    Graph.controls().addEventListener('start', () => {
      clearTimeout(orbitTimer)
      Graph.controls().autoRotate = false
    })
    Graph.controls().addEventListener('end', () => {
      clearTimeout(orbitTimer)
      if (!reducedMotion) orbitTimer = setTimeout(() => {
        if (Graph && !document.hidden) Graph.controls().autoRotate = true
      }, 2500)
    })

    resizeObs = new ResizeObserver(() => {
      if (!Graph || !container) return
      Graph.width(container.clientWidth)
      Graph.height(container.clientHeight)
      if (composer) composer.setSize(container.clientWidth, container.clientHeight)
    })
    resizeObs.observe(container)

    // Pause the engine loop when the pane leaves the viewport or the tab hides
    // (mirrors Starfield's visibility pattern).
    const setAnimPaused = (on) => {
      if (!Graph) return
      if (on && !animPaused) { Graph.pauseAnimation(); animPaused = true }
      else if (!on && animPaused) { Graph.resumeAnimation(); animPaused = false }
    }
    visObs = new IntersectionObserver((entries) => {
      setAnimPaused(!(entries[0]?.isIntersecting && !document.hidden))
    }, { rootMargin: '120px' })
    visObs.observe(container)
    visHandler = () => setAnimPaused(document.hidden)
    document.addEventListener('visibilitychange', visHandler)

    unsubscribeState = graphState.subscribe(() => applyVisibility())

    phase = 'ready'
    prevSig = sliceSig()
    setTimeout(() => {
      if (Graph) {
        Graph.zoomToFit(600, 60)
      }
      if (!readyNotified) { readyNotified = true; onready() }
    }, 400)
  })

  function sliceSig() {
    return `${sliceNodes.length}:${sliceNodes[sliceNodes.length - 1] ?? ''}#${sliceEdges.length}:${sliceEdges[sliceEdges.length - 1]?.from ?? ''}`
  }

  // ── visibility from graphState (module pills + plumbing toggle) ──────────
  function applyVisibility() {
    if (!Graph) return
    const s = $graphState
    Graph.nodeVisibility((n) => s.visibleModules.length === 0 || s.visibleModules.includes(n.module))
    Graph.linkVisibility((l) => {
      const vis = s.visibleModules.length === 0 ||
        (s.visibleModules.includes(moduleName(l.source)) && s.visibleModules.includes(moduleName(l.target)))
      if (!vis) return false
      return !(l.isPlumbing && !s.showPlumbing)
    })
    applyHover(hoveredId) // re-tint lines after visibility change
  }

  // ── edge tooltip (Q6) — canvas-space mid-link ─────────────────────────────
  function showTip(link) {
    if (!link || !Graph) return
    const gd = Graph.graphData()
    const a = gd.nodes.find((n) => n.id === link.source)
    const b = gd.nodes.find((n) => n.id === link.target)
    if (!a || a.x === undefined || !b || b.x === undefined) return
    try {
      const pa = Graph.graph2ScreenCoords(a.x, a.y, a.z)
      const pb = Graph.graph2ScreenCoords(b.x, b.y, b.z)
      const fields = Array.isArray(link.fields) ? link.fields : []
      if (!fields.length) return
      tip = {
        x: (pa.x + pb.x) / 2,
        y: (pa.y + pb.y) / 2,
        fields,
        rarity: link.thickness >= 4 ? 'rare' : link.thickness >= 2.5 ? 'uncommon' : 'common',
        isPlumbing: Boolean(link.isPlumbing),
      }
    } catch { /* not yet positioned — ignore */ }
  }

  async function copyField(text) {
    try {
      await navigator.clipboard.writeText(text)
      copiedKey = text
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => (copiedKey = ''), 900)
    } catch { /* clipboard denied */ }
  }

  // ── public instance API (bind:this) — same contract as SigmaGraph ────────
  /** @returns {{ accepted: string[] }} */
  export function addToGraph({ parentTable, tables, edges: newEdges }) {
    if (!Graph) return { accepted: [] }
    const existing = new Set(sliceNodes)
    const accepted = [...new Set(tables)].filter((t) => t && !existing.has(t))
    const room = Math.max(0, 120 - sliceNodes.length) // ceiling: 120 nodes (grill Q5)
    if (room <= 0) return { accepted: [] }
    const keep = accepted.slice(0, room)
    sliceNodes = [...sliceNodes, ...keep]
    sliceEdges = [...sliceEdges, ...newEdges.filter((e) => e && e.from && e.to)]
    rebuildGraph()
    return { accepted: keep }
  }

  export function resetToSlice(nextNodes = [], nextEdges = []) {
    if (!Graph) return
    sliceNodes = nextNodes.length ? nextNodes : sliceNodes
    sliceEdges = nextEdges.length ? nextEdges : sliceEdges
    prevSig = sliceSig()
    rebuildGraph({ fit: true })
  }

  export function focusTable(table) {
    if (!Graph || !table) return
    const n = Graph.graphData().nodes.find((x) => x.id === table)
    if (!n || n.x === undefined) return
    try {
      Graph.cameraPosition(
        { x: (n.x || 0) + 60, y: (n.y || 0) + 40, z: (n.z || 0) + 120 },
        { x: n.x || 0, y: n.y || 0, z: n.z || 0 },
        800,
      )
    } catch { /* sim not ready */ }
  }

  /** @returns {{ x: number; y: number } | null} canvas-relative screen pos */
  export function nodeDisplayPos(table) {
    if (!Graph) return null
    const n = Graph.graphData().nodes.find((x) => x.id === table)
    if (!n || n.x === undefined) return null
    try {
      const p = Graph.graph2ScreenCoords(n.x, n.y, n.z)
      return { x: p.x, y: p.y }
    } catch {
      return null
    }
  }

  // ── rebuild orchestration: page replaced the slice wholesale ─────────────
  // Expansions/resets go through addToGraph/resetToSlice (they bump prevSig
  // themselves); a prop change here means a NEW search → full rebuild.
  $: sig = `${nodes.length}:${nodes[nodes.length - 1] ?? ''}#${edges.length}`
  $: if (phase === 'ready' && Graph && sig !== prevSig) {
    prevSig = sig
    sliceNodes = [...nodes]
    sliceEdges = [...edges]
    rebuildGraph({ fit: true })
  }

  onDestroy(() => {
    unsubscribeState?.()
    resizeObs?.disconnect()
    visObs?.disconnect()
    if (visHandler) document.removeEventListener('visibilitychange', visHandler)
    clearTimeout(copyTimer)
    clearTimeout(orbitTimer)
    try { Graph?._destructor() } catch {}
    Graph = null
    composer = null
    bloom = null
    nodeObjs.clear()
    linkObjs.clear()
    labelTexCache.forEach((t) => t.dispose())
    labelTexCache.clear()
  })
</script>

{#if phase === 'fallback'}
  <slot name="fallback">
    <div class="mini">Graph unavailable.</div>
  </slot>
{:else}
  <div
    class="fg3d-container"
    style="height:{height}px; width:100%;"
    role="img"
    aria-label="Interactive holographic table relation graph"
    data-testid="sigma"
  >
    <Starfield />
    <div class="fg3d-mount" bind:this={container}></div>
    {#if phase === 'loading'}
      <div class="mini loading-mini" aria-busy="true">
        <span class="spin-dot" aria-hidden="true"></span>
        Igniting the constellation…
      </div>
    {/if}
    {#if tip}
      <div class="sg-tooltip" style="left:{tip.x}px; top:{tip.y}px" role="status">
        {#each tip.fields as f}
          <div class="sg-tip-row">
            <code>{f}</code>
            <button class="sg-copy" on:click={() => copyField(f)} aria-label="Copy {f}">
              {copiedKey === f ? 'Copied' : '⎘'}
            </button>
          </div>
        {/each}
        <div class="sg-tip-chips">
          <span class="sg-chip">{tip.rarity}</span>
          {#if tip.isPlumbing}<span class="sg-chip sg-chip-plumbing">plumbing</span>{/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .fg3d-container {
    position: relative;
    border-radius: var(--r-lg, 8px);
    background: transparent;
    overflow: hidden;
    cursor: grab;
  }
  .fg3d-container:active { cursor: grabbing; }
  .fg3d-mount {
    position: absolute;
    inset: 0;
    z-index: 2;
  }
  .fg3d-mount :global(canvas) {
    position: absolute;
    inset: 0;
    z-index: 2;
  }
  .mini {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--clr-text-muted);
    font-size: 12px;
    padding: 16px;
    z-index: 3;
    background: rgba(0, 0, 0, 0.25);
    backdrop-filter: blur(2px);
  }
  .loading-mini { gap: 10px; grid-auto-flow: column; }
  .spin-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--clr-border);
    border-top-color: var(--clr-blue, #5a94e8);
    animation: spin 0.75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .sg-tooltip {
    position: absolute;
    transform: translate(-50%, -110%);
    z-index: 30;
    max-width: 360px;
    padding: 8px 10px;
    background: var(--clr-label-bg);
    border: 1px solid var(--clr-label-bd);
    border-radius: var(--r-md);
    color: var(--clr-text);
    font-family: inherit;
    font-size: 11.5px;
    pointer-events: auto;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  }
  .sg-tip-row {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
    white-space: nowrap;
  }
  .sg-tip-row code { font-family: inherit; color: var(--clr-text); }
  .sg-copy {
    background: none;
    border: 1px solid var(--clr-border-subtle);
    border-radius: var(--r-sm);
    color: var(--clr-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 10.5px;
    padding: 1px 6px;
  }
  .sg-copy:hover { color: var(--clr-text); border-color: var(--clr-border-accent); }
  .sg-tip-chips { display: flex; gap: 6px; margin-top: 6px; }
  .sg-chip {
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--clr-border-subtle);
    color: var(--clr-text-muted);
  }
  .sg-chip-plumbing { color: var(--clr-text-faint); border-style: dashed; }
</style>