# TDD — Interactive WebGL Table Graph (Sigma + Graphology + FA2)

**Project:** fno-navigator (repo currently at `/home/smolpanda/Fun/Projects/fno-navigator`, canonical brief path `/home/smolpanda/Fun/Projects/fno-interactor`)
**Stack:** SvelteKit 2.70 + Svelte 5 runes, `adapter-static` `fallback:'index.html'`, `ssr=false` CSR-only, no Tailwind, `src/app.css` with `var(--clr-*)` + `html.light`
**Data:** `static/data/fk-map.json` 2.3 MB, `static/data/edge-specificity.json`, `src/lib/data/flows.ts` `canonicalModule()` 8 modules, `src/lib/pathfinder.js` bounded DFS + `src/lib/pathScoring.js` v2
**Author:** atlas — D365FO Solution Architect + Svelte/Sigma tech lead
**Date:** 2026-08-26
**Status:** Draft — locked grill decisions Q1–Q15 (verbatim), ready for implementation
**Related:** Second Brain reference implementation uses Sigma 3.0.3 + Graphology 0.26 + FA2 worker, `nodeReducer`/`edgeReducer` `hidden`, CSR-only

> **How to read:** Sections 1–10 are the contract. Every locked grill decision is quoted verbatim in its section header. File paths are absolute and verifiable. No assumption is presented as fact.

---

## 1 — Goals, Non-Goals & Success Metric

### 1.1 Locked priority (Q1 verbatim)

> **Q1 A Trace primary (10/10) B Neighborhood secondary (8/10) defer C Map 3/10. Success metric time to correct join field, rank-1 = class 3 documented path.**

- **A — Trace (primary, 10/10):** User picks `?from=&to=` and must find the *correct* join field sequence (`Child.Field → Parent.Field`) that answers the business question. Graph is the explainability layer for `findPaths()` results.
- **B — Neighborhood (secondary, 8/10, deferred):** Single-table neighborhood explorer (orbit view) is explicitly deferred to phase 2. The TDD augments the existing `RelationGraph.svelte` (orbit cap 24) rather than replacing it; its WebGL counterpart ships after A is stable.
- **C — Full Map (3/10, ponytail-deferred):** Interactive map of all 5,632 tables / 43,616 edges is *not* a goal. No “show all tables” view, no minimap, no minimap-clustering. See §10.

### 1.2 Success metric (verbatim)

> **time to correct join field, rank-1 = class 3 documented path**

- **Leading indicator:** Median time from `/find` search → user copies the correct `Child.Field → Parent.Field` label from a tooltip (instrument click-to-copy event; target < 45 s on golden pairs).
- **Correctness gate:** On the curated golden pair `InventTable → CustTable`, rank-1 result must be the story path `InventTable > InventTrans > InventTransOrigin > SalesLine > CustTable` with `qualityClass === 3` and visible badge `Business flow`. The existing noise path `InventTable > VendPackingSlipTrans > VendPackingSlipJour > VendTable > CustTable` must be `qualityClass <= 2` (proven in `src/lib/pathScoring.js` class rules). If rank-1 ever regresses to plumbing/generic, the feature fails acceptance even if rendering is correct.

### 1.3 Non-goals (explicit)

- No server, no SSR, no API — static site only (`ssr=false`, `adapter-static` `fallback:'index.html'`).
- No new dataset, no licensed D365FO metadata mirror ingestion — `static/data/fk-map.json` + `static/data/edge-specificity.json` remain the sole sources. Same provenance chain as `tools/generate-map.mjs` + `static/data/map-manifest.json`.
- No Tailwind, no new design system — reuse `src/app.css` tokens, `0xProto` font, `html.light` toggling.
- No `/graph` standalone route until A+B are stable (Q15).

---

## 2 — Data Contract & Caps

### 2.1 Artifacts (verified)

| Artifact | Absolute path | Size / shape | Provenance |
|---|---|---|---|
| FK map | `/home/smolpanda/Fun/Projects/fno-navigator/static/data/fk-map.json` | 2.3 MB, `{parentTable: [[childTable, parentField, childField], ...]}` — 5,632 totalReferencedTables, 43,616 directed edges, 5,587 tables, 713 selfEdges, 48 components | `tools/generate-map.mjs` → `static/data/map-manifest.json` `fingerprint: 1f6dea5...` `source: MicrosoftDynamicsTableAssociations` `af2a7c3` |
| Specificity | `/home/smolpanda/Fun/Projects/fno-navigator/static/data/edge-specificity.json` | 10.3 KB, inverted artifact: only `count > 10` entries, absent = bucket 3 (rare) | `tests/gen-edge-specificity.mjs` from same `fk-map.json` source |
| Modules | `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/utils.js` `canonicalModule()` + `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/data/flows.ts` `modules` | 8 canonical: `Sales`, `Procurement`, `Production`, `Inventory`, `Project`, `Finance`, `HR`, `Service` (+ `null` fallback) | Verified by grep; `canonicalModule()` is the single mapping — no duplicate list |
| Pathfinder | `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/pathfinder.js` `findPaths()` + `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/pathScoring.js` | Bounded BFS → guided DFS, `maxResults=50` default, `maxIterations=200k`, v2 `qualityClass 0–3` → `score@2dp` → `hops` → `diversity` → `key` | Grill t_3bf36e2e Q1–Q15 |
| FK stores | `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/stores/fkMap.js` `loadFkMap()` + `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/stores/specificity.js` `loadSpecificity()` + `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/stores/findState.js` `findState` | Module-level cache, `fkLoadState: idle|loading|ready|error`, `getForwardMap()`/`getReverseMap()` | Existing; reuse unchanged |
| Current graph | `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/components/RelationGraph.svelte` 465 lines orbit 24 cap | SVG, centre + satellites, `MIN_ORBIT_RADIUS=200`, pan/zoom `0.35–6x`, dedup by `from|to` merged `fields[]` | Keep as fallback |

### 2.2 Specificity buckets (Q9 contract)

```js
// From src/lib/pathScoring.js — shipped artifact is INVERTED
// absent keys = bucket 3 (rare)
uses > 1000 → 0
101–1000    → 1
11–100      → 2
≤10 / absent→ 3
```

`uses = edge-use count of (childField, parentTable)` pair. This drives edge thickness (§5).

### 2.3 Caps (Q4 verbatim)

> **Q4 40 Sigma / 24 SVG cap, specificity sorted rare first, Pager +N more, no 2-hop auto, count = table-pairs merged fields[].**

- **Sigma initial node cap:** 40 tables (distinct table names). Deterministic slice: after `findPaths()` returns up to 50 ranked paths (v2 order), build the ordered unique table set in rank order, then take first 40. Edges = every `findPaths` edge whose both endpoints are in that 40-set, **merged** to one edge per `from|to` table-pair, merging `fields[]` arrays (deduplicated) — see Q6.
- **SVG fallback cap:** unchanged `limit=24` in `getSchemaEdgesForTable()` (`src/lib/stores/fkMap.js:85`). The SVG `RelationGraph.svelte` orbit stays at 24.
- **Sorting for the 40:** Within each hop-level bucket, sort table-pairs by max specificity bucket descending (rare first), then by `qualityClass` of best path containing them. This surfaces rare, business-meaningful tables before hub/generic ones.
- **Overflow:** When distinct tables > 40, render `Pager` component (`src/lib/components/Pager.svelte` 2.2 KB) as `+N more` control. Paging is by *table*, not by path — next page replaces the least-specific tables; camera re-fits. No 2-hop auto-expansion; user must explicitly `Expand`.
- **Count display:** Every count shown in UI (“12 tables”, “Sales (12)”, badge counts) must count **merged table-pairs** (`from|to` deduped), not raw edges. Raw edge count (43,616) is never shown as a graph stat.

### 2.4 Module pill counts

- 8 canonical modules as returned by `canonicalModule()`; the 9th pill is `All`.
- Pills row shows `Sales (12)` etc — count = distinct tables in the *current* graph slice whose `canonicalModule(tableDefs[table]?.module)` equals that pill, per `src/lib/utils.js` mapping.

---

## 3 — Architecture

### 3.1 Data flow (one diagram)

```
fetch  ──►  loadFkMap()  ──►  forwardMap / reverseMap (module cache)
fetch  ──►  loadSpecificity()  ──►  specMap (module cache)
                                      │
              findPaths(source,target,maxHops,{sort}) ◄── findState (sourceTable,targetTable,maxHops,sortMode, graph,expand,modules)
                      │
                      │  (synchronous, 0–190 ms p50 @ 200k iter in /find existing bench)
                      ▼
              ordered paths (v2 rank)  ──►  slice 40 tables (rare-first)  ──►  build Graphology graph
                      │                                                    │
                      │ merged edges per table-pair                   wedge seed (x,y)
                      │ fields[] + max bucket + plumbing flag              │
                      ▼                                                    ▼
              Graphology.MultiDirectedGraph (+ initial positions) ──►  Sigma renderer (WebGL)
                      ▲
         expand() / reset / module filter (nodeReducer/edgeReducer `hidden`)
```

### 3.2 Component map (absolute paths, reuse-first)

| New file | Reuses / depends on | Responsibility |
|---|---|---|
| `src/lib/components/SigmaGraph.svelte` | `src/lib/stores/fkMap.js` `loadFkMap`/`getForwardMap`/`getReverseMap`; `src/lib/stores/specificity.js`; `src/lib/pathScoring.js` `isPlumbingTable`/`isNamedSystemKeyReference`; `src/app.css` tokens; `Pager.svelte`; `findState.js` | Sigma container, Graphology graph owner, FA2 driver, `nodeReducer`/`edgeReducer`, tooltip + copy, URL binding. CSR-only. |
| `src/lib/stores/graphState.js` | `findState.js` (extends URL shape); Svelte `writable` | Ephemeral graph UI state only (hoveredNode, popup graph, expanded set) — not persisted beyond history. |
| `src/lib/graph/layout.js` | `src/lib/utils.js` `canonicalModule`; `src/lib/pathScoring.js` | Pure functions: `wedgeSeed(table, idx, pathIdx, hop)` + `linearSeed(hop, pathIdx)` + `hash()` fallback. No side effects — unit-testable standalone. |
| `src/lib/graph/selectSlice.js` | `pathfinder.js` results + `specificity` map | Pure function: `selectSlice(paths, cap=40)` → `{nodes, mergedEdges}`. Handles dedup, rarity sort, thickness bucket. |

**Reuse strictly:**

- `fkLoadState`/`loadFkMap`/`getAllFkTableNames` — already in `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/stores/fkMap.js`. Do not duplicate fetching or parsing of `fk-map.json`.
- `specificityLoadState`/`getSpecificityMap` — reuse `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/stores/specificity.js`.
- `findState` — extend, do not fork. Current shape is `{sourceInput,targetInput,sourceTable,targetTable,maxHops,sortMode,pathResults,searchState,searchError,truncated,shortestHops,missing}` (`src/lib/stores/findState.js`). Add `graph`, `expand`, `modules` keys (Q12).
- `Pager.svelte` — reuse as-is for `+N more` and per-pane pagination.
- `RelationGraph.svelte` — keep, do not rewrite. Sigma augments it (Q13). Keep its orbit physics for fallback parity tests.

### 3.3 CSR lazy import (Q14 + Second Brain pattern)

```svelte
<!-- src/lib/components/SigmaGraph.svelte -->
<script>
  import { onMount } from 'svelte'
  let Sigma, Graph, FA2
  let loadErr = null
  onMount(async () => {
    try {
      // Single-await dynamic import — static build must split sigma into its own chunk (see §9)
      const [sigmaMod, graphologyMod, fa2Mod] = await Promise.all([
        import('sigma'),
        import('graphology'),
        import('graphology-layout-forceatlas2/worker')
      ])
      Sigma = sigmaMod.default
      Graph = graphologyMod.default
      FA2 = fa2Mod.default
    } catch (e) {
      loadErr = e // triggers SVG fallback, see §7
    }
  })
</script>

{#if loadErr}
  <RelationGraph {tableName} relations={fallbackRelations} />
{:else if !Sigma}
  <div class="mini" aria-busy="true">Loading graph…</div>
{:else}
  <div bind:this={container} class="sigma-container" />
{/if}
```

- **No top-level `import 'sigma'`** — fails the static build (`ssr=false` still evaluates top-level imports at build). Must be dynamic inside `onMount`.
- **`ssr = false`** is already set via `src/routes/+layout.js` (CSR-only whole site). Keep `app.html` `ssr=false` semantics: no sigma code may run outside `onMount`.
- **Version lock (from Second Brain reference):** `sigma@3.0.3`, `graphology@0.26`, `graphology-layout-forceatlas2` — pin exact minors in `package.json` to avoid FA2 worker API drift.

### 3.4 Graphology graph shape

```js
// For each table-pair slice, build:
import Graph from 'graphology'
const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: false })

// Node attrs (Sigma expects these keys; see sigma/settings)
graph.addNode(table, {
  label: table,
  x: wedgeX,                // from §6 wedgeSeed
  y: wedgeY,
  size: 2.5 + Math.min(degree, 24) * 0.25,  // Q2 size formula, degree = distinct neighbours
  color: moduleColor(canonicalModule(tableDefs[table]?.module)), // resolved from CSS var, see §7
  module: canonicalModule(tableDefs[table]?.module) ?? 'Other',
  degree,
  hidden: false              // driven by nodeReducer via visibleModules set
})

// Merged edge — one per directed table-pair
graph.addDirectedEdge(from, to, {
  label: fields.join(', '),  // full list for tooltip, see §5
  fields,                    // string[] — ["Child.Field → Parent.Field", ...]
  thickness: specificityBucket(fields), // 1–4 px, max bucket, see §5
  isPlumbing: isPlumbingEdge(fields),   // all fields plumbing && !namedRef
  source: 'merged',          // vs 'manual'/'schema' if we preserve — Q6 says merged only
  hidden: false
})
```

- `multi: true` retained for future per-field edges if split toggle ships (Q6 says OFF by default — `multi` costs nothing and future-proofs).
- Self-edges (`from === to`) excluded — `RelationGraph.svelte` does the same.

---

## 4 — UX Per Route

### 4.1 `/find` — Sigma pane (augments, does not replace list)

**Q13 verbatim:**

> **Q13 Augment /find Sigma pane + tables/[name] Tabs List|Graph Sigma after 24, keep SVG fallback <100 fast path, reuse afterNavigate+ResizeObserver.**

State machine: `searchState: idle|running|done`, `fkLoadState`, `specificityLoadState` remain the sources of truth. Sigma pane appears only when `graph=1` (flag, §9) and `searchState === 'done'` with `pathResults.length > 1`.

#### Wireframe (monospace, ASCII)

```
┌─ /find ───────────────────────────────────────────────────────────────┐
│  Source: [InventTable ▾]  ⇄  Target: [CustTable ▾]  maxHops: [3▾]    │
│  [Trace]  sort: (•) shortest  ( ) unique                             │
│                                                                      │
│  Shortest: 4 hops  •  Showing 40 of 63 tables  •  [Show plumbing ○] │ ← pill filters + toggle (Q10/Q11)
│  ┌─ module pills (row-wrap, above graph) ──────────────────────────┐ │
│  │ [All 40] [Sales (12)] [Inventory (9)] [Finance (7)] [HR (2)]…  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│  ┌─ Sigma pane (only when ?graph=1) ───────────────────────────────┐ │
│  │  ┌──────────────────────────────────────────────────────────┐    │ │
│  │  │                                                          │    │ │
│  │  │   ○─ ─ ─ ○  (faint dashed = plumbing)                  │    │ │
│  │  │    \   /                                                 │    │ │
│  │  │  ●──●──●  (thickness = rarity, size = degree)         │    │ │
│  │  │    /   \   hover edge → tooltip lists fields [copy]    │    │ │
│  │  │   ○─ ─ ─ ○                                              │    │ │
│  │  │                                                          │    │ │
│  │  │  [Reset] [Collapse LRU]   zoom: + − ⟳   legend          │    │ │
│  │  └──────────────────────────────────────────────────────────┘    │ │
│  │  Showing 40 tables • +23 more  [< Prev] [Next >]                │ ← Pager +N more (Q4)
│  └─────────────────────────────────────────────────────────────────┘ │
│  ┌─ Ranked path list (unchanged, always visible) ─────────────────┐ │
│  │  1  Business flow  score 12  4 hops  InventTable→…→CustTable    │ │
│  │     chips: document-id-continuity • named-reference-joins       │ │
│  │  2  score 8  3 hops  …                                           │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

- Sigma pane sits **between** the module pills row and the ranked list — so the list stays the primary artifact and the graph is the explainability companion (§1).
- Pane height: `min(520px, 56vh)` on desktop, `min(420px, 50vh)` on mobile, with `ResizeObserver` re-fitting camera (Second Brain pattern — reused from its implementation).
- When `graph` flag is off or results ≤ 1 or `fkLoadState !== 'ready'`, the pane is not rendered — no blank box, no “enable graph” upsell. User must opt in via `?graph=1` / localStorage (§9).

### 4.2 `tables/[name]` — Tabs List | Graph

**Route:** `/home/smolpanda/Fun/Projects/fno-navigator/src/routes/tables/[name]/+page.svelte` (load from `/home/smolpanda/Fun/Projects/fno-navigator/src/routes/tables/[name]/+page.js`)

Current page has sections stacked: header → fields → methods → relation graph (`RelationGraph`) → relations tables. TDD inserts a tab bar directly above the graph section; the SVG is the List tab, Sigma is the Graph tab.

```
┌─ /tables/InventTable ───────────────────────────────────────────────┐
│  InventTable  [Inventory]  One-liner …  [Trace paths from/to →]      │
│  ── Fields ────────────────────────────────────────────────────────┐ │
│  │  Field table  [Paginated Pager]                                 │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│  ── Relation graph — 7 documented + 14 schema FK ────── [List|Graph] │
│  ┌─ Tabs ───────────────────────────────────────────────────────────┐ │
│  │  (•) List   ( ) Graph          when edges ≤24, Graph tab after │ │
│  │  [Show plumbing ○]  [All] [Inventory(6)] [Sales(4)]…           │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│  Tab=List: <RelationGraph /> (orbit, pan/zoom 0.35–6x, unchanged)    │
│  Tab=Graph (Sigma): same container as /find but neighbourhood slice   │
│     centre = data.name, satellites = dedupedSchemaEdges +             │
│     relationsUsing merged, cap 40, ring seeds (Q5), warm FA2 500ms    │
│     [same module pills, same plumbing toggle, same tooltip/copy]      │
└──────────────────────────────────────────────────────────────────────┘
```

- **Tab visibility rule (verbatim Q13):** `Sigma after 24, keep SVG fallback <100 fast path`
  - `edges.length ≤ 24`: show List tab selected, Graph tab is present but labelled “Graph (24+)” and clicking it just shows same 24 with Sigma renderer (no pagination surprise).
  - `24 < edges ≤ 100`: List tab still default, Graph tab renders the full set in Sigma without pagination — “fast path” (FA2 warm 500 ms, no Pager needed).
  - `edges > 100`: Graph tab renders first 40 with `Pager +N more` (same Q4 rule).
- **Resize / nav lifecycle:** Reuse the existing `afterNavigate(() => {sidebarOpen=false})` pattern from `/home/smolpanda/Fun/Projects/fno-navigator/src/routes/+layout.svelte` — add `afterNavigate(() => graph?.refresh())` and a `ResizeObserver` on the graph container (Second Brain exactly does this; same code shape).

---

## 5 — Interaction Spec

### 5.1 Global invariants

- Every interaction that mutates URL does `history.replaceState` (not `pushState`) so back-button is view-history, not filter-history (Q12).
- Every interaction is keyboard-accessible: module pills are `<button>`, toggle is `<input type="checkbox" role="switch">`, tooltip has `aria-describedby`, `Enter`/`Space` activates node/edge.
- No interaction causes full page reload; Svelte `page.url.searchParams` is the source of truth, bound to `graphState` via `$page`.

### 5.2 Module pills (Q10 verbatim)

> **Q10 8+1 pills row-wrap above graph, visibleModules reducer hidden no re-layout, counts Sales (12), history.replaceState modules=...**

- Row-wrap flex container directly above Sigma canvas, `gap:6px`, `flex-wrap:wrap`. Tokens from `src/app.css` — `border:1px solid var(--clr-border)` etc.
- Pills = `['All', ...modules]` where `modules` is the 8-element export from `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/data/flows.ts` (not recomputed). `canonicalModule()` maps table → pill.
- Click pill: toggle that module in `visibleModules: Set<string>` (stored in `graphState` + URL `modules=Sales,Inventory`). `All` = set contains all 8 or is empty — treated identically. `All` is the default (no `modules` param in URL).
- Effect: `nodeReducer`/`edgeReducer` set `hidden = (mod not in visibleModules)` — **no re-layout**, no FA2 restart. This is the Second Brain `nodeReducer = (node, data) => ({...data, hidden: !visibleModules.has(data.module)})` pattern verbatim. Re-layout would disorient the user; `hidden` is GPU-cheap.

### 5.3 Plumbing toggle (Q11 verbatim)

> **Q11 Single Show plumbing OFF faint 0.18 dashed, thickness rare, no tier until suspect dataset.**

- Single checkbox `Show plumbing` (label text exactly that). Default `OFF`.
- OFF: plumbing edges (per §5.4) have `opacity 0.18`, `dashed 4px gap 4px`, `thickness` still driven by rarity bucket — so rare plumbing remains thicker than common plumbing, just faint. Nodes that are only reached via plumbing edges are **not** hidden.
- ON: plumbing edges revert to normal opacity (`0.30` light=`0.45` for outgoing, per `src/app.css` `--clr-edge-out`), solid lines, same thickness.
- Edges are classified once at graph-build time; toggle only mutates edge reducer `hidden`/`color` — no rebuild.
- No “tier” (plumbing severity levels) until a suspect dataset with declared plumbing tiers exists. This is an explicit ponytail deferral: the v2 `isPlumbingTable` + `isNamedSystemKeyReference` waiver are the only signals today. Do not invent a `plumbingTier` field.

### 5.4 Edge visual contract (Q2 + Q6 verbatim)

> **Q2 Node table+module size=degree 2.5+min(degree,24)*0.25, click→goto, edge field-level Child.Field→Parent.Field copy, plumbing faint thin dashed unless isNamedSystemKeyReference, thickness = max specificity bucket.**
> **Q6 Merged edge per table-pair, thickness max bucket, dash all-plumbing, tooltip lists all fields with copy, split toggle OFF.**

- **Node:**
  - Label = `table` + `module` pill colour (badge below label). `size = 2.5 + Math.min(degree, 24) * 0.25` — verified formula, `degree` from `getDegrees()` or `graph.degree(node)` post-build.
  - Click node → `goto('/tables/{table}')` via `sveltekit:$app/navigation` `goto`. On `/find` this navigates away (no modal). On `tables/[name]` with graph tab, clicking a satellite navigates to that satellite's page (same as orbit `onclick→goto`).
- **Edge (merged):**
  - `from|to` deduplicated; `fields: string[]` stores every constituent `Child.Field → Parent.Field` (preserve `via` triples from `fkMap` Exactly). `label` is `fields[0]` (short label); tooltip shows all.
  - `thickness` = max specificity bucket across all constituent fields — maps to pixels `bucket 0→1px, 1→2px, 2→3px, 3→4px` (or `size` in Sigma edge attrs; Sigma `edgeProgram` picks width). Rare edges are thicker by construction.
  - `dashed` = true iff **every** constituent field is plumbing (`isPlumbingField(field)` or `isPlumbingTable(child)` per `src/lib/pathScoring.js`) **and** the edge is **not** a `isNamedSystemKeyReference(edge)` waiver. One non-plumbing field makes the edge solid even when OFF (waiver survives toggle).
  - No per-field edge split. The split toggle (one edge per field) is OFF and hidden behind no UI — code may keep `multi:true` but renders merged only. Q6 is a ponytail deferral.
- **Cursor:** node `pointer`, edge `pointer` only when hovered (thickness ≥ 3 region), default `grab`.

### 5.5 Pop + Expand (Q5 verbatim)

> **Q5 Pop Goto/Expand(+N) warm incremental FA2 500ms (800ms cold), additive 120 cap + Reset/Collapse LRU, ring r=80 angle 2π*i/N, fixed existing, barnesHut+adjustSizes, camera.animate.**

Pop = clicking a node. Two affordances appear as an ephemeral card next to the node (like Second Brain's popover):

```
┌──────────────┐
│ InventTrans  │  ● Inventory  degree 47
│ [Goto →] [Expand (+12)]  ← +N = hidden neighbours not yet in the 40-set
└──────────────┘
```

- **Goto:** `goto('/tables/{table}')` immediately, no FA2.
- **Expand (+N):** Incrementally adds that node's hidden neighbours (up to the 120 global cap). Steps:
  1. Query `neighbours(table)` from forward+reverse maps (`src/lib/pathfinder.js: neighbours()` pattern — reuse same helper, now extracted to `src/lib/graph/neighbours.js` so both consumers import one function).
  2. Filter to neighbours not yet in `graph.order` (and not hidden by pills? No — pills control `hidden`, not graph membership; Expand adds to graph regardless of pill filter, but `hidden` still applies after).
  3. Sort by specificity bucket descending (rare first).
  4. Take `N = min(remainingTo120, neighbours.length)`; for each in sorted order, `graph.addNode(...)` with ring seed (see below), `graph.addDirectedEdge(...)` merged as per §5.4.
  5. Mark existing nodes `fixed = true` (Sigma/FA2 respects `fixed` attr to not move them). New nodes have `fixed = false`.
  6. Start FA2 worker with `barnesHutOptimization: true, adjustSizes: true, ...dynamic gravity...` for `warmMs = 500` (incremental) or `coldMs = 800` (first build). After timeout, `fa2.stop()`, set all nodes `fixed = false` again except keep them positioned.
  7. `camera.animate({duration: 450, easing: 'quadraticInOut'})` to fit the new bounds (Sigma camera API, same as Second Brain).

- **Additive & cap:** Expansions are additive across clicks (union), up to **120 nodes total**. When cap is reached, `Expand` buttons become disabled with tooltip `Cap reached (120) — Reset or Collapse to add more.`
- **Reset:** Button in graph chrome. Clears the graph back to the initial 40-slice and kills FA2.
- **Collapse LRU:** Button next to Reset. Evicts the least-recently-expanded batch (the oldest `Expand` call's nodes that are not on any displayed ranked path and have degree ≤ 3 after eviction). Keeps ranked-path infrastructure nodes. Eviction is by `graph.dropNode()` per node, then `camera.animate()`. One click collapses one batch; repeated clicks walk back through expansion history.
- **Ring seed (for Expand):** `r = 80` Graphology units, `angle = 2π*i/N`, position = `centreOfClickedNode + r*(cos angle, sin angle)`. Existing nodes are `fixed` during layout, so the ring is the initial condition, not the final layout — FA2 will repulse them into a sensible fan.

### 5.6 Tooltip + Copy

- **Trigger:** Hover edge (mouse) or focus edge (keyboard Tab → edge). Tooltip is a single portal `<div class="sigma-tooltip">` appended to `document.body`, positioned via `sigma.utils.getXToPixel()` translation — not per-edge DOM (Second Brain does the same).
- **Content (Q6):** For a merged edge, list **all** fields, one per line:
  ```
  SalesLine.InventDimId → InventDim.inventDimId   [copy]
  SalesLine.ItemId → InventTable.ItemId           [copy]
  ```
  Plus `thickness bucket` chip (`rare/common`) and `plumbing` chip if applicable. The `copy` affordance is a small `⎘` button per line that does `navigator.clipboard.writeText('SalesLine.InventDimId → InventDim.inventDimId')` and flashes `Copied` for 900 ms (reuse `TOOlTIP_COPY` pattern from `/home/smolpanda/Fun/Projects/fno-navigator/src/lib/findLegendCopy.js` if present, else inline).
- **Edge reducer hover:** Hovered edge `color = var(--clr-edge-out-h)` / `--clr-edge-in-h` (same as orbit), thickness +1, `zIndex` boosted. This uses Sigma `edgeReducer` — do not mutate the graph on hover, only the reducer return.

### 5.7 Pager & URL (Q4 + Q12 verbatim)

> **Q12 Extend ?from=&to=&maxHops=&sort= with graph=1&expand=commaList&modules=commaList, replaceState on toggle, progressive expand on mount, URL source of truth.**

- **Existing `/find` URL (contract, do not break):** `?from=InventTable&to=CustTable&maxHops=3&sort=shortest|unique` — handled in `/home/smolpanda/Fun/Projects/fno-navigator/src/routes/find/+page.svelte:52 onMount`.
- **New params (extend, not replace):**
  - `graph=1` — when present, auto-shows Sigma pane on mount (if `searchState==='done'`). Absence = no pane, no extra fetch. No `graph=0` value — removing the param means off.
  - `expand=SalesLine,InventDim` — comma-separated list of tables that were `Expand`-ed, in the order they were expanded. On mount with `graph=1`, after initial 40-slice is built, apply these expands **progressively** one by one, each with its own 500 ms FA2 pulse (not bulk add). This keeps the layout stable and lets the user observe each fan-out; progressive also makes URL-share reproducible (ordering matters for ring seed).
  - `modules=Sales,Finance` — comma-separated whitelist of visible modules. Absent or `All` = all visible. Must match canonical names exactly (case-sensitive matching against `canonicalModule()` output).
- **Wiring:** Every toggle/pill/expand mutates the URL via `history.replaceState(null, '', newUrl)` (SvelteKit `replaceState` helper or raw `history.replaceState`). Never `pushState`. On `popstate` / back-button, the `page` store updates and the graph re-reads params — URL is the source of truth, in-memory `visibleModules` and `expandedSet` are derived from it (single source; no dual-write sync bug).
- **Pager URL contract:** Paging the graph (`+N more`) does **not** write to URL — paging is transient and local. Only `graph`, `expand`, `modules` are URL-persisted. This keeps shared URLs short and avoids bloating `expand` with pagination state.

---

## 6 — Layout & Physics

### 6.1 Wedge seed + linear bias (Q7 + Q9 verbatim)

> **Q7 Wedge 45° per canonicalModule, radius 10+(i%7)*2 + jitter Graphology units, neighbor wedge, deterministic hash fallback.**
> **Q9 Force + linear seed bias x=hop*180 y=pathIdx*60+jitter, no Dagre until signal.**

Two seed strategies, composed:

1. **Wedge (primary, when table has known module):**
   ```js
   // src/lib/graph/layout.js — pure function, unit-testable
   const WEDGE_DEG = 45 // 360/8
   const MODULE_ORDER = ['Sales','Procurement','Production','Inventory','Project','Finance','HR','Service']
   // azimuth base = MODULE_ORDER.indexOf(canonicalModule(table)) * WEDGE_DEG
   // center azimuth = base + 22.5  (centre of wedge)
   export function wedgeSeed(table, idxInWedge, module, jiggle=0) {
     const base = MODULE_ORDER.indexOf(module) * 45 // -1 → hash fallback
     if (base === -1) return jitterFallback(table)
     const azimuth = (base + 22.5 + (Math.random()-0.5)*12) * Math.PI/180
     const radius = 10 + (idxInWedge % 7) * 2 + (Math.random()-0.5)*1.5
     return { x: radius*Math.cos(azimuth), y: radius*Math.sin(azimuth) }
   }
   // Neighbour wedge: neighbours[i] gets azimuth = wedge centre + (i%3 ? ± wedge)
   // so neighbour fans stay near their parent module's wedge
   export function neighbourWedgeSeed(parentModule, i) {
     const base = MODULE_ORDER.indexOf(parentModule) * 45 + 22.5
     const s = [0, 22.5, -22.5][i%3]
     const a = (base + s + (Math.random()-0.5)*8) * Math.PI/180
     return { x: 80*Math.cos(a), y: 80*Math.sin(a) } // ring r=80 for Expand
   }
   ```

   - `radius` uses `10 + (i%7)*2 + jitter` Graphology units (not pixels — Graphology coords are unit-space, Sigma maps to screen). `i` is the table's insertion order within its module wedge. Jitter `±0.75` prevents perfect spokes.
   - `deterministic hash fallback`: when `canonicalModule()==null`, `hash = fnv1a(table) % 8` picks a wedge index — same table always falls in same wedge, no random drift across reloads. Hash fallback is stable for “Other” tables.

2. **Linear seed bias (secondary, path trace axis):**
   ```js
   // When tables originate from a ranked path (Trace A), also bias by hop & path index:
   // x = hop*180  + jitter(±10)
   // y = pathIdx*60 + jitter(±8)
   // Final seed = weighted blend: 0.65 * wedgeSeed + 0.35 * linearSeed
   ```
   - This gives a left-to-right document flow hint without imposing a strict DAG (FA2 still owns the final layout). The blend keeps Finance tables generally bottom-right, Inventory middle, Sales top-left, while preserving the hop sequence.

3. **No Dagre** — even though Dagre would enforce a tidy left-to-right, it collapses module cohesion and requires a hard direction assumption that breaks undirected traversals. Ponytail deferral until user feedback explicitly asks for a dag mode (see §10).

### 6.2 FA2 settings (dynamic, Q8 verbatim)

> **Q8 Dynamic gravity 1+min(n,120)/60 (1.6→3), scalingRatio 3 slowDown 2, barnesHut+adjustSizes, warm 500ms cold 800ms.**

```js
// For both cold build (800 ms) and warm expand (500 ms):
const settings = {
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,          // default, not surfaced
  scalingRatio: 3,              // strong repulsion — hub tables (degree >100) push neighbours apart
  slowDown: 2,                  // half-speed convergence — fewer oscillations
  gravity: 1 + Math.min(graph.order, 120) / 60, // 1.0 at 0 nodes → 1.66 at 40 → 3.0 at 120
  adjustSizes: true,             // FA2 must respect node size * 0.25 scaling (prevents overlaps)
  strongGravityMode: false,
  linLogMode: false,
  outboundAttractionDistribution: false
}
```

- `gravity` formula verified: `1 + min(n,120)/60`. At 40 nodes (initial cap) gravity=1.66; at 120 (expand cap) =3.0; linear interpolation between. This is the Second Brain formula with different coefficients — keep the clamp at 120 so gravity doesn't explode past the cap.
- FA2 is the `graphology-layout-forceatlas2/worker` web-worker variant (Second Brain does the same) — runs off main thread, posts `tick` messages. Main thread only sets node `x/y` attrs and calls `sigma.refresh()` on each tick. Must call `worker.kill()` after `warmMs`/`coldMs` timeout.
- **Cold vs warm:** Cold = first path search for a `from/to` pair (graph empty → built). Warm = every `Expand` on an existing graph. The timeouts are wall-clock, not tick count — on a slow device 500 ms still yields ~30 ticks; on a fast device ~120 ticks. Both converge enough for the hub repulsion to separate.

### 6.3 Interaction between seed and FA2

- On cold build, set all nodes `x/y` to wedge+linear blend, start FA2 with `fixed: false` on all nodes, stop after 800 ms.
- On warm expand, set existing nodes `fixed: true`, seed new nodes on ring `r=80` around the clicked node, start FA2 500 ms, then `fixed=false` on all.

---

## 7 — Theming & Fallback

### 7.1 CSS vars via `getComputedStyle` + `MutationObserver` (Q14 verbatim)

> **Q14 CSS vars via getComputedStyle + MutationObserver on html.light, labelFont 0xProto, SVG fallback on WebGL/import fail.**

- **Tokens:** All graph colours must derive from `/home/smolpanda/Fun/Projects/fno-navigator/src/app.css` `var(--clr-*)`. Never hardcode hex in graph code.
  - Node fills: `var(--clr-surface)` + `var(--clr-border)` + module accent (e.g. `var(--clr-blue)` for Sales wedge, but resolved via `getComputedStyle`).
  - Edge: `var(--clr-edge-out)`/`--clr-edge-in`/`--clr-edge-schema` and hover variants.
  - Label background: `var(--clr-label-bg)` / `var(--clr-label-bd)`.
- **Reading path:** In SigmaGraph's `onMount`, do:
  ```js
  const css = getComputedStyle(document.documentElement)
  const edgeOut = css.getPropertyValue('--clr-edge-out').trim()
  ```
  Pass resolved values into Sigma `settings` / `nodeProgram` / `edgeProgram`. Do not let Sigma read `var()` strings — it renders to WebGL and cannot resolve CSS vars.
- **Theme reactivity:** Add a `MutationObserver` on `document.documentElement` watching `attributes: ['class']`. On mutation (light ↔ dark toggle via `/home/smolpanda/Fun/Projects/fno-navigator/src/routes/+layout.svelte: toggleTheme()`), re-read `getComputedStyle` and call `sigma.setSetting('...')` + `sigma.refresh()`. No graph rebuild, just colour swap (~16 ms).
- **Font:** `labelFont = '0xProto'` (already `@font-face` in `src/app.css`) — Sigma `labelFont` setting must match. Fallback `ui-monospace, monospace` if font not loaded yet (check `document.fonts.check('12px 0xProto')`).

### 7.2 SVG fallback

- **Trigger:** Any `import('sigma')` or WebGL context failure (`sigma.getContext() === null`, `isWebGLSupported() === false`) sets `loadErr` and renders `<RelationGraph>` in place of the canvas. Also flip `localStorage.setItem('graphEnabled', '0')` so the next visit skips the attempt (user can re-enable via query flag).
- **WebGL checks:**
  ```js
  function isWebGLSupported() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')) } catch { return false }
  }
  ```
- **Fallback parity tests:** When fallback renders, `RelationGraph` must still render the same 24-cap orbit for the same table — e2e probe (§9) asserts this by checking `.graph-wrap` present and `svg` present, not canvas.

---

## 8 — Performance Budget

| Budget item | Limit | How enforced | Measured where |
|---|---|---|---|
| `fk-map.json` fetch + parse | 2.3 MB over network, ≤ 180 ms parse on Moto G4-class (Chrome throttled 4× CPU) | Already fetched once via `loadFkMap()`; graph does not re-fetch. `map-manifest.json` fingerprint 1.6 KB is optional. | Playwright trace + Chrome performance panel; CI bench `tests/bench-pathfinder.mjs` |
| `edge-specificity.json` fetch | 10.3 KB | Cached in `specMap`; not re-fetched per pane. | — |
| `findPaths()` wall time | p50 ≤ 120 ms, p95 ≤ 190 ms (existing TODO.md bench at 40–50 paths) | `maxIterations=200_000` cap + `maxResults=50` + BFS window guard. Graph adds no pathfinding cost. | `tests/bench-pathfinder.mjs` — reuse unchanged |
| Graphology build (40 nodes) | ≤ 35 ms | Pure JS, no layout yet. | `performance.mark` in `SigmaGraph.svelte` |
| FA2 cold (40 nodes) | 800 ms wall, then stop | Worker thread, `warmMs/coldMs` exactly. | `setTimeout(kill, 800)` — not tick-count |
| FA2 warm (per expand batch) | 500 ms wall | Same worker, `fixed` existing nodes. | `setTimeout(kill, 500)` |
| Sigma frame budget | 16 ms/frame (60 fps) at 40 nodes, 22 ms/frame (45 fps) at 120 nodes | `adjustSizes:true` + `barnesHutOptimize:true` + no per-frame DOM. | `requestAnimationFrame` delta in dev build only |
| Total cold UX (`?graph=1` Trace) | 2.3 MB fetch (if uncached) + 190 ms pathfinder + 35 ms build + 800 ms FA2 = ≤ 1.4 s to settled graph when cached, ≤ 2.1 s when uncached (includes fetch). Must show `searchState==='running'` and “Loading graph…” during. | Lazy `import('sigma')` is parallel to `loadFkMap()`; sigma chunk is preloaded via `<link rel=modulepreload>` emitted by Vite (see §9). | Lighthouse + probe `tests/e2e-graph-probe.mjs` |
| Expand interaction | ≤ 600 ms to newly settled (500 ms FA2 + 100 ms animate) | Additive only; no rebuild. | probe timing assert |
| Memory cap | 120 nodes, merged edges ≤ 220 (sparse FK slice) | Enforced before `addNode`. | `graph.order ≤ 120` assert |

**What is explicitly NOT budgeted:** full-map 5,632-node render — out of scope (ponytail §1).

---

## 9 — Rollout, Flag & Verification

### 9.1 Flag (Q15 verbatim)

> **Q15 Flag ?graph=1 + localStorage graphEnabled, no /graph until A+B stable, build verifies sigma chunk split, Playwright probe reuse.**

- **Activation:** Graph code is dead until `graph=1` is present in `location.search` **or** `localStorage.getItem('graphEnabled') === '1'`.
  - Visiting `/find?from=A&to=B&graph=1` sets `localStorage.graphEnabled='1'` and shows the pane.
  - User can opt out: `localStorage.setItem('graphEnabled','0')` (future settings toggle; for now manually via devtools or revisiting without `graph=1` and clicking a “Disable graph” link that clears the flag). Presence of `graph=1` always wins over localStorage value.
  - No `/graph` standalone route ships. The URL space stays ` / `, `/tables/[name]`, `/find`, `/flow/[flowId]/[stageId]` only. Adding `/graph` before A+B are stable would fork the data flow and double QA — ponytail-deferred.
- **Build check:** `vite build` must emit a separate chunk for `sigma` (~280 KB gz ~85 KB), `graphology` (~45 KB), `graphology-layout-forceatlas2` (~20 KB). `svelte.config.js` already uses `adapter-static fallback:'index.html'` — add `vite.config.js` `build.rollupOptions.output.manualChunks = { sigma: ['sigma','graphology','graphology-layout-forceatlas2'] }` so the main bundle does not regress. CI asserts this via `scripts/assert-chunk-split.mjs` (new).

### 9.2 Verification (build preview + probe)

Reuse the existing Playwright harness (`@playwright/cli ^0.1.8` already in `package.json`) and the two probe scripts that are intentionally **not** a CI gate:

- `tests/e2e-legend-probe.mjs` + `tests/e2e-legend-width-probe.mjs` (UI-probe skill, `fno-interactor-ui-probe`) — reuse pattern for a new `tests/e2e-graph-probe.mjs` that is on-demand, not a required check.

Probe contract (`tests/e2e-graph-probe.mjs`):

```js
// 1. Build & serve preview:  npm run build && npm run preview -- --port 4173
// 2. For viewport in [1280x800, 375x812]:
//    - visit /find?from=InventTable&to=CustTable&maxHops=4&sort=unique&graph=1
//    - wait for canvas[data-testid="sigma"] OR fallback svg[data-testid="orbit"]
//    - assert sigma chunk was split: fetch('/_app/immutable/chunks/sigma.*.js') 200
//    - assert 40 nodes initially (Sigma: graph.order === 40; fallback: circles.length)
//    - assert module pills count 9 (All+8)
//    - assert plumbing toggle OFF -> plumbing edges opacity 0.18 (read computed style)
//    - click first node -> pop shows Goto + Expand(+N) -> click Expand -> after 600ms graph.order >40 <=120
//    - assert URL now contains expand=...
//    - assert theme toggle: html.light → canvas edge colours change via getComputedStyle
// 3. Tables tab: visit /tables/InventTable -> click Graph tab -> assert Sigma after 24 logic
// 4. Snapshot: write /tmp/e2e-graph-probe.{desktop,mobile}.png for manual review
// 5. Exit 0 on pass, 2 on actor/missing-selector (never throw unhandled)
```

CI gates (must stay green per `REVIEWING.md`):

- `build` + `verify:map` + `check-legend-copy` + `validate-fixtures` + `assert-fixtures` + `golden-test` + `bench` (existing).
- New gate `assert-chunk-split` — verifies `dist/_app/immutable/chunks/sigma-*.js` exists and `dist/_app/immutable/entry/app-*.js` does not contain `sigma` string (so chunk split succeeded). Cheap static check, < 50 ms.

Local preview discipline (manual, not CI): `npm run build && npm run preview -- --port 4173 && node tests/e2e-graph-probe.mjs --url http://localhost:4173` — mirrors `DEPLOY.md` static-preview pattern. Do not add `test:e2e` to `ci.yml`.

---

## 10 — Risks & Ponytail Deferrals

### 10.1 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Large fetch + WebGL cost on low-end mobile** | 2.3 MB + FA2 800 ms drains budget, jank on 4× CPU throttle | Flag is opt-in (`?graph=1`); no auto-mount. Sigma chunk is code-split so the LCP for non-graph users is unchanged. FA2 runs in a Worker off main thread. |
| **Hub tables dominate layout (Currency 615°, InventTable 552°)** | FA2 pulls everything into a hairball | `scalingRatio:3` + `gravity` dynamic + `adjustSizes:true` + ring seeds isolate hub neighbours. If hairball persists on golden pairs, tune `scalingRatio → 4` and re-bench — do not jump to Dagre. |
| **Graphology coordinate assumptions** | Graphology units vs screen pixels vs sigma camera — mismatch causes invisible or offscreen graphs | All seeds in Graphology units (10–80), pass through `sigma.utils` for pixel translation. Probe asserts `graph.order > 0 && camera.contains(graph)` after cold layout. |
| **CSS var drift between `app.css` and graph** | Light/dark edge contrast wrong | `MutationObserver` on `html.light` + `getComputedStyle` read is the only coupling — no hardcoded hex. Visual probe screenshots at both themes. |
| **URL bloat (`expand=` list grows)** | `expand=A,B,C,D,…` exceeds URL length | Cap at 120 nodes; typical expand list is 2–5 entries. Long lists compress to hash and warn via infolog (“Too many expands — Reset to share a clean link”). Do not silently truncate. |
| **Sigma / Graphology version drift** | FA2 worker API change breaks 500/800 ms contract | Pin exact minors, smoke-test `import('graphology-layout-forceatlas2/worker')` in probe. |

### 10.2 Ponytail deferrals (explicit “skipped: …, add when …”)

> The shortest path to done is the right path. Every deferral below is deliberate and named so 3 am debugging stays boring.

- **C — Full interactive map (all 5,632 tables):** `skipped: global graph, minimap, clustering, search-within-map. add when Trace A shows sustained usage and users ask for “show me everything near X” with a concrete workflow (BI audit, model cleanup) — not speculative curiosity.`
- **Dagre / hierarchical layout:** `skipped: Dagre dagreD3, elkjs, cola. add when Q9 force+linear bias is measured as “unreadable” on at least 2 golden pairs (user says “I can’t tell which direction the document flows”) and a user signal explicitly requests a strict left-to-right DAG — not as a default.`
- **Plumbing tiering (plumbing severity levels 1–3):** `skipped: tiered opacity / tiered dash patterns / “hide L2 plumbing” filter. add when suspect dataset ships a declared tier field per edge and at least one golden pair needs tier-aware filtering to surface the correct path. Today the waiver is binary (all-plumbing vs waiver).`
- **Per-field edge split (one edge per field vs merged):** `skipped: split toggle OFF, merged edge only. add when tooltip “all fields” list exceeds 5 entries and user asks to distinguish field-level routing visually — not before the tooltip copy is measured as too dense.`
- **FA2 parameter panel / tunables UI:** `skipped: gravity/scalingRatio sliders, FA2 diagnostic overlay. add when bench shows FA2 missing the 800 ms budget on median hardware — expose tunables then, not as a novelty.`
- **`/graph` route:** `skipped: standalone /graph page. add when A (Trace) and B (Neighbourhood) are both stable per success metric (rank-1 class 3, <45 s to copy) and a user wants deep-linkable single-table neighbourhood graphs without going through /find → no speculative route.`

---

## Appendix A — Absolute File Paths (verifiable)

```
Repo root:                     /home/smolpanda/Fun/Projects/fno-navigator
Requested TDD path (new):      /home/smolpanda/Fun/Projects/fno-interactor/docs/TDD-WebGL-Graph.md
Mirrored TDD path (this repo): /home/smolpanda/Fun/Projects/fno-navigator/docs/TDD-WebGL-Graph.md

SvelteKit config:              /home/smolpanda/Fun/Projects/fno-navigator/svelte.config.js        (adapter-static fallback:'index.html')
Vite config:                   /home/smolpanda/Fun/Projects/fno-navigator/vite.config.js
App shell:                     /home/smolpanda/Fun/Projects/fno-navigator/src/app.html            (ssr=false CSR, splash, theme script, 0xProto)
Theme tokens:                  /home/smolpanda/Fun/Projects/fno-navigator/src/app.css             (var(--clr-*) + html.light)
Layout (nav + theme):          /home/smolpanda/Fun/Projects/fno-navigator/src/routes/+layout.svelte
Find page:                     /home/smolpanda/Fun/Projects/fno-navigator/src/routes/find/+page.svelte  (1580 lines, ?from=&to=&maxHops&sort)
Table page:                    /home/smolpanda/Fun/Projects/fno-navigator/src/routes/tables/[name]/+page.svelte
Table loader:                  /home/smolpanda/Fun/Projects/fno-navigator/src/routes/tables/[name]/+page.js
Current graph (SVG):           /home/smolpanda/Fun/Projects/fno-navigator/src/lib/components/RelationGraph.svelte (465 lines, orbit 24 cap)
New graph (WebGL):             /home/smolpanda/Fun/Projects/fno-navigator/src/lib/components/SigmaGraph.svelte   (NEW)
Graph helpers:                 /home/smolpanda/Fun/Projects/fno-navigator/src/lib/graph/layout.js               (NEW)
                               /home/smolpanda/Fun/Projects/fno-navigator/src/lib/graph/selectSlice.js           (NEW)
                               /home/smolpanda/Fun/Projects/fno-navigator/src/lib/stores/graphState.js           (NEW)
FK store:                      /home/smolpanda/Fun/Projects/fno-navigator/src/lib/stores/fkMap.js
Specificity store:             /home/smolpanda/Fun/Projects/fno-navigator/src/lib/stores/specificity.js
Find state:                    /home/smolpanda/Fun/Projects/fno-navigator/src/lib/stores/findState.js
Pathfinder:                    /home/smolpanda/Fun/Projects/fno-navigator/src/lib/pathfinder.js
Path scoring (v2):             /home/smolpanda/Fun/Projects/fno-navigator/src/lib/pathScoring.js
Module mapping:                /home/smolpanda/Fun/Projects/fno-navigator/src/lib/utils.js         (canonicalModule)
Flows & tableDefs:             /home/smolpanda/Fun/Projects/fno-navigator/src/lib/data/flows.ts
Pager (reuse):                 /home/smolpanda/Fun/Projects/fno-navigator/src/lib/components/Pager.svelte
Legend copy:                   /home/smolpanda/Fun/Projects/fno-navigator/find-legend-copy.md
FK dataset:                    /home/smolpanda/Fun/Projects/fno-navigator/static/data/fk-map.json
Specificity artifact:          /home/smolpanda/Fun/Projects/fno-navigator/static/data/edge-specificity.json
Map manifest:                  /home/smolpanda/Fun/Projects/fno-navigator/static/data/map-manifest.json
Map generator:                 /home/smolpanda/Fun/Projects/fno-navigator/tools/generate-map.mjs
Deploy docs:                   /home/smolpanda/Fun/Projects/fno-navigator/DEPLOY.md
Review rubric:                 /home/smolpanda/Fun/Projects/fno-navigator/REVIEWING.md
```

## Appendix B — URL Param Contract (before → after)

```
Before: /find?from=InventTable&to=CustTable&maxHops=3&sort=shortest
After:  /find?from=InventTable&to=CustTable&maxHops=3&sort=shortest&graph=1&expand=SalesLine,InventDim&modules=Sales,Inventory
        ──────────────── existing (never break) ─────────────── ────── new (replaceState, source of truth) ──────
```

`expand` is progressive list in expansion order; `modules` is whitelist; `graph=1` is the only truthy value; pagination `+N more` is NOT URL-persisted.

## Appendix C — Grill Q mapping

| Grill Q | Verbatim decision | TDD section |
|---|---|---|
| Q1 | A 10/10, B 8/10 defer, C 3/10; rank-1 class 3 | §1 |
| Q2 | size 2.5+min(degree,24)*0.25, click→goto, field copy, plumbing dashed, thickness max bucket | §5.4 |
| Q4 | 40 Sigma / 24 SVG, rare-first, Pager +N, no 2-hop auto, count = merged pairs | §2.3 |
| Q5 | Pop Goto/Expand(+N) warm 500 ms cold 800 ms, additive 120 cap + Reset/Collapse LRU, ring r=80, fixed, barnesHut+adjustSizes, camera.animate | §5.5 |
| Q6 | Merged edge, thickness max bucket, dash all-plumbing, tooltip all fields copy, split OFF | §5.4 |
| Q7 | Wedge 45° per module, radius 10+(i%7)*2+jitter, neighbour wedge, hash fallback | §6.1 |
| Q8 | Dynamic gravity 1+min(n,120)/60, scalingRatio 3 slowDown 2, barnesHut+adjustSizes, warm 500 cold 800 | §6.2 |
| Q9 | Force + linear seed bias x=hop*180 y=pathIdx*60+jitter, no Dagre | §6.1 |
| Q10 | 8+1 pills row-wrap above graph, visibleModules reducer hidden no re-layout, counts, replaceState modules= | §5.2 |
| Q11 | Single Show plumbing OFF faint 0.18 dashed, thickness rare, no tier | §5.3 |
| Q12 | Extend URL with graph=1&expand=&modules=, replaceState, progressive mount, URL source of truth | §5.7 |
| Q13 | Augment /find Sigma pane + tables Tabs List|Graph Sigma after 24, SVG fallback <100, reuse afterNavigate+ResizeObserver | §4 |
| Q14 | CSS vars getComputedStyle+MutationObserver, 0xProto, SVG fallback | §7 |
| Q15 | Flag ?graph=1 + localStorage, no /graph until A+B stable, build verifies chunk split, probe reuse | §9 |
| Q3  | (implicit) v2 ranking class→score→hops→diversity→key | §2, §8 |

## Appendix D — Open Points (need confirmation before code)

- Confirm `graphology-layout-forceatlas2/worker` exists at pinned `0.26` line vs `graphology-layout-forceatlas2/worker` path drift across versions — pin and verify via `npm view graphology-layout-forceatlas2 dist` before `npm install`.
- Confirm `sigma@3.0.3` `Sigma` constructor signature matches `new Sigma(graph, container, settings)` with `nodeReducer`/`edgeReducer` at top-level settings (Second Brain reference says yes; verify against `sigma@3.0.3` docs before writing `SigmaGraph.svelte`).
- Confirm `vite build` chunk split name `sigma-*.js` is deterministic across SvelteKit `manualChunks` — test once with a throwaway `npm run build && ls dist/_app/immutable/chunks/`.
- Confirm `navigator.clipboard.writeText` is available in preview (requires secure context: `localhost:4173` counts as secure; static hosting `https://fno.hidayattaufiqur.dev` is HTTPS — both fine).

---

*End of TDD. Next action: `npm i -D sigma@3.0.3 graphology@0.26 graphology-layout-forceatlas2` + implement §3.2 files in the order `layout.js` → `selectSlice.js` → `graphState.js` → `SigmaGraph.svelte`, keeping every commit `build` green and `verify:map` untouched.*
