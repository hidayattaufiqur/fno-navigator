<script>
  /**
   * SigmaGraph.svelte — WebGL renderer core (TDD §3.3/§3.4/§5/§6.2/§7).
   * M1/M2 slice: CSR lazy imports, Graphology builder, FA2 worker (dynamic
   * gravity), CSS-var theming via MutationObserver, SVG-fallback slot,
   * edge tooltip with per-field copy (Q6).
   *
   * Written in the repo's legacy Svelte idiom (export let / $: / on:) to
   * match every other component — runes-mode proved hostile to this
   * project's build pipeline and bought nothing here.
   *
   * Reuses: $lib/graph/layout.js seeds · $lib/graph/style.js visual contract ·
   *         $lib/stores/graphState.js (module filter / plumbing toggle / caps)
   * Zero top-level sigma/graphology imports — entry chunk must stay clean (Q15).
   */
  import { onMount, onDestroy, createEventDispatcher } from 'svelte'
  import { canonicalModule } from '$lib/utils.js'
  import { tableDefs } from '$lib/data/flows'
  import { wedgeSeed, neighbourWedgeSeed, blendedSeed } from '$lib/graph/layout.js'
  import {
    readPalette,
    nodeSize,
    edgeThickness,
    classifyEdge,
    withAlpha,
    PLUMBING_FAINT_ALPHA,
  } from '$lib/graph/style.js'
  import { graphState, NODE_CAP } from '$lib/stores/graphState.js'

  export let nodes = []
  export let edges = []
  /** @type {{[table: string]: {hop?: number, pathIdx?: number}}} trace seed hints */
  export let meta = null
  /** @type {string | null} neighbourhood anchor (green incoming edges + pinned label) */
  export let centre = null
  export let height = 480
  /** @type {(table: string) => void} */
  export let onnodeclick = () => {}
  /** @type {() => void} fired after the first cold layout settles */
  export let onready = () => {}
  /** edge hover tooltips with per-field copy (Q6). Off = zero edge-event cost. */
  export let tooltip = true

  const dispatch = createEventDispatcher()

  // ── lifecycle state ────────────────────────────────────────────────────────
  let phase = 'loading' // 'loading' | 'ready' | 'fallback'
  let container = null

  let Sigma = null
  let GraphCtor = null
  let fa2Sync = null
  let FA2Supervisor = null
  let sigma = null
  let graph = null
  let supervisor = null
  let resizeObs = null
  let themeObs = null
  let unsubscribeState = null
  let palette = null
  let neighborCache = new Map()
  let refreshQueued = false
  let lastSig = ''

  // hover focus target — read inside rAF-debounced reducer refreshes only.
  let hoveredId = null

  // edge tooltip state (Q6)
  let tip = null // { x, y, fields, rarity, isPlumbing }
  let copiedKey = ''
  let copyTimer = null

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  function moduleOf(table) {
    return canonicalModule(tableDefs[table]?.module)
  }

  // ── graph construction (two-pass: nodes → edges → degree sizes) ───────────
  function seedFor(table, wedgeCounters) {
    const m = moduleOf(table)
    const idx = wedgeCounters.get(m ?? '?') ?? 0
    wedgeCounters.set(m ?? '?', idx + 1)
    const hint = meta && meta[table]
    if (hint && (hint.hop !== undefined || hint.pathIdx !== undefined)) {
      return blendedSeed(table, { idx, module: m, hop: hint.hop ?? 0, pathIdx: hint.pathIdx ?? 0 })
    }
    return wedgeSeed(table, idx, m)
  }

  function sigOf(n, e) {
    return `${n.length}:${n[n.length - 1] ?? ''}#${e.map((x) => `${x.from}>${x.to}`).join(',')}`
  }

  function buildGraph() {
    graph = new GraphCtor({ multi: true, type: 'directed', allowSelfLoops: false })
    const wedgeCounters = new Map()
    for (const t of nodes) {
      if (graph.hasNode(t)) continue
      const { x, y } = seedFor(t, wedgeCounters)
      graph.addNode(t, {
        label: t,
        x,
        y,
        size: 2.5,
        modKey: canonicalModule(tableDefs[t]?.module),
        isCentre: t === centre,
      })
    }
    for (const e of edges) {
      if (!graph.hasNode(e.from) || !graph.hasNode(e.to)) continue
      if (e.from === e.to || graph.hasEdge(e.from, e.to)) continue // merged one-per-pair (Q6)
      graph.addDirectedEdge(e.from, e.to, {
        fields: e.fields,
        maxBucket: e.maxBucket,
        thickness: edgeThickness(e.maxBucket),
        isPlumbing: e.isPlumbing,
      })
    }
    graph.forEachNode((n) => graph.setNodeAttribute(n, 'size', nodeSize(graph.degree(n))))
    rebuildNeighborCache()
    lastSig = sigOf(nodes, edges)
  }

  function rebuildNeighborCache() {
    neighborCache = new Map()
    graph.forEachNode((n) => neighborCache.set(n, new Set()))
    graph.forEachEdge((_e, attrs, source, target) => {
      neighborCache.get(source)?.add(target)
      neighborCache.get(target)?.add(source)
    })
  }

  // ── reducers (all colours flow through palette — no hex in code) ──────────
  function nodeReducer(node, data) {
    const s = $graphState
    const res = { ...data }
    // Q10's 9th pill: unknown-module tables surface as 'Unknown' (modKey null).
    const pillKey = data.modKey ?? 'Unknown'
    const visibleByModule = s.visibleModules.length === 0 || s.visibleModules.includes(pillKey)
    if (!visibleByModule) {
      res.hidden = true
      return res
    }
    const hovered = hoveredId && hoveredId !== node
    const isNeighbor = hoveredId ? neighborCache.get(hoveredId)?.has(node) : false
    res.color = palette.modules[data.modKey] || palette.nodeSatBd
    res.forceLabel = Boolean(data.isCentre) || node === hoveredId
    if (hovered && !isNeighbor) {
      // Second Brain dim pattern — faded fill, no label
      res.color = withAlpha(palette.text, 0.12)
      res.forceLabel = false
    }
    return res
  }

  function edgeReducer(edge, data) {
    const s = $graphState
    const res = { ...data }
    const [source, target] = graph.extremities(edge)

    if (s.visibleModules.length > 0) {
      const sm = graph.getNodeAttribute(source, 'modKey') ?? 'Unknown'
      const tm = graph.getNodeAttribute(target, 'modKey') ?? 'Unknown'
      if (!s.visibleModules.includes(sm) || !s.visibleModules.includes(tm)) {
        res.hidden = true
        return res
      }
    }

    const kind = classifyEdge({ from: source, to: target }, centre)
    const hoverKey = kind === 'in' ? palette.edgeInH : palette.edgeOutH
    const baseKey = kind === 'in' ? palette.edgeIn : palette.edgeOut
    res.size = data.thickness

    if (data.isPlumbing && !s.showPlumbing) {
      // Q11 locked: OFF → faint (dashed stand-in). Waiver applied at slice time.
      res.color = withAlpha(baseKey, PLUMBING_FAINT_ALPHA)
    } else if (hoveredId && (source === hoveredId || target === hoveredId)) {
      res.color = hoverKey
      res.size = data.thickness + 1
    } else {
      res.color = baseKey
    }

    if (s.visibleModules.length === 0 && hoveredId) {
      const incident = source === hoveredId || target === hoveredId
      const bothKnown =
        neighborCache.get(hoveredId)?.has(source) && neighborCache.get(hoveredId)?.has(target)
      if (!incident && !bothKnown) res.hidden = true // focus mode: keep hovered wiring only
    }
    return res
  }

  // ── FA2 (dynamic gravity — grill Q8) ──────────────────────────────────────
  function fa2Settings() {
    return {
      // ceiling: gravity is DYNAMIC 1+min(n,120)/60 — do NOT harden to a fixed
      // value (grill Q8 / TDD §6.2). 1.66 @ 40 nodes → 3.0 @ cap.
      gravity: 1 + Math.min(graph.order, 120) / 60,
      scalingRatio: 3,
      slowDown: 2,
      barnesHutOptimize: true,
      barnesHutTheta: 0.5,
      adjustSizes: true,
      strongGravityMode: false,
      linLogMode: false,
      outboundAttractionDistribution: false,
    }
  }

  async function runLayout(warm) {
    if (!sigma || !graph.order) return
    const settings = fa2Settings()

    // Warm-expand contract (Q5): FA2 has no `fixed` — snapshot existing
    // positions and restore them after the run; only new ring nodes relax.
    const prev = new Map()
    if (warm) {
      graph.forEachNode((n, a) => {
        if (!a.__isNew) prev.set(n, { x: a.x, y: a.y })
      })
    }

    try { if (supervisor) supervisor.kill() } catch { /* already dead */ }
    supervisor = null

    try {
      supervisor = new FA2Supervisor(graph, settings)
      supervisor.start()
      await sleep(warm ? 500 : 800) // wall-clock budgets, TDD §8
    } catch (err) {
      console.warn('[SigmaGraph] FA2 worker unavailable, using sync layout:', err?.message)
      try {
        fa2Sync.assign(graph, { iterations: warm ? 120 : 200, settings })
      } catch { /* keep seed positions */ }
    } finally {
      try { supervisor?.kill() } catch {}
      supervisor = null
    }

    if (warm && prev.size) {
      graph.forEachNode((n, a) => {
        const p = prev.get(n)
        if (p) {
          graph.setNodeAttribute(n, 'x', p.x)
          graph.setNodeAttribute(n, 'y', p.y)
        }
      })
    }
    graph.forEachNode((n) => {
      if (graph.hasNodeAttribute(n, '__isNew')) graph.removeNodeAttribute(n, '__isNew')
    })
    fitCamera()
    sigma.refresh()
  }

  function fitCamera() {
    if (!sigma || !graph.order) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    graph.forEachNode((_n, a) => {
      if (a.x < minX) minX = a.x
      if (a.x > maxX) maxX = a.x
      if (a.y < minY) minY = a.y
      if (a.y > maxY) maxY = a.y
    })
    const spanX = Math.max(maxX - minX, 1)
    const spanY = Math.max(maxY - minY, 1)
    const ratio = Math.min(4, Math.max(0.3, Math.max(spanX / 100, spanY / 100)))
    sigma.getCamera().animate(
      { x: (minX + maxX) / 2, y: (minY + maxY) / 2, ratio, angle: 0 },
      { duration: 450, easing: 'quadraticInOut' },
    )
  }

  // ── public instance API (bind:this) ───────────────────────────────────────
  /**
   * Add an expansion batch: ring-seeds `tables` around parentTable's current
   * position, adds merged edges, runs warm FA2. Honours NODE_CAP defensively.
   * @returns {{ accepted: string[] }}
   */
  export function addToGraph({ parentTable, tables, edges: newEdges }) {
    if (!sigma || !graph.hasNode(parentTable)) return { accepted: [] }
    const px = graph.getNodeAttribute(parentTable, 'x')
    const py = graph.getNodeAttribute(parentTable, 'y')
    // ceiling: NODE_CAP=120 total (grill Q5 / TDD §8) — enforced in
    // graphState.requestExpand(); mirrored here as defence-in-depth.
    const accepted = tables.slice(0, Math.max(0, NODE_CAP - graph.order))
    accepted.forEach((t, i) => {
      if (graph.hasNode(t)) return
      const off = neighbourWedgeSeed(moduleOf(parentTable), i)
      graph.addNode(t, {
        label: t,
        x: px + off.x,
        y: py + off.y,
        size: 2.5,
        modKey: moduleOf(t),
        isCentre: false,
        __isNew: true,
      })
    })
    for (const e of newEdges) {
      if (!graph.hasNode(e.from) || !graph.hasNode(e.to)) continue
      if (e.from === e.to || graph.hasEdge(e.from, e.to)) continue
      graph.addDirectedEdge(e.from, e.to, {
        fields: e.fields,
        maxBucket: e.maxBucket,
        thickness: edgeThickness(e.maxBucket),
        isPlumbing: e.isPlumbing,
      })
    }
    graph.forEachNode((n) => graph.setNodeAttribute(n, 'size', nodeSize(graph.degree(n))))
    rebuildNeighborCache()
    runLayout(true)
    return { accepted }
  }

  export function resetToSlice(nextNodes = [], nextEdges = []) {
    if (!sigma) return
    if (nextNodes.length) nodes = nextNodes
    if (nextEdges.length) edges = nextEdges
    buildGraph()
    sigma.setGraph(graph)
    sigma.refresh()
    runLayout(false)
  }

  export function focusTable(table) {
    if (!sigma || !graph.hasNode(table)) return
    const a = graph.getNodeAttributes(table)
    sigma.getCamera().animate({ x: a.x, y: a.y, ratio: 0.6 }, { duration: 400, easing: 'quadraticInOut' })
  }

  /**
   * Screen-space position of a node inside this container (page-level pop cards).
   * @returns {{ x: number; y: number } | null}
   */
  export function nodeDisplayPos(table) {
    if (!sigma || !graph?.hasNode(table)) return null
    try {
      const d = sigma.getNodeDisplayData(table)
      return d ? { x: d.x, y: d.y } : null
    } catch {
      return null
    }
  }

  // ── rebuild orchestration ($: tracks props identity) ──────────────────────
  $: if (phase === 'ready' && sigma && sigOf(nodes, edges) !== lastSig) {
    buildGraph()
    sigma.setGraph(graph)
    sigma.refresh()
    runLayout(false)
  }

  function showEdgeTip(edgeKey) {
    if (!sigma || !graph) return
    try {
      const attrs = graph.getEdgeAttributes(edgeKey)
      const [source, target] = graph.extremities(edgeKey)
      const s = sigma.getNodeDisplayData(source)
      const t = sigma.getNodeDisplayData(target)
      const fields = Array.isArray(attrs.fields) ? attrs.fields : []
      if (!fields.length || !s || !t) return
      tip = {
        x: (s.x + t.x) / 2,
        y: (s.y + t.y) / 2,
        fields,
        rarity: attrs.maxBucket >= 3 ? 'rare' : attrs.maxBucket === 2 ? 'uncommon' : 'common',
        isPlumbing: Boolean(attrs.isPlumbing),
      }
    } catch { /* node gone mid-hover — ignore */ }
  }

  async function copyField(text) {
    try {
      await navigator.clipboard.writeText(text)
      copiedKey = text
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => (copiedKey = ''), 900)
    } catch { /* clipboard denied — button stays ⎘ */ }
  }

  function scheduleRefresh() {
    if (!sigma || refreshQueued) return
    refreshQueued = true
    requestAnimationFrame(() => {
      refreshQueued = false
      if (sigma) sigma.refresh()
    })
  }

  // ── mount ─────────────────────────────────────────────────────────────────
  onMount(async () => {
    // WebGL capability gate BEFORE paying the import cost.
    let webglOk = false
    try {
      const c = document.createElement('canvas')
      webglOk = Boolean(c.getContext('webgl') || c.getContext('experimental-webgl'))
    } catch {}
    if (!webglOk) {
      console.warn('[SigmaGraph] WebGL unsupported — falling back.')
      phase = 'fallback'
      dispatch('fallback')
      return
    }

    try {
      const [sigmaMod, graphologyMod, fa2Mod, fa2WorkerMod] = await Promise.all([
        import('sigma'),
        import('graphology'),
        import('graphology-layout-forceatlas2'),
        import('graphology-layout-forceatlas2/worker'),
      ])
      Sigma = sigmaMod.default
      GraphCtor = graphologyMod.default
      fa2Sync = fa2Mod.default
      FA2Supervisor = fa2WorkerMod.default
    } catch (err) {
      console.warn('[SigmaGraph] dynamic import failed — falling back:', err)
      phase = 'fallback'
      dispatch('fallback')
      return
    }

    palette = readPalette()
    buildGraph()

    sigma = new Sigma(graph, container, {
      allowInvalidContainer: true,
      minCameraRatio: 0.05,
      maxCameraRatio: 20,
      labelDensity: 1.2,
      labelRenderedSizeThreshold: 8,
      labelFont: '0xProto, ui-monospace, monospace',
      labelColor: { color: palette.text },
      defaultEdgeType: 'line',
      enableEdgeEvents: tooltip,
      renderEdgeLabels: false,
      nodeReducer,
      edgeReducer,
    })

    sigma.on('enterNode', (n) => { hoveredId = n; scheduleRefresh() })
    sigma.on('leaveNode', () => { hoveredId = null; scheduleRefresh() })
    sigma.on('clickNode', (n) => onnodeclick(n))
    sigma.on('clickStage', () => { hoveredId = null; scheduleRefresh() })
    if (tooltip) {
      sigma.on('enterEdge', (k) => showEdgeTip(k))
      sigma.on('leaveEdge', () => (tip = null))
    }

    // Theme flips: re-read palette → refresh. No rebuild, no relayout (~16ms).
    themeObs = new MutationObserver(() => {
      palette = readPalette()
      sigma.setSetting('labelColor', { color: palette.text })
      sigma.refresh()
    })
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    resizeObs = new ResizeObserver(() => sigma.resize())
    resizeObs.observe(container)

    // Module pills / plumbing toggle mutate graphState → cheap reducer refresh.
    unsubscribeState = graphState.subscribe(() => scheduleRefresh())

    phase = 'ready'
    await runLayout(false) // cold budget 800ms
    onready()
  })

  onDestroy(() => {
    unsubscribeState?.()
    resizeObs?.disconnect()
    themeObs?.disconnect()
    clearTimeout(copyTimer)
    try { supervisor?.kill() } catch {}
    try { sigma?.kill() } catch {}
    sigma = null
    graph = null
  })
</script>

{#if phase === 'fallback'}
  <slot name="fallback">
    <div class="mini">Graph unavailable.</div>
  </slot>
{:else}
  <div
    bind:this={container}
    class="sigma-container"
    style="height:{height}px; width:100%;"
    role="img"
    aria-label="Interactive table relation graph"
    data-testid="sigma"
  >
    {#if phase === 'loading'}
      <div class="mini" aria-busy="true">Loading graph…</div>
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
  .sigma-container {
    position: relative;
    border: 1px solid var(--clr-border-subtle);
    border-radius: var(--r-md);
    background: var(--clr-bg);
    overflow: hidden;
  }
  .mini {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--clr-text-muted);
    font-size: 12px;
    padding: 16px;
  }
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
  .sg-tip-row code {
    font-family: inherit;
    color: var(--clr-text);
  }
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
  .sg-copy:hover {
    color: var(--clr-text);
    border-color: var(--clr-border-accent);
  }
  .sg-tip-chips {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .sg-chip {
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--clr-border-subtle);
    color: var(--clr-text-muted);
  }
  .sg-chip-plumbing {
    color: var(--clr-text-faint);
    border-style: dashed;
  }
</style>
