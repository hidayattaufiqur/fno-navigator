/**
 * Scoped exhaustive path engine for the FnO Navigator relation graph.
 *
 * ── WHY THIS REPLACED THE BEST-FIRST PRUNED ENGINE ────────────────────────
 * The previous implementation was A* with a cost-ceiling prune. It shipped with
 * an exactness defect: `maxResults: 50` was not an ordered prefix of
 * `maxResults: 200`, so which paths existed depended on how many were asked for.
 * Three independent causes were found and each fixed in turn:
 *
 *   1. A "diversity spread" reordered results round-robin by second table, so
 *      the ordering depended on the size of the candidate pool.
 *   2. `MIN_STEP = 2` for the heuristic while `stepCost` clamped to 1 — an
 *      INADMISSIBLE heuristic, so A* popped paths out of order.
 *   3. The prune compared raw result counts while output deduped by table
 *      sequence, so it could stop while only 46 DISTINCT paths existed.
 *
 * Fixing (3) properly by keying the ceiling on distinct paths blew the frontier
 * and OOM'd at 4 GB. That was the signal to stop repairing and change approach.
 *
 * ── THE CURRENT CONTRACT ──────────────────────────────────────────────────
 * Search is EXHAUSTIVE DFS over a bounded hop count, restricted to the curated
 * flagship subgraph (six flows, ~143 tables, ~1,190 edges). Measured: the
 * densest pair yields ~20k simple paths at maxHops 4 in ~150 ms. At that size
 * enumeration is complete, so it needs no prune, no heuristic and no budget.
 *
 * Exactness is therefore a STRUCTURAL property, not an argued one: with no
 * pruning there is nothing that can depend on `maxResults`. k=50 is always the
 * first 50 of k=200, because both are slices of the same sorted enumeration.
 * `tests/prefix-exactness.mjs` asserts it and must stay green.
 *
 * ── WHY RANKING IS CURATED, NOT DERIVED ───────────────────────────────────
 * Canonical paths are pinned from `canonical-fixtures.json` — 37 chains
 * arbitrated by a D365FO domain owner, each validated hop-by-hop against
 * declared AOT relations. Schema signals provably cannot recover business
 * intent: sweeping a hub penalty from 0 to 30 left all 7 authored-vs-graph
 * disagreements at 0/7, because `Currency` (degree 1147) is a legal 2-hop
 * bridge between almost any pair and penalising hubs just promotes the next
 * lookup table. So the pinned canonical path is authoritative and the ranked
 * list is the fallback for pairs with no canonical entry.
 */

/** @type {Record<string, number>} highest tier (worst) sorts last */
const TIER_RANK = { A: 0, B: 1, C: 2, D: 3 }

/** @type {Record<string, number>} hop cost by tier — display only, not search */
const TIER_COST = { A: 4, B: 6, C: 9, D: 14 }

/**
 * Node cost, used ONLY to order the exhaustive result list. It never influences
 * which paths are enumerated, so it cannot cause the old starvation defect.
 */
const NODE_COST = {
  Main: 3,
  WorksheetHeader: 4,
  WorksheetLine: 4,
  Transaction: 3,
  TransactionHeader: 4,
  TransactionLine: 4,
  Reference: 0,
  Group: 2,
  Parameter: 1,
  Staging: 6,
  Framework: 0,
}
const NODE_COST_DEFAULT = 1
const NO_FORM_COST = 4
const LOW_FORM_COST = 2
const PLUMBING_TYPE_COST = 6
const OBSOLETE_COST = 12
const HUB_DEGREE = 300
const HUB_COST = 3

/**
 * Document-identifier discount. An edge whose join pair carries a document key
 * (`SalesId`, `InventTransId`, `Voucher`, …) is the spine of a business flow; one
 * joining on a generic code is a lookup hop. Measured to matter: without it the
 * invoice chain loses to a two-hop lookup detour.
 */
const DOC_ID_STEMS = ['inventtransid', 'salesid', 'purchid', 'voucher', 'custaccount', 'vendaccount', 'invoicedid']
const DOC_ID_BONUS = -3

/** table name -> stage id, supplied by the caller from flows.ts */
let cohortOf = new Map()
/** table name -> {flow, stage} for stage-progression ranking */
let stageOf = new Map()

/**
 * @param {Map<string, number>} map
 */
export function setFlowCohorts(map) {
  cohortOf = map
}

/**
 * @param {Map<string, {flow: string, stage: number}>} map
 */
export function setFlowStages(map) {
  stageOf = map
}

/**
 * @typedef {{
 *   child: string, childField: string, parent: string, parentField: string,
 *   tier: string, composite: boolean, conditional: boolean,
 *   from?: string, to?: string, toNode?: string
 * }} GEdge
 *
 * @typedef {{
 *   node: string, steps: {table: string, via: string, tier: string|null, edge: GEdge|null}[],
 *   path: string[], cost: number, hops: number, floor: string
 * }} Partial
 */

/** @type {{ready: boolean, nodes: Map<string, any>, out: Map<string, GEdge[]>, meta: any}} */
const state = { ready: false, nodes: new Map(), out: new Map(), meta: null }

export const graphLoadState = { status: 'idle', error: '' }

/**
 * Load the graph artifact. A 404 is a normal state for a public clone with no
 * licensed D365FO environment — the caller falls back to the legacy engine and
 * must say so visibly.
 * @param {string} [url]
 */
export async function loadGraph(url = '/data/graph-compact.json') {
  if (state.ready) {
    graphLoadState.status = 'ready'
    return true
  }
  graphLoadState.status = 'loading'
  graphLoadState.error = ''
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = await res.json()
    indexGraph(raw)
    graphLoadState.status = 'ready'
    return true
  } catch (err) {
    graphLoadState.status = 'absent'
    graphLoadState.error = err instanceof Error ? err.message : String(err)
    return false
  }
}

/** @param {any} raw */
function indexGraph(raw) {
  const [nName, nKind, nGroup, nType, nObs, nCustom, nDegree, nFormUse] = raw.nodeSchema
  const [eChild, eChildField, eParent, eParentField, eTier, eFlags] = raw.edgeSchema

  // Node kind is stored as a small integer in the artifact (0=table, 1=entity,
  // 2=view). Names are restored here so callers never need the encoding.
  const KIND_NAMES = ['table', 'entity', 'view']
  for (const row of raw.nodes) {
    state.nodes.set(row[0], {
      name: row[0],
      kind: KIND_NAMES[Number(row[1])] ?? 'table',
      group: row[2],
      type: row[3],
      obsolete: row[4] === 1,
      custom: row[5] === 1,
      degree: row[6],
      formUse: row[7],
    })
  }

  let ei = 0
  for (const row of raw.edges) {
    const child = row[ei++]
    const childField = row[ei++]
    const parent = row[ei++]
    const parentField = row[ei++]
    const tier = row[ei++]
    const flags = row[ei++]
    ei = 0
    const composite = (flags & 1) !== 0
    const conditional = (flags & 2) !== 0
    const edge = { child, childField, parent, parentField, tier, composite, conditional }
    // Both directions are traversable: a declared relation is navigable either
    // way, and the path finder must be able to walk up as well as down.
    push(child, { ...edge, from: child, to: parent, toNode: parent })
    push(parent, { ...edge, from: parent, to: child, toNode: child })
  }

  state.meta = {
    ...raw.coverage,
    schema: raw.schema,
    generatedFrom: raw.generatedFrom,
    nodeCount: state.nodes.size,
  }
  state.ready = true

  /** @param {string} from @param {GEdge} e */
  function push(from, e) {
    const list = state.out.get(from)
    if (list) list.push(e)
    else state.out.set(from, [e])
  }
}

export function isGraphReady() {
  return state.ready
}

export function getGraphMeta() {
  return state.meta
}

/** @param {string} name */
export function getNode(name) {
  return state.nodes.get(name) ?? null
}

export function getNodeNames() {
  return [...state.nodes.keys()]
}

/** @param {any} node */
function nodeCost(node) {
  if (!node) return NODE_COST_DEFAULT
  /** @type {Record<string, number>} */
  const table = NODE_COST
  let c = table[String(node.group)] ?? NODE_COST_DEFAULT
  if (node.formUse === 0) c += NO_FORM_COST
  else if (node.formUse <= 2) c += LOW_FORM_COST
  if (node.type === 'TempDB' || node.type === 'InMemory') c += PLUMBING_TYPE_COST
  if (node.obsolete) c += OBSOLETE_COST
  if (node.degree > HUB_DEGREE) c += HUB_COST
  return c
}

/** @param {GEdge} e */
function edgeHasDocId(e) {
  const a = String(e.childField ?? '').toLowerCase()
  const b = String(e.parentField ?? '').toLowerCase()
  return DOC_ID_STEMS.some((s) => a.endsWith(s) || b.endsWith(s) || a === s || b === s)
}

/**
 * ── CARTESIAN-BRIDGE DETECTION ─────────────────────────────────────────────
 * Measured hazard, not a guess. `SalesTable.CurrencyCode` and
 * `CustTrans.CurrencyCode` BOTH reference `Currency.CurrencyCode` (a field
 * referenced by 1,135 tables). So the path
 *
 *     SalesTable > Currency > CustTrans
 *
 * joins every sales order to every customer transaction that shares a currency —
 * a cartesian product, not a relationship. A developer pasting that into X++
 * gets silent row multiplication.
 *
 * WHY DEGREE ALONE IS NOT THE SIGNAL (measured 2026-11-19): classifying hubs by
 * TableGroup + relation degree flagged `InventTransOrigin`, `PurchTable` and
 * `SalesTable` — including 6 of the 37 canonical chains. `InventTransOrigin` has
 * in-degree 303 and is the REQUIRED bridge from SalesLine/PurchLine/ProdTable to
 * InventTrans. A degree rule would have warned on correct answers, and 72% of all
 * fallback paths touched some high-degree table, so it would have been noise.
 *
 * THE ACTUAL SIGNATURE is narrower and correct: a mid-path table is dangerous
 * when we enter it on one field and leave on the SAME field, because both
 * neighbours then constrain the same key and their rows pair up freely.
 *   - `SalesTable > Currency > CustTrans`  enter+leave on CurrencyCode   → hazard
 *   - `SalesLine > InventTransOrigin > InventTrans`  enter on RecId,
 *     leave on InventTransId                                             → safe
 * That is a per-path check on the hop fields, so it needs no curated allowlist
 * and cannot drift.
 */

/**
 * Classify a mid-path table as a potentially row-multiplying bridge.
 * @param {string} table
 * @param {GEdge} inEdge edge used to arrive at `table`
 * @param {GEdge} outEdge edge used to leave `table`
 * @returns {{table: string, field: string, reason: 'same-field-cartesian'|'setup-bridge'} | null}
 */
function bridgeRisk(table, inEdge, outEdge) {
  if (!inEdge || !outEdge) return null
  const node = state.nodes.get(table)
  if (!node) return null

  // The field we arrive on and the field we leave on, both expressed as the
  // column ON THIS TABLE.
  //
  // Traversal direction is carried by `.to`: in a reversed hop `.to` is the
  // PARENT, so arriving there means the join column is `parentField`. Getting
  // this backwards reads the neighbour's column instead of ours and the hazard
  // silently never fires (measured: the Currency check read `CurrencyCode` on
  // one side and `Currency.CurrencyCode` on the other, so they compared unequal).
  const arrivedOn = inEdge.to === table ? inEdge.parentField : inEdge.childField
  const leftOn = outEdge.to === table ? outEdge.childField : outEdge.parentField

  const a = String(arrivedOn ?? '').toLowerCase()
  const b = String(leftOn ?? '').toLowerCase()

  // Same field on both hops: both neighbours constrain one key, so their rows
  // combine freely. This is the cartesian signature.
  if (a && b && a === b) {
    const field = arrivedOn
    // Only flag when the table is actually broad enough for it to matter. A
    // same-field hop through a two-row table is harmless.
    if (node.degree >= HUB_DEGREE || /currency|cashdisc|unitofmeasure|numberSequence|dimension/i.test(table)) {
      return { table, field, reason: 'same-field-cartesian' }
    }
  }

  // Setup table entered and left on different fields is still a weak bridge
  // worth a quieter note when it is genuinely a setup group with huge breadth.
  const group = String(node.group ?? '')
  if ((group === 'Group' || group === 'Reference' || group === 'Parameter') && node.degree > HUB_DEGREE) {
    return { table, field: arrivedOn ?? '', reason: 'setup-bridge' }
  }

  return null
}

/**
 * Bridge risks across a whole path.
 * @param {{table: string, edge: GEdge|null}[]} steps
 */
function bridgeRisks(steps) {
  const out = []
  // Intermediates are steps[1..length-2]. For a 2-hop path there is exactly one
  // (index 1), so the bound must be `<= length - 2`, not `< length - 1`.
  // Off-by-one here meant every 2-hop path — including the Currency hazard this
  // check exists for — was never examined at all.
  for (let i = 1; i <= steps.length - 2; i++) {
    const risk = bridgeRisk(steps[i].table, steps[i].edge, steps[i + 1].edge)
    if (risk && !out.some((r) => r.table === risk.table)) out.push(risk)
  }
  return out
}

/** @param {GEdge} e */
function viaOf(e) {
  return `${e.child}.${e.childField} → ${e.parent}.${e.parentField}`
}

/**
 * ── RELATION CLASS: header → line ─────────────────────────────────────────
 * Microsoft assigns `TableGroup` to encode what a table IS in a document:
 * `WorksheetHeader`/`TransactionHeader` hold the document, the matching
 * `WorksheetLine`/`TransactionLine` hold its rows. Measured on the artifact: 918
 * standard header→line relations across 680 distinct table pairs.
 *
 * WHY THIS NEEDS TO BE FIRST-CLASS (defect 2026-11-19): `SalesLine -> SalesTable`
 * is the textbook header/line relation — `SalesLine.SalesId -> SalesTable.SalesId`
 * is declared — but it is tier D (no FK index) while six 2-hop detours are tier A,
 * two of them cartesian. The finder returned the detours and demoted the real
 * answer to "weakest hop C". The user's report was blunt and correct: the tool knew
 * `SalesTable` is a header and `SalesLine` is its line and still got it wrong.
 *
 * The signal was already in the artifact as a cost multiplier. A cost term is
 * washed out by tier; a relation CLASS is not. 44% of standard header→line
 * relations are tier C or D (A 332 / B 43 / C 141 / D 402), so tier alone cannot
 * separate them from noise — tier measures enforcement, not meaning.
 */
const HEADER_GROUPS = { WorksheetHeader: 'WorksheetLine', TransactionHeader: 'TransactionLine' }

/**
 * Is this hop a header/line relation? Requires the groups to match AND the line
 * to join on the header's own identifier, which is what distinguishes "this line
 * belongs to that header" from "this line shares an attribute with that header".
 * @param {GEdge} e @returns {boolean}
 */
function isHeaderLineEdge(e) {
  const childNode = state.nodes.get(e.child)
  const parentNode = state.nodes.get(e.parent)
  if (!childNode || !parentNode) return false
  const cg = String(childNode.group ?? '')
  const pg = String(parentNode.group ?? '')
  const childField = String(e.childField ?? '').toLowerCase()
  const parentField = String(e.parentField ?? '').toLowerCase()

  // child is the line, parent is the header
  if (HEADER_GROUPS[pg] === cg) {
    const keyJoin = childField === parentField || parentField === 'recid' || childField.endsWith('recid')
    if (keyJoin) return true
  }
  // parent is the line, child is the header
  if (HEADER_GROUPS[cg] === pg) {
    const keyJoin = childField === parentField || childField === 'recid' || parentField.endsWith('recid')
    if (keyJoin) return true
  }
  return false
}

/**
 * Documented stage progression penalty. Lower is better.
 *
 * This is the signal that lifts the invoice chain from rank ~800 to rank 1 on
 * `SalesTable -> CustTrans`. A path that advances through the stages of one
 * workflow is the business story; a path that jumps flows or walks backwards is
 * a lookup detour. Tables absent from every flow are penalised, not assumed good.
 * @param {string[]} path
 */
function stagePenalty(path) {
  let p = 0
  let prev = null
  for (const t of path) {
    const s = stageOf.get(t)
    if (!s) {
      p += 12
      continue
    }
    if (prev) {
      if (s.flow !== prev.flow) p += 10
      else if (s.stage < prev.stage) p += 8
    }
    prev = s
  }
  return p
}

/**
 * Rank a path. `rankBy: 'canonical'` puts documented stage progression first;
 * `'evidence'` uses AOT facts only. Both are exact over the same enumeration —
 * they differ in ordering, never in which paths exist.
 */
function makeRanker(rankBy) {
  // A direct relation always outranks a detour. If the two tables declare a
  // relation, that relation is the answer to "how do these connect"; multi-hop
  // routes are alternatives, not improvements. Without this, tier-first ordering
  // put two tier-A hops above the tier-C direct relation, which reads as the
  // tool refusing to show the obvious answer.
  // A header→line relation outranks everything. It is the document's own spine,
  // and 44% of them are tier C/D, so tier cannot be trusted to surface them.
  /** @param {any} a @param {any} b */
  const classFirst = (a, b) => (a.relationClass === 'header-line' ? 0 : 1) - (b.relationClass === 'header-line' ? 0 : 1)
  /** @param {any} a @param {any} b */
  const directFirst = (a, b) => (a.hops === 1 ? 0 : 1) - (b.hops === 1 ? 0 : 1)
  if (rankBy === 'canonical') {
    return (a, b) =>
      classFirst(a, b) ||
      directFirst(a, b) ||
      a.story - b.story ||
      TIER_RANK[a.tierFloor] - TIER_RANK[b.tierFloor] ||
      a.cost - b.cost ||
      a.hops - b.hops ||
      a.key.localeCompare(b.key)
  }
  return (a, b) =>
    classFirst(a, b) ||
    directFirst(a, b) ||
    TIER_RANK[a.tierFloor] - TIER_RANK[b.tierFloor] ||
    a.cost - b.cost ||
    a.hops - b.hops ||
    a.key.localeCompare(b.key)
}

/**
 * @typedef {{
 *   steps: {table: string, via: string, tier: string|null, edge: GEdge|null}[],
 *   path: string[], key: string, hops: number, cost: number,
 *   story: number, tierFloor: string, joinable: boolean, xpp: string,
 *   canonical: boolean, relationClass: string|null,
 *   bridges: {table: string, field: string, reason: string}[]
 * }} PathResult
 */

/**
 * Enumerate every simple path source→target within maxHops and rank them.
 *
 * Exhaustive by design. There is deliberately no prune, no expansion budget and
 * no heuristic: those are exactly the constructs that made the previous engine's
 * output depend on `maxResults`, and enumeration at flagship scope is cheap
 * enough (~150 ms worst measured) that none of them are needed.
 *
 * @param {string} source
 * @param {string} target
 * @param {{
 *   maxHops?: number, maxResults?: number, minTier?: 'A'|'B'|'C'|'D',
 *   rankBy?: 'evidence'|'canonical', scope?: Set<string>|null,
 *   canonicalChains?: string[][]|null
 * }} [opts]
 * @returns {{
 *   results: PathResult[], shortest: number|null, truncated: boolean,
 *   missing: string[], graph: boolean, enumerated: number, canonical: string[]|null
 * }}
 */
export function findPaths(
  source,
  target,
  { maxHops = 4, maxResults = 50, minTier = 'D', rankBy = 'canonical', scope = null, canonicalChains = null } = {}
) {
  const empty = {
    results: [],
    shortest: null,
    truncated: false,
    missing: [],
    graph: state.ready,
    enumerated: 0,
    canonical: null,
  }
  if (!state.ready) return empty

  const missing = [...new Set([source, target])].filter((t) => !state.nodes.has(t))
  if (missing.length) return { ...empty, missing }

  if (source === target) {
    return {
      ...empty,
      results: [
        {
          steps: [{ table: source, via: '', tier: 'A', edge: null }],
          path: [source],
          key: source,
          hops: 0,
          cost: 0,
          story: 0,
          tierFloor: 'A',
          joinable: false,
          xpp: '',
          canonical: false,
        },
      ],
      shortest: 0,
    }
  }

  const allowed = TIER_RANK[minTier] ?? 3
  /**
   * Tier gate for a hop.
   *
   * A DIRECT relation between the two endpoints is exempt. Measured 2026-11-19:
   * `SalesLine -> SalesTable` is a declared relation (tier C on InventRefId, tier
   * D on SalesId), so `minTier: 'A'` deleted the one-hop answer and the engine
   * returned six 2-hop detours instead — including cartesian bridges through
   * CustTable and Currency. That is strictly worse than showing the direct
   * relation with its honest tier: the user asked how two tables connect, and a
   * declared relation IS the answer.
   *
   * The gate still applies to every hop of a multi-hop route, which is what it
   * was for: keeping weak joins out of inferred chains.
   * @param {string} tier @param {string} to @param {number} depth
   */
  const accept = (tier, to, depth) => {
    if (depth === 1 && to === target) return true
    return (TIER_RANK[tier] ?? 3) <= allowed
  }

  /**
   * Traversal gate. When a scope is supplied, only tables inside it may be used
   * as INTERMEDIATES. The endpoints are always allowed: a user may legitimately
   * ask for a path to a table outside the curated six flows, and the UI labels
   * the answer best-effort.
   * @param {string} t
   */
  const usable = (t) => !scope || scope.has(t) || t === target || t === source

  /** @type {PathResult[]} */
  const found = []
  const path = [source]
  const onPath = new Set([source])
  const steps = [{ table: source, via: '', tier: /** @type {string|null} */ (null), edge: /** @type {GEdge|null} */ (null) }]
  let enumerated = 0

  /** @param {string} n @param {number} cost @param {string} floor */
  function dfs(n, cost, floor) {
    if (n === target && path.length > 1) {
      enumerated++
      const stepsCopy = steps.slice()
      const tiers = stepsCopy.slice(1).map((s) => s.tier)
      const tierFloor = tiers.reduce(
        (worst, t) => ((TIER_RANK[String(t)] ?? 3) > (TIER_RANK[worst] ?? 3) ? String(t) : worst),
        'A'
      )
      const relationClass = path.length === 2 && stepsCopy[1].edge && isHeaderLineEdge(stepsCopy[1].edge) ? 'header-line' : null
      found.push({
        relationClass,
        bridges: bridgeRisks(stepsCopy),
        steps: stepsCopy,
        path: path.slice(),
        key: path.join('>'),
        hops: path.length - 1,
        cost,
        story: stagePenalty(path),
        tierFloor,
        joinable: tiers.every((t) => t === 'A'),
        xpp: '',
        canonical: false,
      })
      return
    }
    if (path.length > maxHops) return
    for (const e of state.out.get(n) ?? []) {
      const to = /** @type {string} */ (e.to)
      if (!to || onPath.has(to) || !accept(e.tier, to, path.length) || !usable(to)) continue
      onPath.add(to)
      path.push(to)
      steps.push({ table: to, via: viaOf(e), tier: e.tier, edge: e })
      const step = (TIER_COST[e.tier] ?? 14) + (to === target ? 0 : nodeCost(state.nodes.get(to))) + (edgeHasDocId(e) ? DOC_ID_BONUS : 0)
      dfs(to, cost + Math.max(step, 1), TIER_RANK[e.tier] > TIER_RANK[floor] ? e.tier : floor)
      steps.pop()
      path.pop()
      onPath.delete(to)
    }
  }

  dfs(source, 0, 'A')

  // Dedupe by table sequence: parallel FK edges between the same two tables, and
  // several constraints on one relation, all yield the same sequence. Keep the
  // cheapest variant. Measured: without this a top-5 came back as five copies of
  // one chain.
  /** @type {Map<string, PathResult>} */
  const byKey = new Map()
  const ranker = makeRanker(rankBy)
  for (const r of found) {
    const prev = byKey.get(r.key)
    if (!prev) {
      byKey.set(r.key, r)
      continue
    }
    const cmp = ranker(r, prev)
    // A variant that exposes a bridge is strictly more informative than one that
    // does not, and bridge detection depends on WHICH columns this variant joins
    // on — so it outranks the comparator for same-sequence candidates.
    const rB = r.bridges?.length ?? 0
    const pB = prev.bridges?.length ?? 0
    if (rB !== pB) {
      // More detected bridges wins outright, in BOTH directions. Bridge detection
      // depends on WHICH columns a variant joins on, and parallel edges produce
      // several variants of one table sequence — so an unbridged sibling must
      // never take the slot from a bridged one.
      if (rB > pB) byKey.set(r.key, r)
      continue
    }
    if (cmp < 0) byKey.set(r.key, r)
  }

  /** @type {PathResult[]} */
  const ranked = [...byKey.values()].sort(ranker)

  // Canonical pinning. The arbitrated chain is authoritative: if it exists in the
  // enumeration it is reported first regardless of algorithm rank, because the
  // domain owner's answer outranks any scoring function. Measured need: two
  // arbitrated chains rank 108th and 147th on schema signals alone.
  //
  // It must SURVIVE the minTier filter too. Measured 2026-11-19: 10 of 37
  // arbitrated chains contain a C or D hop (SalesTable>SalesLine is tier C,
  // CustInvoiceJour>CustTrans is tier D), so `minTier: 'A'` used to delete the
  // canonical answer for those pairs and leave only inferred rows. minTier
  // filters EVIDENCE; the canonical chain is already arbitrated, so filtering it
  // by evidence contradicts why it is pinned. Rebuilt from the graph here rather
  // than looked up in `ranked`, so it appears even when the filter excluded it.
  let canonical = null
  const chains = canonicalChains ?? []
  for (const chain of chains) {
    if (chain[0] !== source || chain[chain.length - 1] !== target) continue
    canonical = chain
    const key = chain.join('>')
    const hit = byKey.get(key)
    if (hit) {
      hit.canonical = true
      const at = ranked.indexOf(hit)
      if (at > 0) {
        ranked.splice(at, 1)
        ranked.unshift(hit)
      }
    } else {
      const rebuilt = rebuildChain(chain)
      if (rebuilt) {
        rebuilt.canonical = true
        ranked.unshift(rebuilt)
      }
    }
    break
  }

  const shortest = ranked.reduce((m, r) => (r.hops > 0 && r.hops < m ? r.hops : m), Number.MAX_SAFE_INTEGER)
  const out = ranked.slice(0, maxResults).map((r) => ({ ...r, xpp: r.joinable ? xppFor(r.steps) : '' }))

  return {
    results: out,
    shortest: shortest === Number.MAX_SAFE_INTEGER ? null : shortest,
    // `truncated` reports that more paths exist than were returned. With
    // exhaustive enumeration this is now purely a display fact about
    // maxResults — NOT a statement that the search was cut short.
    truncated: ranked.length > maxResults,
    missing: [],
    graph: true,
    enumerated,
    canonical,
  }
}

/**
 * Reconstruct a known chain directly from the graph, bypassing the search filters.
 *
 * Used only for arbitrated canonical chains. Every hop must still be a declared
 * relation in the right direction — if any hop is missing the chain is rejected
 * rather than partially rendered, because a canonical path with an invented hop
 * is exactly the failure this project has hit twice.
 * @param {string[]} chain
 * @returns {PathResult|null}
 */
function rebuildChain(chain) {
  const steps = [{ table: chain[0], via: '', tier: /** @type {string|null} */ (null), edge: /** @type {GEdge|null} */ (null) }]
  const tiers = []
  let cost = 0
  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i]
    const to = chain[i + 1]
    const edge = (state.out.get(from) ?? []).find((e) => e.to === to)
    if (!edge) return null
    steps.push({ table: to, via: viaOf(edge), tier: edge.tier, edge })
    tiers.push(edge.tier)
    cost += Math.max((TIER_COST[edge.tier] ?? 14) + (to === chain.at(-1) ? 0 : nodeCost(state.nodes.get(to))) + (edgeHasDocId(edge) ? DOC_ID_BONUS : 0), 1)
  }
  const tierFloor = tiers.reduce((worst, t) => ((TIER_RANK[String(t)] ?? 3) > (TIER_RANK[worst] ?? 3) ? String(t) : worst), 'A')
  return {
    relationClass: steps.length === 2 && steps[1].edge && isHeaderLineEdge(steps[1].edge) ? 'header-line' : null,
    steps,
    path: chain.slice(),
    key: chain.join('>'),
    hops: chain.length - 1,
    cost,
    story: stagePenalty(chain),
    tierFloor,
    joinable: tiers.every((t) => t === 'A'),
    xpp: '',
    canonical: true,
    bridges: bridgeRisks(steps),
  }
}

/**
 * Generate an X++ select-join for a fully-joinable (all tier A) chain.
 *
 * Only legal when every hop is an indexed foreign key, because that is the only
 * case where the join is enforced by the database rather than merely declared.
 * Returns '' for anything weaker, so the UI can hide the copy action instead of
 * offering a join that might not work.
 * @param {{table: string, edge: GEdge|null}[]} steps
 */
export function xppFor(steps) {
  if (!steps || steps.length < 2) return ''
  const edges = steps.slice(1).map((s) => s.edge).filter(Boolean)
  if (!edges.length || edges.some((e) => e.tier !== 'A')) return ''

  const lines = [`select ${steps[0].table}`]
  for (let i = 1; i < steps.length; i++) {
    const e = steps[i].edge
    if (!e) return ''
    // @ts-ignore - e is narrowed non-null above
    // Orient the constraint in traversal direction: the table we arrived at is
    // the join target, the previous table is what it joins back to.
    const arrivedAt = steps[i].table
    const joinChild = arrivedAt === e.child ? e.child : e.parent
    const joinParent = arrivedAt === e.child ? e.parent : e.child
    const childField = arrivedAt === e.child ? e.childField : e.parentField
    const parentField = arrivedAt === e.child ? e.parentField : e.childField
    lines.push(`    join ${joinParent}`)
    lines.push(`        where ${joinChild}.${childField} == ${joinParent}.${parentField}`)
  }
  // X++ requires a statement terminator.
  return lines.join('\n') + ';'
}
