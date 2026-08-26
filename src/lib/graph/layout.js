/**
 * layout.js — pure seed functions for the Sigma/Graphology table graph.
 * TDD §6.1 (grill Q7/Q9). No side effects, no imports from Svelte/Sigma —
 * unit-testable standalone.
 *
 * FA2 physics contract lives with the renderer (SigmaGraph.svelte, TDD §6.2):
 *   gravity: 1 + Math.min(graph.order, 120) / 60  // ceiling: do NOT harden to a fixed value
 *   scalingRatio: 3, slowDown: 2, barnesHutOptimize: true, adjustSizes: true
 * Seeds below are initial conditions only; FA2 owns final positions.
 *
 * Units: ALL coordinates are Graphology units (Sigma maps to screen px).
 * Never mix with SVG pixel values (RelationGraph MIN_ORBIT_RADIUS=200 is a
 * different space — grill Q7 "keep Graphology units separate from SVG pixels").
 */

/** Canonical module wedge order — must stay in sync with utils.js canonicalModule() outputs. */
export const MODULE_ORDER = ['Sales', 'Procurement', 'Production', 'Inventory', 'Project', 'Finance', 'HR', 'Service']

const WEDGE_DEG = 45 // 360° / 8 modules

/**
 * Deterministic FNV-1a 32-bit hash. Same input → same bits → same jitter,
 * so layouts reproduce across reloads and machines (clean git diffs on any
 * future position snapshot).
 * @param {string} str
 * @returns {number} unsigned 32-bit
 */
export function hashFNV1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic symmetric jitter in [-amp, amp] derived from a string salt. */
function jit(salt, amp) {
  const h = hashFNV1a(salt)
  return ((h % 1000) / 999 - 0.5) * 2 * amp
}

/**
 * Wedge index for a table. Known module → its wedge; unknown → stable
 * pseudo-random wedge via hash fallback (same table never drifts wedges).
 * @param {string} table
 * @param {string | null | undefined} module  canonicalModule() output or null
 * @returns {number} 0..7
 */
export function wedgeIndex(table, module) {
  if (module) {
    const i = MODULE_ORDER.indexOf(module)
    if (i >= 0) return i
  }
  return hashFNV1a(table) % MODULE_ORDER.length
}

/**
 * Initial position for a table inside its module wedge.
 * azimuth = wedge*45° + 22.5° centre ± 12° jitter
 * radius  = 14 + (idx%7)*3 ± 0.75 jitter   (M5 readability: widened ring 10→14
 *                                           base and 2→3 step so seeded nodes
 *                                           start less overlapped; FA2 relaxes
 *                                           the rest)
 * @param {string} table
 * @param {number} idxInWedge  insertion order of this table within its wedge
 * @param {string | null | undefined} module  canonicalModule() output or null
 * @returns {{ x: number; y: number }}
 */
export function wedgeSeed(table, idxInWedge, module) {
  const baseDeg = wedgeIndex(table, module) * WEDGE_DEG + WEDGE_DEG / 2
  const azDeg = baseDeg + jit(`${table}:az`, 12)
  const radius = 14 + (idxInWedge % 7) * 3 + jit(`${table}:r`, 0.75)
  const az = (azDeg * Math.PI) / 180
  return { x: radius * Math.cos(az), y: radius * Math.sin(az) }
}

// ceiling: r=80 — Graphology units, not px (grill Q5 / TDD §6.1).
// Raise only after benching expand at the 120-node cap (TDD §8).
const EXPAND_RING_R = 80

/**
 * Initial position for the i-th neighbour added by Expand(+N): a fan on a
 * ring of r=80 around the clicked node's own position offset. Caller adds
 * the parent node's x/y afterwards:
 *   const s = neighbourWedgeSeed(mod, i); pos = { x: parent.x + s.x, y: parent.y + s.y }
 * Fan offsets [0°, +22.5°, -22.5°] keep neighbours near their parent's wedge
 * direction instead of spraying around the full circle.
 * @param {string | null | undefined} parentModule  canonicalModule() of the expanded table
 * @param {number} i  neighbour insertion index
 * @returns {{ x: number; y: number }} offset relative to the parent node
 */
export function neighbourWedgeSeed(parentModule, i) {
  // Unknown parent module → spread evenly around the ring instead of fanning.
  const baseDeg = parentModule && MODULE_ORDER.includes(parentModule)
    ? MODULE_ORDER.indexOf(parentModule) * WEDGE_DEG + WEDGE_DEG / 2
    : (i * 360) / 8
  const fan = [0, 22.5, -22.5][i % 3]
  const az = ((baseDeg + fan) * Math.PI) / 180
  return { x: EXPAND_RING_R * Math.cos(az), y: EXPAND_RING_R * Math.sin(az) }
}

/**
 * Left-to-right bias for path-trace nodes (grill Q9): hop drives x, rank of
 * the path the table first appeared on drives y. A hint, not a constraint —
 * FA2 still relaxes the final layout. No Dagre until user signal (ponytail).
 * @param {number} hop  0-based hop index along the path
 * @param {number} pathIdx  0-based rank of the path in findPaths() results
 * @returns {{ x: number; y: number }}
 */
export function linearSeed(hop, pathIdx) {
  return { x: hop * 180 + jit(`lin:${hop}`, 10), y: pathIdx * 60 + jit(`lin:${pathIdx}`, 8) }
}

/**
 * Blended seed for trace views (Q7 ⊕ Q9): mostly module wedge for island
 * readability, some linear bias so paths still read left→right.
 * @param {string} table
 * @param {{ idx?: number; module?: string|null; hop?: number; pathIdx?: number }} p
 * @returns {{ x: number; y: number }}
 */
export function blendedSeed(table, { idx = 0, module = null, hop = 0, pathIdx = 0 } = {}) {
  const w = wedgeSeed(table, idx, module)
  const l = linearSeed(hop, pathIdx)
  return { x: w.x * 0.65 + l.x * 0.35, y: w.y * 0.65 + l.y * 0.35 }
}
