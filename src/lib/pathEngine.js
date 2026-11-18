/**
 * Tiered path engine for the FnO Navigator relation graph.
 *
 * WHY THIS REPLACES pathfinder.js
 *   The old engine enumerated paths with a budget-limited DFS (branchCap,
 *   levelAttempts, maxIterations) and then ranked them with a hand-tuned
 *   additive score. Measured consequence (2026-11-16): adding one tableDef
 *   moved a branch ~70 slots in the sweep order, starving the level budget, and
 *   a class-2/score-16 path stopped being *generated* — never outranked. The
 *   pool was "best of whatever the sweep sampled", so results depended on
 *   unrelated content: brittle by construction.
 *
 *   That design existed because qualityClass / docIdRun / plumbing-seen were
 *   WHOLE-PATH properties derived from table-name heuristics, so a per-edge
 *   Dijkstra could not express them.
 *
 *   AOT metadata removes the need for both. Every edge now carries a `tier`
 *   stating how strong the join is (see tools/gen-relation-graph.mjs):
 *       A  FK declared + indexed   — DB-enforced, paste-safe into X++
 *       B  FK declared, no index   — real relation, may scan
 *       C  conditional             — join needs a discriminator predicate
 *       D  plain relation           — metadata convention only
 *
 *   Tier is per edge, so cost is additive and search is exact: best-first
 *   enumeration, stop after maxResults. No sampling, no budget cliff, no
 *   tuning constants, and adding a table cannot evict a path that was never
 *   generated. A path's confidence is the MINIMUM tier among its hops — that
 *   is a fact to display, not a score to argue about.
 *
 * COST MODEL (deliberately integer, one place to change)
 *   Edge cost by tier: A=1 B=2 C=4 D=8. Hop cost is folded into that (each hop
 *   costs at least 1), so `hops` breaks ties toward shorter paths without a
 *   separate term. Lower total = stronger path.
 */

/** @type {Record<string, number>} */
const TIER_COST = { A: 1, B: 2, C: 4, D: 8 }
/** @type {Record<string, number>} */
const TIER_RANK = { A: 0, B: 1, C: 2, D: 3 }
const KIND = ['table', 'entity', 'view']

// ── Graph state (module-level, survives navigation, like fkMap.js) ──────────

/**
 * @typedef {{
 *   name: string, kind: string, group: string|null, type: string|null,
 *   obsolete: boolean, custom: boolean, degree: number, formUse: number
 * }} GNode
 * @typedef {{
 *   child: string, childField: string, parent: string, parentField: string,
 *   tier: string, composite: boolean, conditional: boolean,
 *   from?: string, to?: string, fwd?: boolean
 * }} GEdge
 * @typedef {{
 *   node: string, steps: {table: string, via: string, tier: string|null, edge: GEdge|null}[],
 *   cost: number, hops: number, seen: Set<string>, floor: string
 * }} Partial
 */

/** @type {{ nodes: Map<string, GNode>, out: Map<string, GEdge[]>, ready: boolean, meta: Record<string, any>|null }} */
const state = {
  nodes: new Map(),
  out: new Map(),
  ready: false,
  meta: null,
}

export const graphLoadState = {
  status: /** @type {'idle'|'loading'|'ready'|'error'|'absent'} */ ('idle'),
  error: '',
}

/**
 * Load and index the tiered graph. Falls back to "absent" when the artifact was
 * not generated for this build (a public clone without a licensed environment),
 * in which case the site keeps using the public seed map.
 * @param {string} [url]
 */
export async function loadGraph(url = '/data/graph-compact.json') {
  if (state.ready) return true
  graphLoadState.status = 'loading'
  try {
    const res = await fetch(url)
    if (!res.ok) {
      graphLoadState.status = res.status === 404 ? 'absent' : 'error'
      graphLoadState.error = `HTTP ${res.status}`
      return false
    }
    const raw = await res.json()
    if (!String(raw.schema ?? '').startsWith('fno-navigator/relation-graph-compact/')) {
      graphLoadState.status = 'error'
      graphLoadState.error = `unexpected schema: ${raw.schema}`
      return false
    }
    for (const n of raw.nodes) {
      state.nodes.set(n[0], {
        name: n[0],
        kind: KIND[n[1]] ?? 'table',
        group: n[2] ?? null,
        type: n[3] ?? null,
        obsolete: n[4] === 1,
        custom: n[5] === 1,
        degree: n[6] ?? 0,
        formUse: n[7] ?? 0,
      })
    }
    for (const e of raw.edges) {
      const edge = {
        child: e[0],
        childField: e[1],
        parent: e[2],
        parentField: e[3],
        tier: e[4],
        composite: (e[5] & 1) === 1,
        conditional: (e[5] & 2) === 2,
      }
      // Traversal adjacency both ways: a path may walk a relation in either
      // direction, but the hop keeps the ORIGINAL declaration so the join
      // predicate is always stated in the direction AOT declares it.
      add(state.out, edge.child, { ...edge, from: edge.child, to: edge.parent, fwd: true })
      add(state.out, edge.parent, { ...edge, from: edge.parent, to: edge.child, fwd: false })
    }
    state.meta = raw.coverage
    state.ready = true
    graphLoadState.status = 'ready'
    return true
  } catch (err) {
    graphLoadState.status = 'error'
    graphLoadState.error = err instanceof Error ? err.message : String(err)
    return false
  }
}

/**
 * @param {Map<string, GEdge[]>} map
 * @param {string} key
 * @param {GEdge} val
 */
function add(map, key, val) {
  let arr = map.get(key)
  if (!arr) map.set(key, (arr = []))
  arr.push(val)
}

export function isGraphReady() {
  return state.ready
}
export function getGraphMeta() {
  return state.meta
}
/** @param {string} name @returns {GNode|null} */
export function getNode(name) {
  return state.nodes.get(name) ?? null
}
export function getNodeNames() {
  return [...state.nodes.keys()].sort()
}

/**
 * Field-level join label, always stated in AOT's declared direction.
 * @param {GEdge} h
 */
function viaOf(h) {
  const e = h.fwd ? `${h.child}.${h.childField} → ${h.parent}.${h.parentField}` : `${h.parent}.${h.parentField} → ${h.child}.${h.childField}`
  return e
}

// ── Search ─────────────────────────────────────────────────────────────────

/**
 * Ranked paths between two tables, strongest joins first.
 *
 * Best-first (uniform-cost) enumeration: pop the cheapest partial path, extend
 * it, stop once `maxResults` complete paths are collected. Because every edge
 * cost is a positive integer and cost only grows along a path, the first k
 * complete paths popped are the true k cheapest — no sampling, no budget.
 *
 * @param {string} source
 * @param {string} target
 * @param {{ maxHops?: number, maxResults?: number, minTier?: 'A'|'B'|'C'|'D', maxExpand?: number }} [opts]
 * @returns {{
 *   results: { steps: { table: string; via: string; tier: string; edge: object }[]; hops: number;
 *              cost: number; tierFloor: string; joinable: boolean; xpp: string }[],
 *   shortest: number | null, truncated: boolean, missing: string[], graph: boolean
 * }}
 */
export function findPaths(source, target, { maxHops = 4, maxResults = 50, minTier = 'D', maxExpand = 150000 } = {}) {
  const empty = { results: [], shortest: null, truncated: false, missing: [], graph: state.ready }
  if (!state.ready) return empty

  const missing = [...new Set([source, target])].filter((t) => !state.nodes.has(t))
  if (missing.length) return { ...empty, missing }

  if (source === target) {
    return {
      results: [
        {
          steps: [{ table: source, via: '', tier: 'A', edge: null }],
          hops: 0,
          cost: 0,
          tierFloor: 'A',
          joinable: false,
          xpp: '',
        },
      ],
      shortest: 0,
      truncated: false,
      missing: [],
      graph: true,
    }
  }

  const tierFloorAllowed = TIER_RANK[minTier] ?? 3
  /** @param {string} tier */
  const accept = (tier) => (TIER_RANK[tier] ?? 3) <= tierFloorAllowed

  const results = []
  let expansions = 0
  let truncated = false
  let shortest = null

  // Binary min-heap keyed on (cost, hops, sequence) — deterministic order.
  const heap = new MinHeap()
  const startSteps = [{ table: source, via: '', tier: null, edge: null }]
  heap.push({ node: source, steps: startSteps, path: [source], cost: 0, hops: 0, floor: 'A' })

  // Visited is a small ARRAY, not a Set copied per branch. Measured: cloning a
  // Set on every branch of a 415-neighbour hub OOMs a 2 GB heap in 30s. A path
  // is at most maxHops+1 long, so an includes() scan is cheaper than the copy.
  while (heap.size && results.length < maxResults) {
    const cur = heap.pop()
    if (cur.node === target) {
      if (shortest === null) shortest = cur.hops
      results.push(makeResult(cur))
      continue
    }
    if (cur.hops >= maxHops) continue
    if (++expansions > maxExpand) {
      truncated = true
      break
    }
    const nexts = state.out.get(cur.node)
    if (!nexts) continue
    for (const h of nexts) {
      if (!accept(h.tier)) continue
      if (cur.path.includes(h.to)) continue
      const tier = h.tier
      heap.push({
        node: h.to,
        steps: [...cur.steps, { table: h.to, via: viaOf(h), tier, edge: h }],
        path: [...cur.path, h.to],
        cost: cur.cost + (TIER_COST[tier] ?? 8),
        hops: cur.hops + 1,
        floor: TIER_RANK[tier] > TIER_RANK[cur.floor] ? tier : cur.floor,
      })
      if (heap.size > maxExpand) {
        truncated = true
        break
      }
    }
    if (truncated) break
  }
  if (heap.size && results.length >= maxResults) truncated = true

  // Best-first already yields ascending cost, but re-sort on the full tuple so
  // the contract is explicit: tierFloor, then cost, then hops, then table seq.
  results.sort(
    (a, b) =>
      TIER_RANK[a.tierFloor] - TIER_RANK[b.tierFloor] ||
      a.cost - b.cost ||
      a.hops - b.hops ||
      a.key.localeCompare(b.key)
  )
  return { results, shortest, truncated, missing: [], graph: true }
}

function makeResult(cur) {
  const steps = cur.steps.slice(1).map((s) => ({ table: s.table, via: s.via, tier: s.tier, edge: s.edge }))
  const all = [{ table: cur.steps[0].table, via: '', tier: null, edge: null }, ...steps]
  const tierFloor = cur.floor
  const joinable = steps.length > 0 && steps.every((s) => s.tier === 'A')
  return {
    steps: all,
    hops: steps.length,
    cost: cur.cost,
    tierFloor,
    joinable,
    xpp: joinable ? xppFor(all) : '',
    key: all.map((s) => s.table).join('>'),
  }
}

/**
 * X++ for a Tier-A-only chain. Every hop is an indexed FK, so the join is
 * directly writable. Stated in AOT's declared direction regardless of the
 * direction the search walked.
 * @param {{ table: string; edge: object|null }[]} steps
 * @returns {string}
 */
export function xppFor(steps) {
  const links = steps.slice(1).filter((s) => s.edge)
  if (!links.length) return ''
  const root = steps[0].table
  const lines = [`select ${root}`]
  for (const s of links) {
    const e = s.edge
    // The table being joined INTO is the far end of the hop.
    const into = s.table
    const [left, right] = e.fwd
      ? [`${e.child}.${e.childField}`, `${e.parent}.${e.parentField}`]
      : [`${e.parent}.${e.parentField}`, `${e.child}.${e.childField}`]
    lines.push(`    join ${into}`)
    lines.push(`        where ${left} == ${right}`)
    if (e.conditional) {
      lines.push(`        // conditional: relation also constrains a discriminator field`)
    }
  }
  lines.push('    ;')
  return lines.join('\n')
}

/**
 * Tiny binary min-heap; typed-array speed is unnecessary at these sizes.
 * @extends {Object}
 */
class MinHeap {
  constructor() {
    /** @type {Partial[]} */
    this.a = []
  }
  get size() {
    return this.a.length
  }
  /** @param {Partial} x */
  push(x) {
    const a = this.a
    a.push(x)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (cmp(a[p], a[i]) <= 0) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length && last) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && cmp(a[l], a[m]) < 0) m = l
        if (r < a.length && cmp(a[r], a[m]) < 0) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}
/** @param {Partial} x @param {Partial} y */
const cmp = (x, y) => x.cost - y.cost || x.hops - y.hops
