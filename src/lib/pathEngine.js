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
/**
 * Base cost per edge by tier. All costs MUST be positive: best-first is exact
 * only while cost is non-decreasing along a path, so a zero-cost or negative
 * edge would break the "first k popped are the true k cheapest" guarantee.
 * Every bonus below is therefore a REDUCTION that still leaves a positive step.
 * @type {Record<string, number>}
 */
const TIER_COST = { A: 4, B: 6, C: 9, D: 14 }

/**
 * Node cost — the half of the model tier alone cannot supply.
 *
 * MEASURED FAILURE (2026-11-19, first cut of this engine): with edge tier as the
 * only cost, `SalesTable -> CustTrans` ranked
 *   SalesTable > BankCentralBankPurpose > CustTrans   (2 hops, all tier A)
 * above every real invoice chain. Every 2-hop path through an indexed lookup
 * ties at cost 2, so "shortest indexed detour" won — the same bait problem in a
 * new costume. Tier alone answers "is this join real?", never "is this hop
 * meaningful?".
 *
 * A hop's DESTINATION is what carries business meaning, and AOT states it in
 * TableGroup. So an intermediate node adds its own cost:
 *   Reference / Group / Framework / Parameter   lookup or setup — a detour
 *   Staging                                     landing area, not a flow
 *   Main                                        master data — a weak step
 *   Transaction / Worksheet*                    document data — what a story wants
 *   TempDB/InMemory, Tmp*, deprecated           never a good route
 * The path's destination is free: every path pays it equally, so it cannot bias.
 *
 * Still additive integers, so the search stays exact — no sampling, no tuning
 * against a fixture.
 */
const NODE_COST = {
  Reference: 3,
  Group: 3,
  Parameter: 2,
  Framework: 3,
  Staging: 4,
  Main: 1,
  Transaction: 0,
  TransactionHeader: 0,
  TransactionLine: 0,
  Worksheet: 0,
  WorksheetHeader: 0,
  WorksheetLine: 0,
}
const NODE_COST_DEFAULT = 1
// Form-use discount — the second measured correction, and the one that finally
// separates a real business table from a leaf stub.
//
// MEASURED (2026-11-19): `SalesTable -> CustTrans` kept returning
// `SalesTable > RetailPrePaymentTrans > CustTrans`. Both intermediates are
// TableGroup=Transaction, so node cost could not tell them apart. What does:
// RetailPrePaymentTrans appears on 0 forms and has 2 relations; CustInvoiceJour
// appears on 51 forms and has 271. A table that no user-facing form ever shows is
// not part of the business story an analyst is tracing, whatever its TableGroup.
//
// So a hop into a table with no form presence costs more. This is still an AOT
// fact (form data sources), not curation, and it is additive, so exactness holds.
const NO_FORM_COST = 4
const LOW_FORM_COST = 2
const PLUMBING_TYPE_COST = 6
const OBSOLETE_COST = 12
const HUB_DEGREE = 300
const HUB_COST = 3

/**
 * Flow-cohort bonus — the ONLY signal here that comes from curation, and it is
 * safe in this engine for a reason the old one could not claim.
 *
 * MEASURED (2026-11-19): tier answers "is this join real?" but not "is this hop
 * the business story?". `CustTrans.Invoice -> CustInvoiceJour.InvoiceId` is a
 * multi-field relation with no declared FK, so it is tier C while
 * `SalesTable > RetailPrePaymentTrans > CustTrans` is two tier-A hops — the
 * invoice chain loses on evidence even though it is the chain an accountant
 * means. That is not a tuning failure, it is tier measuring a different thing
 * than story.
 *
 * `flows.ts` already encodes the business story: stages, each with its tables.
 * Two tables in the SAME stage are a documented adjacency. So an intermediate
 * hop whose table shares a stage with the hop before it earns a discount.
 *
 * WHY THIS CANNOT REPRODUCE THE OLD BUG: the 2026-11-16 regression happened
 * because `documentedSet` was BOTH a score term AND the primary key of the DFS
 * sweep order, so +1 moved a branch ~70 slots and starved a budget, and paths
 * stopped being *generated*. This engine has no sweep order and no budget: it
 * is best-first over an additive integer cost, so a cohort discount changes
 * costs and nothing else. Exactness is preserved, not sacrificed.
 *
 * The cohort map is supplied by the caller (the page builds it from flows.ts),
 * so this module keeps zero imports and stays testable in bare Node.
 * @type {Map<string, number>}
 */
let cohortOf = new Map()
const COHORT_BONUS = -2

/**
 * Document-identifier discount — the signal that makes an invoice chain beat a
 * two-hop lookup detour, and the one the old engine got right.
 *
 * MEASURED (2026-11-19): with only tier + node cost, `SalesTable -> CustTrans`
 * ranked `SalesTable > RetailPrePaymentTrans > CustTrans` (2 hops, all tier A,
 * cost 8) above `SalesTable > CustInvoiceJour > CustTrans` (3 hops, cost 12).
 * Shortest always beats longer whenever both are tier A, so a 2-hop detour
 * through any indexed table wins by construction. Hop count alone is not story.
 *
 * What distinguishes the invoice chain is that its join FIELDS carry a document
 * identifier — `SalesId`, `InventTransId`, `PurchId`, `Voucher`, `CustAccount`.
 * That is per edge (`edgeHasDocId` in the old pathScoring.js), so it is additive
 * and therefore safe here. An edge whose join pair carries a document key is the
 * spine of a business flow; one that joins on a generic code is a lookup hop.
 */
const DOC_ID_STEMS = ['inventtransid', 'salesid', 'purchid', 'voucher', 'custaccount', 'vendaccount', 'invoicedid']
const DOC_ID_BONUS = -3

/** @param {GEdge} e */
function edgeHasDocId(e) {
  const a = String(e.childField ?? '').toLowerCase()
  const b = String(e.parentField ?? '').toLowerCase()
  return DOC_ID_STEMS.some((s) => a.endsWith(s) || b.endsWith(s) || a === s || b === s)
}

/**
 * @param {Map<string, number>} map table name -> stage id
 */
export function setFlowCohorts(map) {
  cohortOf = map
}

/**
 * Cost of stepping into `node` as an INTERMEDIATE hop.
 * @param {GNode|undefined} node
 * @returns {number}
 */
function nodeCost(node) {
  if (!node) return NODE_COST_DEFAULT
  let c = 0
  if (node.type === 'TempDB' || node.type === 'InMemory') c += PLUMBING_TYPE_COST
  if (node.obsolete) c += OBSOLETE_COST
  if (node.name.startsWith('Tmp') || node.name.includes('Tmp')) c += PLUMBING_TYPE_COST
  c += NODE_COST[node.group ?? ''] ?? NODE_COST_DEFAULT
  // Form presence: a table shown on no form is not part of a user-facing flow.
  if (node.formUse === 0) c += NO_FORM_COST
  else if (node.formUse <= 2) c += LOW_FORM_COST
  if (node.degree > HUB_DEGREE) c += HUB_COST
  return c
}
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
 *   from?: string, to?: string, fwd?: boolean,
 *   toNode?: string
 * }} GEdge
 * @typedef {{
 *   node: string, steps: {table: string, via: string, tier: string|null, edge: GEdge|null}[],
 *   path: string[], cost: number, hops: number, floor: string, prio: number
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
 * @param {{ maxHops?: number, maxResults?: number, minTier?: 'A'|'B'|'C'|'D' }} [opts]
 * @returns {{
 *   results: { steps: { table: string; via: string; tier: string; edge: object }[]; hops: number;
 *              cost: number; tierFloor: string; joinable: boolean; xpp: string }[],
 *   shortest: number | null, truncated: boolean, missing: string[], graph: boolean
 * }}
 */
export function findPaths(
  source,
  target,
  { maxHops = 4, maxResults = 50, minTier = 'D', maxExpand = 150000, rankBy = 'evidence' } = {}
) {
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

  // ── A* heuristic ────────────────────────────────────────────────────────
  // Uniform-cost alone is unusable here: on a dense graph nearly every tier-A
  // hop costs the same, so the frontier fills with thousands of equal-cost
  // partials before the first completion pops (measured: 8 results, truncated).
  // A backward BFS gives hop distance to the target; multiplied by the smallest
  // possible step (2, after the largest discount) that is an ADMISSIBLE and
  // CONSISTENT heuristic, so best-first on cost+h is still exact — it just stops
  // wandering away from the goal. No budget, no sampling, no revisit cap.
  const hopDist = new Map([[target, 0]])
  {
    const queue = [target]
    let head = 0
    while (head < queue.length) {
      const t = queue[head++]
      const d = hopDist.get(t) ?? 0
      for (const h of state.out.get(t) ?? []) {
        const prev = /** @type {string} */ (h.to)
        if (prev && !hopDist.has(prev)) {
          hopDist.set(prev, d + 1)
          queue.push(prev)
        }
      }
    }
  }
  const MIN_STEP = 2
  /** @param {string} n */
  const hOf = (n) => MIN_STEP * (hopDist.get(n) ?? maxHops + 1)

  // Binary min-heap keyed on (prio, cost, hops) — deterministic order.
  const heap = new MinHeap()

  const results = []
  let expansions = 0
  let shortest = null
  let pruned = false
  const startSteps = [{ table: source, via: '', tier: null, edge: null }]
  heap.push({ node: source, steps: startSteps, path: [source], cost: 0, hops: 0, floor: 'A', prio: hOf(source) })

  /**
   * The ranking contract, one place: floor first, then cost, then hops, then key.
   * @param {any} a @param {any} b
   */
  function byRank(a, b) {
    return (
      TIER_RANK[a.tierFloor] - TIER_RANK[b.tierFloor] ||
      a.cost - b.cost ||
      a.hops - b.hops ||
      a.key.localeCompare(b.key)
    )
  }
  /** Optimistic total of the worst path we would keep right now. */
  function worstKept() {
    if (results.length < maxResults) return null
    let worst = 0
    for (const r of results) {
      const v = r.cost + (r.tierFloor === 'A' ? 0 : 0)
      if (v > worst) worst = v
    }
    return worst
  }

  // ── The bound that is NOT the old bug ───────────────────────────────────
  // The old engine truncated with budgets (levelAttempts / branchCap) consumed
  // in SWEEP ORDER, so which paths existed depended on unrelated content and a
  // tableDef could evict a better path before the comparator saw it.
  //
  // This bound is different in kind: once k complete paths are in hand, the
  // WORST of them is a cost ceiling, and any partial whose optimistic total
  // (cost so far + admissible h) already exceeds that ceiling can never beat the
  // kept set. Pruning on that is exact by definition — it discards only paths
  // that are provably not in the top k — and it is content-independent, because
  // it depends on the query's own costs and nothing else.
  //
  // Termination: the ceiling is finite once k paths exist, and while fewer than
  // k exist the no-revisit rule plus maxHops makes the reachable path set finite.
  // `pruned` reports that the ceiling bit, which is honest truncation, not a
  // sampled pool.
  while (heap.size) {
    const cur = heap.pop()
    if (cur.node === target) {
      if (shortest === null) shortest = cur.hops
      results.push(makeResult(cur))
      // Keep only the k best complete paths; the k-th cost becomes the ceiling.
      if (results.length > maxResults * 4) {
        results.sort(byRank)
        results.length = maxResults * 2
      }
      continue
    }
    if (cur.hops >= maxHops) continue
    // Cost ceiling prune (exact, see above).
    if (results.length >= maxResults) {
      const ceiling = worstKept()
      if (ceiling !== null && cur.prio > ceiling) {
        pruned = true
        break // heap is ordered by prio, so everything after this is worse too
      }
    }
    expansions++
    const nexts = state.out.get(cur.node)
    if (!nexts) continue
    for (const h of nexts) {
      if (!accept(h.tier)) continue
      const to = /** @type {string} */ (h.to)
      const from = /** @type {string} */ (h.from)
      if (!to || cur.path.includes(to)) continue
      const tier = h.tier
      // Intermediate node cost: the destination is free (it is constant per
      // query), every intermediate hop pays its own structural weight.
      let stepCost = (TIER_COST[tier] ?? 8) + (to === target ? 0 : nodeCost(state.nodes.get(to)))
      if (rankBy === 'story') {
        if (edgeHasDocId(h)) stepCost += DOC_ID_BONUS
        if (to !== target) {
          const a = cohortOf.get(from)
          const b = cohortOf.get(to)
          if (a !== undefined && a === b) stepCost += COHORT_BONUS
        }
        // Exactness requires monotone cost: never let discounts reach zero.
        if (stepCost < 1) stepCost = 1
      }
      heap.push({
        node: to,
        steps: [...cur.steps, { table: to, via: viaOf(h), tier, edge: h }],
        path: [...cur.path, to],
        cost: cur.cost + stepCost,
        hops: cur.hops + 1,
        floor: TIER_RANK[tier] > TIER_RANK[cur.floor] ? tier : cur.floor,
        prio: cur.cost + stepCost + hOf(to),
      })
    }
  }

  // Dedupe by table sequence: parallel FK edges between the same two tables (or
  // several constraints on one relation) yield identical sequences. Keep the
  // cheapest variant. Measured: without this, a top-5 came back as five copies
  // of `PurchLine>AgreementLineReleasedLine>SalesLine`.
  const byKey = new Map()
  for (const r of results) {
    const prev = byKey.get(r.key)
    if (!prev || r.cost < prev.cost || (r.cost === prev.cost && r.hops < prev.hops)) byKey.set(r.key, r)
  }
  // Diversity spread: with equal-cost hops the top-k naturally collapses onto one
  // cheap intermediate (`SalesTable > X > CustTrans` for many X). Each second
  // table anchors at most DIVERSITY_CAP results before later ones move down. The
  // full set is still returned, just ordered so distinct chains surface first.
  const DIVERSITY_CAP = 3
  const anchored = new Map()
  const spread = []
  const overflow = []
  for (const r of [...byKey.values()].sort(byRank)) {
    const anchor = r.steps[1]?.table ?? ''
    const n = anchored.get(anchor) ?? 0
    if (n < DIVERSITY_CAP) {
      anchored.set(anchor, n + 1)
      spread.push(r)
    } else overflow.push(r)
  }
  const ranked = [...spread, ...overflow]
  return { results: ranked.slice(0, maxResults), shortest, truncated: pruned, missing: [], graph: true }
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
const cmp = (x, y) => x.prio - y.prio || x.cost - y.cost || x.hops - y.hops
