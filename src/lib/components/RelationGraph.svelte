<script>
  import { goto } from '$app/navigation'

  /** @type {string} */
  let { tableName, relations } = $props()

  /** @typedef {{ from: string; to: string; fields?: string[]; note?: string; source?: 'manual'|'schema' }} Relation */
  /** @typedef {{ x: number; y: number }} Point */

  // ── Hover state ────────────────────────────────────────────────────────────

  let hoveredEdge = $state(/** @type {Relation | null} */ (null))
  let hoveredNode = $state(/** @type {string | null} */ (null))

  // ── Pan / zoom state ───────────────────────────────────────────────────────

  let zoom      = $state(1)
  let panX      = $state(0)
  let panY      = $state(0)
  let isDragging = $state(false)
  let hasDragged = $state(false)
  let dragStart  = $state({ x: 0, y: 0, panX: 0, panY: 0 })
  let svgEl      = $state(/** @type {SVGSVGElement | null} */ (null))

  // Non-passive wheel + touch listeners so preventDefault works
  $effect(() => {
    if (!svgEl) return

    // ── Wheel (desktop zoom) ──────────────────────────────────────────────
    const onWheel = (e) => {
      e.preventDefault()
      const rect = svgEl.getBoundingClientRect()
      const mx = (e.clientX - rect.left) / rect.width
      const my = (e.clientY - rect.top)  / rect.height
      const factor  = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newZoom = Math.max(0.35, Math.min(6, zoom * factor))
      const vbW = canvasWidth  / zoom
      const vbH = canvasHeight / zoom
      const svgX = panX + mx * vbW
      const svgY = panY + my * vbH
      panX = svgX - mx * (canvasWidth  / newZoom)
      panY = svgY - my * (canvasHeight / newZoom)
      zoom = newZoom
    }

    // ── Touch (mobile pan + pinch-zoom) ───────────────────────────────────
    /** @type {{ clientX: number; clientY: number }[]} */
    let lastTouches = []

    const onTouchStart = (e) => {
      e.preventDefault()
      lastTouches = Array.from(e.touches).map(t => ({ clientX: t.clientX, clientY: t.clientY }))
      if (e.touches.length === 1) {
        isDragging = true
        hasDragged = false
        dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, panX, panY }
      }
    }

    const onTouchMove = (e) => {
      e.preventDefault()
      if (e.touches.length === 1 && isDragging) {
        const dx = e.touches[0].clientX - dragStart.x
        const dy = e.touches[0].clientY - dragStart.y
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDragged = true
        const rect   = svgEl.getBoundingClientRect()
        const scaleX = (canvasWidth  / zoom) / rect.width
        const scaleY = (canvasHeight / zoom) / rect.height
        panX = dragStart.panX - dx * scaleX
        panY = dragStart.panY - dy * scaleY
      } else if (e.touches.length === 2 && lastTouches.length >= 2) {
        const t1 = e.touches[0], t2 = e.touches[1]
        const lt1 = lastTouches[0], lt2 = lastTouches[1]
        const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
        const oldDist = Math.hypot(lt2.clientX - lt1.clientX, lt2.clientY - lt1.clientY)
        if (oldDist > 0) {
          const factor  = newDist / oldDist
          const rect    = svgEl.getBoundingClientRect()
          const mx = ((t1.clientX + t2.clientX) / 2 - rect.left) / rect.width
          const my = ((t1.clientY + t2.clientY) / 2 - rect.top)  / rect.height
          const newZoom = Math.max(0.35, Math.min(6, zoom * factor))
          const vbW = canvasWidth  / zoom
          const vbH = canvasHeight / zoom
          const svgX = panX + mx * vbW
          const svgY = panY + my * vbH
          panX = svgX - mx * (canvasWidth  / newZoom)
          panY = svgY - my * (canvasHeight / newZoom)
          zoom = newZoom
        }
        hasDragged = true
        lastTouches = Array.from(e.touches).map(t => ({ clientX: t.clientX, clientY: t.clientY }))
      }
    }

    const onTouchEnd = (e) => {
      lastTouches = Array.from(e.touches).map(t => ({ clientX: t.clientX, clientY: t.clientY }))
      if (e.touches.length === 0) isDragging = false
    }

    svgEl.addEventListener('wheel',        onWheel,      { passive: false })
    svgEl.addEventListener('touchstart',   onTouchStart, { passive: false })
    svgEl.addEventListener('touchmove',    onTouchMove,  { passive: false })
    svgEl.addEventListener('touchend',     onTouchEnd,   { passive: false })
    svgEl.addEventListener('touchcancel',  onTouchEnd,   { passive: false })
    return () => {
      svgEl.removeEventListener('wheel',       onWheel)
      svgEl.removeEventListener('touchstart',  onTouchStart)
      svgEl.removeEventListener('touchmove',   onTouchMove)
      svgEl.removeEventListener('touchend',    onTouchEnd)
      svgEl.removeEventListener('touchcancel', onTouchEnd)
    }
  })

  function startDrag(e) {
    if (e.button !== 0) return
    isDragging = true
    hasDragged = false
    dragStart  = { x: e.clientX, y: e.clientY, panX, panY }
  }
  function doDrag(e) {
    if (!isDragging || !svgEl) return
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true
    const rect  = svgEl.getBoundingClientRect()
    const scaleX = (canvasWidth  / zoom) / rect.width
    const scaleY = (canvasHeight / zoom) / rect.height
    panX = dragStart.panX - dx * scaleX
    panY = dragStart.panY - dy * scaleY
  }
  function endDrag()   { isDragging = false }
  function resetView() { zoom = 1; panX = 0; panY = 0 }
  function zoomIn()    { zoom = Math.min(6,    zoom * 1.3) }
  function zoomOut()   { zoom = Math.max(0.35, zoom / 1.3) }

  // ── Layout constants ────────────────────────────────────────────────────────

  /** Width / height of satellite (non-centre) nodes, in SVG units */
  const SATELLITE_NODE_W = 124
  const SATELLITE_NODE_H = 28

  /** Width / height of the centre (current-table) node */
  const CENTER_NODE_W = 150
  const CENTER_NODE_H = 34

  /** Minimum orbit radius from centre to satellite centres */
  const MIN_ORBIT_RADIUS = 200

  // ── Derived graph data ─────────────────────────────────────────────────────

  // Unique satellite tables (connected, not the current one)
  let satellites = $derived(
    [...new Set(relations.flatMap((rel) => [rel.from, rel.to]).filter((t) => t !== tableName))]
  )

  // Deduplicate edges by (from, to) pair — merge fields from duplicates.
  // Self-referencing edges (from === to) are excluded; they can't be drawn meaningfully.
  let edges = $derived.by(() => {
    /** @type {Map<string, Relation & { fields: string[] }>} */
    const edgeMap = new Map()
    for (const rel of relations) {
      if (rel.from === rel.to) continue // skip self-references
      const key = `${rel.from}|${rel.to}`
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { ...rel, fields: [...(rel.fields ?? [])] })
      } else {
        const existing = edgeMap.get(key)
        for (const field of rel.fields ?? []) {
          if (!existing.fields.includes(field)) existing.fields.push(field)
        }
      }
    }
    return [...edgeMap.values()]
  })

  // ── Canvas sizing ──────────────────────────────────────────────────────────

  // Scale orbit radius up as more satellites are added
  let orbitRadius = $derived(
    satellites.length <= 4 ? MIN_ORBIT_RADIUS :
    satellites.length <= 8 ? MIN_ORBIT_RADIUS + 45 :
                             MIN_ORBIT_RADIUS + 90
  )
  let canvasWidth  = $derived(Math.max(520, 2 * orbitRadius + 240))
  let canvasHeight = $derived(Math.max(360, 2 * orbitRadius + 100))
  let centerX = $derived(canvasWidth  / 2)
  let centerY = $derived(canvasHeight / 2)

  // Satellite positions: evenly spaced around the orbit circle
  let satellitePositions = $derived(
    Object.fromEntries(
      satellites.map((table, i) => {
        const angle = (2 * Math.PI * i) / satellites.length - Math.PI / 2
        return [table, { x: centerX + orbitRadius * Math.cos(angle), y: centerY + orbitRadius * Math.sin(angle) }]
      })
    )
  )

  // ── Geometry helpers ────────────────────────────────────────────────────────

  /** Returns the centre point of a node.
   * @param {string} name @returns {Point} */
  function nodeCenter(name) {
    return name === tableName
      ? { x: centerX, y: centerY }
      : (satellitePositions[name] ?? { x: centerX, y: centerY })
  }

  /** Returns the border point of node `name` in the direction of node `toward`,
   *  with a gap so arrowheads clear the node border visually.
   * @param {string} name @param {string} toward @returns {Point} */
  function nodeBorderPoint(name, toward) {
    const from = nodeCenter(name)
    const to   = nodeCenter(toward)
    const isCenter = name === tableName
    // 12px gap: arrowheads are ~5px deep; extra margin prevents visual overlap
    const halfW = (isCenter ? CENTER_NODE_W : SATELLITE_NODE_W) / 2 + 12
    const halfH = (isCenter ? CENTER_NODE_H : SATELLITE_NODE_H) / 2 + 12
    const dx = to.x - from.x
    const dy = to.y - from.y
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)
    if (absDx === 0 && absDy === 0) return from
    const scale = Math.min(absDx > 0 ? halfW / absDx : Infinity, absDy > 0 ? halfH / absDy : Infinity)
    return { x: from.x + dx * scale, y: from.y + dy * scale }
  }

  /** Truncates a string with an ellipsis if it exceeds `max` characters.
   * @param {string} text @param {number} [max] @returns {string} */
  function truncate(text, max = 17) {
    return text.length <= max ? text : text.slice(0, max - 1) + '…'
  }

  // ── Edge styling helpers ───────────────────────────────────────────────────

  /**
   * Returns the SVG stroke colour for an edge.
   * Outgoing edges (this table → other) use blue; incoming use green.
   * Schema-derived edges are dimmer than manually documented ones.
   * @param {boolean} isOutgoing @param {boolean} isHovered @param {boolean} isSchema @returns {string}
   */
  function edgeColour(isOutgoing, isHovered, isSchema) {
    if (isSchema) {
      return isHovered
        ? (isOutgoing ? 'var(--clr-edge-out-h)' : 'var(--clr-edge-in-h)')
        : 'var(--clr-edge-schema)'
    }
    if (isOutgoing) return isHovered ? 'var(--clr-edge-out-h)' : 'var(--clr-edge-out)'
    return isHovered ? 'var(--clr-edge-in-h)' : 'var(--clr-edge-in)'
  }

  /**
   * Returns the SVG marker ID for an edge arrowhead.
   * @param {boolean} isOutgoing @param {boolean} isHovered @returns {string}
   */
  function edgeMarker(isOutgoing, isHovered) {
    if (isOutgoing) return isHovered ? 'arr-b-h' : 'arr-b'
    return isHovered ? 'arr-g-h' : 'arr-g'
  }
</script>

{#if satellites.length === 0}
  <p class="mini" style="padding: 6px 0; color: var(--clr-text-faint);">
    No relation data mapped yet for this table.
  </p>
{:else}
  <div class="graph-wrap">
    <div class="graph-zoom-controls">
      <button class="graph-zoom-btn" onclick={zoomIn}  title="Zoom in">+</button>
      <button class="graph-zoom-btn" onclick={zoomOut} title="Zoom out">−</button>
      <button class="graph-zoom-btn" onclick={resetView} title="Reset view" style="font-size:11px; width:auto; padding:0 7px;">⟳</button>
    </div>
    <svg
      bind:this={svgEl}
      viewBox="{panX} {panY} {canvasWidth / zoom} {canvasHeight / zoom}"
      width="100%"
      style="max-height: 500px; display: block; cursor: {isDragging ? 'grabbing' : 'grab'}; touch-action: none;"
      role="img"
      aria-label="Table relation graph for {tableName}"
      onmousedown={startDrag}
      onmousemove={doDrag}
      onmouseup={endDrag}
      onmouseleave={endDrag}
    >
      <defs>
        <!-- context-stroke makes arrowheads inherit the line's stroke colour -->
        <marker id="arr-b"   viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
        <marker id="arr-b-h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
        <marker id="arr-g"   viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
        <marker id="arr-g-h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
      </defs>

      <!-- ── Edges ── -->
      {#each edges as edge}
        {@const isOutgoing = edge.from === tableName}
        {@const isSchema = edge.source === 'schema'}
        {@const p1 = nodeBorderPoint(edge.from, edge.to)}
        {@const p2 = nodeBorderPoint(edge.to, edge.from)}
        {@const isHovered = hoveredEdge === edge}

        <!-- Transparent wider hitbox for easier hover -->
        <line
          x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
          stroke="transparent" stroke-width="14"
          style="cursor: crosshair;"
          role="presentation"
          onmouseenter={() => (hoveredEdge = edge)}
          onmouseleave={() => (hoveredEdge = null)}
        />

        <!-- Visible line (pointer-events off — hitbox handles interaction) -->
        <line
          x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
          style="stroke: {edgeColour(isOutgoing, isHovered, isSchema)}"
          stroke-width={isHovered ? 1.5 : 1}
          stroke-dasharray={isSchema ? '4 3' : null}
          marker-end="url(#{edgeMarker(isOutgoing, isHovered)})"
          pointer-events="none"
        >
          <title>{edge.from} → {edge.to}{edge.fields?.length ? `\nFK: ${edge.fields.join(', ')}` : ''}{edge.note ? `\n${edge.note}` : ''}{isSchema ? '\n(from FK schema)' : ''}</title>
        </line>
      {/each}

      <!-- ── FK field label on hovered edge ── -->
      {#if hoveredEdge?.fields?.length}
        {@const p1 = nodeBorderPoint(hoveredEdge.from, hoveredEdge.to)}
        {@const p2 = nodeBorderPoint(hoveredEdge.to, hoveredEdge.from)}
        {@const mx = (p1.x + p2.x) / 2}
        {@const my = (p1.y + p2.y) / 2}
        {@const label = hoveredEdge.fields[0]}
        {@const labelWidth = label.length * 8.5 + 22}
        {@const padding = 8}
        {@const rx = Math.max(padding, Math.min(canvasWidth - labelWidth - padding, mx - labelWidth / 2))}
        {@const ry = my - 12}
        {@const rh = 24}
        <rect
          x={rx} y={ry}
          width={labelWidth} height={rh} rx="6"
          style="fill: var(--clr-label-bg); stroke: var(--clr-label-bd);"
          stroke-width="1"
          pointer-events="none"
        />
        <text
          x={rx + labelWidth / 2} y={ry + rh / 2}
          text-anchor="middle"
          dominant-baseline="central"
          fill="var(--clr-text)"
          font-size="10.5"
          font-family="'Cascadia Code', 'Fira Code', monospace"
          pointer-events="none">{label}</text>
      {/if}

      <!-- ── Satellite nodes ── -->
      {#each satellites as satelliteName}
        {@const pos = satellitePositions[satelliteName]}
        {@const isHovered = hoveredNode === satelliteName}
        <g
          transform="translate({pos.x - SATELLITE_NODE_W / 2}, {pos.y - SATELLITE_NODE_H / 2})"
          role="button"
          aria-label="View {satelliteName} table reference"
          tabindex="0"
          style="cursor: pointer;"
          onclick={(e) => { if (hasDragged) return; goto('/tables/' + satelliteName) }}
          onmouseenter={() => (hoveredNode = satelliteName)}
          onmouseleave={() => (hoveredNode = null)}
          onkeydown={(e) => e.key === 'Enter' && goto('/tables/' + satelliteName)}
        >
          <title>{satelliteName}</title>
          <rect
            width={SATELLITE_NODE_W} height={SATELLITE_NODE_H} rx="6"
            style="fill: {isHovered ? 'var(--clr-node-sat-hover)' : 'var(--clr-surface)'}; stroke: {isHovered ? 'var(--clr-node-sat-hover-bd)' : 'var(--clr-node-sat-bd)'};"
            stroke-width="1"
          />
          <text
            x={SATELLITE_NODE_W / 2} y={SATELLITE_NODE_H / 2 + 5}
            text-anchor="middle"
            style="fill: {isHovered ? 'var(--clr-blue-strong)' : 'var(--clr-blue)'};"
            font-size="11.5" font-weight="600"
            font-family="'0xProto', 'Cascadia Code', 'Fira Code', monospace"
            pointer-events="none">{truncate(satelliteName)}</text>
        </g>
      {/each}

      <!-- ── Centre node (current table) ── -->
      <g
        transform="translate({centerX - CENTER_NODE_W / 2}, {centerY - CENTER_NODE_H / 2})"
        role="presentation"
      >
        <rect
          width={CENTER_NODE_W} height={CENTER_NODE_H} rx="6"
          style="fill: var(--clr-node-ctr); stroke: var(--clr-node-ctr-bd);"
          stroke-width="1.5"
        />
        <text
          x={CENTER_NODE_W / 2} y={CENTER_NODE_H / 2 + 5}
          text-anchor="middle"
          style="fill: var(--clr-green);"
          font-size="13" font-weight="700"
          font-family="'0xProto', 'Cascadia Code', 'Fira Code', monospace"
          pointer-events="none">{truncate(tableName, 19)}</text>
      </g>

      <!-- ── Legend ── -->
      <g transform="translate(14, {canvasHeight - 80})">
        <line x1="0" y1="7" x2="24" y2="7" style="stroke: var(--clr-edge-out-h);" stroke-width="1.5" marker-end="url(#arr-b)" />
        <text x="30" y="11" fill="var(--clr-text-faint)" font-size="10" font-family="sans-serif">outgoing FK</text>
        <line x1="0" y1="25" x2="24" y2="25" style="stroke: var(--clr-edge-in-h);" stroke-width="1.5" marker-end="url(#arr-g)" />
        <text x="30" y="29" fill="var(--clr-text-faint)" font-size="10" font-family="sans-serif">incoming FK</text>
        <line x1="0" y1="43" x2="24" y2="43" style="stroke: var(--clr-edge-schema);" stroke-width="1" stroke-dasharray="4 3" marker-end="url(#arr-b)" />
        <text x="30" y="47" fill="var(--clr-text-faint)" font-size="10" font-family="sans-serif">schema FK</text>
        <text x="0" y="66" fill="var(--clr-text-faint)" font-size="9.5" font-family="sans-serif">Hover edge for FK fields · click node to navigate</text>
      </g>
    </svg>
  </div>
{/if}

<style>
  .graph-wrap {
    position: relative;
    background: var(--clr-surface);
    border: 1px solid var(--clr-border);
    border-radius: var(--r-md, 10px);
    overflow: hidden;
  }

  .graph-zoom-controls {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    z-index: 10;
  }

  .graph-zoom-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--clr-surface-raised);
    border: 1px solid var(--clr-border);
    border-radius: var(--r-sm, 6px);
    color: var(--clr-text-muted);
    font-size: 15px;
    cursor: pointer;
    font-family: inherit;
    line-height: 1;
    transition: border-color 0.1s, color 0.1s;
    user-select: none;
  }

  .graph-zoom-btn:hover {
    border-color: var(--clr-border-accent);
    color: var(--clr-text);
  }
</style>
