/**
 * graphState.js — ephemeral Sigma-graph UI state. TDD §3.2 / §5.
 * Pure Svelte store; no DOM, no Sigma imports, no fkMap fetches — the
 * renderer feeds it neighbour arrays and reads derived values back. This
 * keeps expand/collapse unit-testable and decoupled from WebGL lifecycle.
 *
 * URL is the source of truth for `graph` / `expand` / `modules` (grill Q12);
 * this store hydrates from those params on mount and serializes back via
 * history.replaceState. Pager position (+N more) is intentionally TRANSIENT
 * — never serialized (advocate hold #3: &page stays out of share links).
 */

import { writable } from 'svelte/store'

// ceiling: 120 nodes total in the Sigma graph — ponytail cut (grill Q5,
// TDD §8 memory/frame budget). Expand() refuses additions past this; raise
// only after benching FA2 warm at cap on median hardware.
export const NODE_CAP = 120

/** Canonical module list for pills — mirrors utils.js canonicalModule() outputs. */
export const CANONICAL_MODULES = ['Sales', 'Procurement', 'Production', 'Inventory', 'Project', 'Finance', 'HR', 'Service']

export const graphState = writable(/** @type {{
 *   expandedBatches: { table: string; added: string[] }[],   // ordered LRU batches for Collapse
 *   expandedSet: Set<string>,                                 // every table ever Expand-ed (URL expand=)
 *   visibleModules: string[],                                 // [] = All visible (Q10)
 *   showPlumbing: boolean,                                    // Q11: OFF default → faint dashed
 *   activeNode: string | null,                                // pop target (Goto/Expand card)
 * }} */ ({
  expandedBatches: [],
  expandedSet: new Set(),
  visibleModules: [],
  showPlumbing: false,
  activeNode: null,
}))

/**
 * Accept an Expand(+N) request. Caller resolves neighbours first (fkMap
 * forward+reverse maps) and passes them sorted rare-first.
 *
 * @param {string} table       table being expanded
 * @param {string[]} candidates neighbour tables NOT already in the graph
 * @returns {{ accepted: string[], rejectedByCap: number }}
 */
export function requestExpand(table, candidates) {
  let accepted = /** @type {string[]} */ ([])
  let rejectedByCap = 0
  graphState.update((s) => {
    // ceiling: NODE_CAP=120 — see comment above; do not silently raise.
    const room = Math.max(0, NODE_CAP - s.expandedBatches.reduce((n, b) => n + b.added.length, 0))
    accepted = candidates.slice(0, room)
    rejectedByCap = candidates.length - accepted.length
    if (accepted.length === 0 && !s.expandedSet.has(table)) {
      // Nothing fit (cap reached) but mark intent so URL round-trips stay honest.
      return { ...s, activeNode: table }
    }
    return {
      ...s,
      activeNode: table,
      expandedSet: new Set([...s.expandedSet, table, ...accepted]),
      expandedBatches: [...s.expandedBatches, { table, added: accepted }],
    }
  })
  return { accepted, rejectedByCap }
}

/**
 * Collapse the OLDEST expansion batch (LRU). Evicted nodes are filtered by a
 * caller-supplied predicate so ranked-path infrastructure stays pinned:
 *   collapseLast((t) => !pinnedTables.has(t))
 * @param {(table: string) => boolean} [canEvict]
 */
export function collapseLast(canEvict = () => true) {
  graphState.update((s) => {
    if (s.expandedBatches.length === 0) return s
    const [oldest, ...rest] = s.expandedBatches
    const evicted = oldest.added.filter(canEvict)
    if (evicted.length === 0) return { ...s, expandedBatches: rest }
    return { ...s, expandedBatches: rest, expandedSet: new Set([...s.expandedSet].filter((t) => !evicted.includes(t))) }
  })
}

export function toggleModule(mod) {
  graphState.update((s) => {
    const next = s.visibleModules.includes(mod)
      ? s.visibleModules.filter((m) => m !== mod)
      : [...s.visibleModules, mod]
    return { ...s, visibleModules: next }
  })
}

/** Reset to All-visible (the 'All' pill). */
export function setAllModules() {
  graphState.update((s) => ({ ...s, visibleModules: [] }))
}

export function setShowPlumbing(v) {
  graphState.update((s) => ({ ...s, showPlumbing: v }))
}

export function setActiveNode(table) {
  graphState.update((s) => ({ ...s, activeNode: table }))
}

/** Reset to the initial 40-slice state (keeps module/plumbing prefs). */
export function resetGraph() {
  graphState.update((s) => ({
    ...s,
    expandedBatches: [],
    expandedSet: new Set(),
    activeNode: null,
  }))
}

// ── URL serialization (grill Q12) ──────────────────────────────────────────

/**
 * Serialize graph params for history.replaceState. Only graph/expand/modules —
 * Pager page is transient by design.
 * @param {{ expanded?: Iterable<string>; modules?: string[] }} s
 * @returns {string} querystring fragment starting with '&' or ''
 */
export function toGraphParams({ expanded = [], modules = [] } = {}) {
  const parts = []
  parts.push('graph=1')
  const ex = [...expanded].filter(Boolean)
  if (ex.length) parts.push(`expand=${encodeURIComponent(ex.join(','))}`)
  if (modules.length && modules.length < CANONICAL_MODULES.length) {
    parts.push(`modules=${encodeURIComponent(modules.join(','))}`)
  }
  return parts.length ? `&${parts.join('&')}` : ''
}

/**
 * Hydrate from URLSearchParams (call once per mount BEFORE building slice).
 * @param {URLSearchParams} sp
 */
export function hydrateFromParams(sp) {
  const expandRaw = sp.get('expand') ?? ''
  const modulesRaw = sp.get('modules') ?? ''
  const tables = expandRaw.split(',').map((t) => t.trim()).filter(Boolean)
  const mods = modulesRaw.split(',').map((m) => m.trim()).filter((m) => CANONICAL_MODULES.includes(m))
  graphState.update((s) => ({
    ...s,
    expandedSet: new Set(tables),
    // Batches unknown from URL — one synthetic batch per table preserves order
    // so progressive re-expand (renderer-side) can replay deterministically.
    expandedBatches: tables.map((t) => ({ table: t, added: [] })),
    visibleModules: mods,
    showPlumbing: s.showPlumbing, // plumbing toggle deliberately not in URL (Q11/Q12 lock)
  }))
  return tables // replay order for progressive warm-expand on mount
}
