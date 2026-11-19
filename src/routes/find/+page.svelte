<script>
  import { onMount, tick } from 'svelte'
  import { page } from '$app/stores'
  import { tableDefs, flows } from '$lib/data/flows'
  import { canonicalModule, missingTableIssueUrl } from '$lib/utils'
  import { findState } from '$lib/stores/findState'
  import { fkLoadState, fkLoadError, loadFkMap, getAllFkTableNames } from '$lib/stores/fkMap'
  import { specificityLoadState, specificityLoadError, loadSpecificity } from '$lib/stores/specificity'
  import { findPaths as findPathsLegacy } from '$lib/pathfinder'
  import { loadGraph, findPaths as findPathsTiered, setFlowCohorts, setFlowStages, graphLoadState } from '$lib/pathEngine'
  import { TOOLTIP_COPY, LEGEND_GROUPS } from '$lib/findLegendCopy'
  import { goto } from '$app/navigation'
  // ── M2 graph pane (TDD §4.1) ─────────────────────────────────────────────
  import ForceGraph3D from '$lib/components/ForceGraph3D.svelte'
  import ScrollTop from '$lib/components/ScrollTop.svelte'
  import { selectSlice, mergeStructuredEdges } from '$lib/graph/selectSlice'
  import { getForwardMap, getReverseMap } from '$lib/stores/fkMap'
  import { getSpecificityMap } from '$lib/stores/specificity'
  import {
    graphState,
    CANONICAL_MODULES,
    requestExpand,
    setShowPlumbing,
    toggleModule,
    setAllModules,
    hydrateFromParams,
    toGraphParams,
  } from '$lib/stores/graphState'

  // ── Bind store fields to local vars for template convenience ───────────────

  let sourceInput = $findState.sourceInput
  let targetInput = $findState.targetInput
  let sourceTable = $findState.sourceTable
  let targetTable = $findState.targetTable
  let maxHops = $findState.maxHops
  let sortMode = $findState.sortMode

  // Tiered engine state. graphStatus decides which engine answers: 'ready' means
  // the generated verification graph is present; anything else means this build
  // has only the public seed map and must use the legacy scorer.
  let graphStatus = 'idle'
  // Default minimum join is B, not A. A-only hid too many real relations: 54% of
  // the 719 header→line hops are tier C or D, so a strict A default deleted
  // genuine answers and left detours. D brought back the cartesian bait
  // (Currency, CashDisc). B keeps declared FKs and drops convention-only hops.
  //
  // The tier CONTROL is gone from the toolbar (2026-11-19): with a derived
  // header→line class and 74 canonical pins, a four-button tier filter was
  // crowding the UI without changing the answer. The tier still gates the search
  // and still decides whether Copy X++ is offered; it is now communicated as a
  // single tag on the rows that need it instead of four chips per row.
  let tierFilter = 'B'
  let rankBy = 'canonical'
  let copiedKey = ''
  $: graphAvailable = graphStatus === 'ready'

  // Flagship scope: the six flows an analyst actually traces. Paths outside it
  // still resolve (endpoints are always allowed) but are labelled best-effort,
  // because only in-scope ranking has been verified.
  let engineScope = null
  // source|target -> arbitrated canonical chain. Loaded from the fixture file so
  // the pins are data, not code.
  let canonicalMap = new Map()
  let canonicalWhy = new Map()
  let canonicalReady = false

  /**
   * Tooltips for the RETIRED seed-engine branch only.
   *
   * The copy deck is about the AOT page, so the gate compares TOOLTIP_COPY
   * against that table and these keys cannot live there. They were deleted in
   * the 2026-11-19 rewrite, which left four lookups resolving to undefined and
   * rendering empty `title` attributes on a public clone (no AOT artifact, so the
   * seed branch is the one that renders). Kept local and small.
   */
  const SEED_TOOLTIP_COPY = {
    'cleanest-path': 'The #1 row under class, score, and hop ranking.',
    'business-flow': 'Follows a document flow with continuous document IDs.',
    curated: 'Verified by the app team, pinned from the dataset, not algorithm-ranked.',
    'reason-chips': "Each chip names evidence behind this path's rank.",
  }

  const TIER_MEANING = {
    A: 'A — foreign key with an index: enforced by the database, safe to paste into X++',
    B: 'B — foreign key declared, no index: a real relation, a query may need to scan',
    C: 'C — conditional relation: the join also constrains a discriminator field',
    D: 'D — convention only: no foreign key declared for this relation',
  }

  /**
   * flows.ts encodes the documented business story: each stage lists its tables,
   * so two tables in one stage are a documented adjacency. That is the only
   * curated signal the tiered engine accepts, and it is safe there because the
   * search is exact — a bonus changes costs, it cannot evict an ungenerated path.
   * @returns {Map<string, number>}
   */
  function buildFlowScope() {
    const cohorts = new Map()
    const stages = new Map()
    const scope = new Set()
    let stage = 0
    for (const flow of flows ?? []) {
      if (!FLAGSHIP_FLOWS.has(flow.id)) continue
      for (const st of flow.stages ?? []) {
        const id = stage++
        for (const t of st.tables ?? []) {
          scope.add(t)
          if (!cohorts.has(t)) cohorts.set(t, id)
          if (!stages.has(t)) stages.set(t, { flow: flow.id, stage: id })
        }
      }
    }
    return { cohorts, stages, scope }
  }

  // The six flows whose ranking has been measured. hr and service are excluded
  // deliberately: their defs are the least verified, and pretending otherwise
  // would be the same class of error as the fabricated tableDefs.
  const FLAGSHIP_FLOWS = new Set(['otc', 'p2p', 'ptp', 'inv', 'proj', 'rtr'])

  /** Arbitrated canonical chains: source|target -> chain. */
  async function loadCanonical() {
    if (canonicalReady) return
    try {
      const res = await fetch('/data/pinned-canonical-paths.json')
      if (!res.ok) return
      const data = await res.json()
      const m = new Map()
      const w = new Map()
      for (const p of data.pairs ?? []) {
        m.set(p.source + '|' + p.target, p.canonical)
        w.set(p.source + '|' + p.target, p.why ?? '')
        // A canonical relation is the same fact in both directions. Developers
        // trace line→header as often as header→line, and a relation that only
        // pins top-down is invisible to half the queries that need it. Measured
        // 2026-11-19: all 37 fixtures were one-directional, so `SalesLine ->
        // SalesTable` returned no pin at all while `SalesTable -> SalesLine` did.
        const reversed = [...p.canonical].reverse()
        const revKey = p.target + '|' + p.source
        if (!m.has(revKey)) {
          m.set(revKey, reversed)
          w.set(revKey, p.why ?? '')
        }
      }
      canonicalMap = m
      canonicalWhy = w
      canonicalReady = true
    } catch {
      // Absent fixture file is not an error: the site still works, just without
      // pinned canonical paths.
    }
  }

  /**
   * Copy a fully joinable chain as X++ and confirm in place. Clipboard API with a
   * textarea fallback so it still works outside a secure context.
   * @param {{ xpp: string, key: string }} result
   */
  async function copyXpp(result) {
    if (!result.xpp) return
    try {
      await navigator.clipboard.writeText(result.xpp)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = result.xpp
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } finally {
        ta.remove()
      }
    }
    copiedKey = result.key
    setTimeout(() => {
      if (copiedKey === result.key) copiedKey = ''
    }, 2000)
  }
  // Results are NOT restored from the store.
  //
  // The store is module-level so it survives navigation, which is what keeps the
  // form fields filled in on back-navigation. Restoring the RESULT SET is a
  // different matter: those objects carry `steps[].edge` references into the
  // loaded graph, and on a fresh mount the graph has not loaded yet. The render
  // then hits a step with no table name, `roleOf`/`isPlumbingTable` throw, the
  // component dies mid-render, and the browser shows the PREVIOUS route's DOM
  // while the URL says /find — the page looks frozen on the table you came from.
  //
  // So: inputs persist, results do not. A back-navigation re-runs the search from
  // the persisted inputs, which is also what a user expects.
  let pathResults = []
  let searchState = 'idle'
  let searchError = $findState.searchError
  let truncated = $findState.truncated
  let shortestHops = $findState.shortestHops
  let missing = $findState.missing

  // Sync local vars back to store on any change
  // Persist inputs only (see the note on pathResults above).
  $: findState.set({
    sourceInput,
    targetInput,
    sourceTable,
    targetTable,
    maxHops,
    sortMode,
    pathResults: [],
    searchState,
    searchError,
    truncated,
    shortestHops,
    missing,
  })

  // ── Deep links (?from=X&to=Y) ──────────────────────────────────────────────

  // Reads ?from=&to= on first load and kicks off a search if both are valid.
  onMount(() => {
    const from = $page.url.searchParams.get('from')
    const to = $page.url.searchParams.get('to')
    if (from && to) {
      sourceTable = from
      sourceInput = from
      targetTable = to
      targetInput = to
      handleFind()
    } else if (from) {
      sourceTable = from
      sourceInput = from
    } else if (to) {
      targetTable = to
      targetInput = to
    } else if (sourceTable && targetTable) {
      // Back-navigation: the store kept the inputs but not the results, so
      // re-run rather than showing an empty page with filled fields.
      handleFind()
    }
    // M2: graph flag + URL hydration (Q12/Q15). ?graph=1 wins over localStorage
    // and persists opt-in; absent param defers to stored preference.
    const sp = new URLSearchParams(location.search)
    if (sp.has('graph')) {
      try { localStorage.setItem('graphEnabled', sp.get('graph') === '1' ? '1' : '0') } catch {}
    }
    // Cohorts first (so the story profile has its stage adjacency), then the
    // artifact. A 404 is a normal state for a public clone, not an error.
    const { cohorts, stages, scope } = buildFlowScope()
    setFlowCohorts(cohorts)
    setFlowStages(stages)
    engineScope = scope
    loadCanonical()
    loadGraph().then(() => {
      graphStatus = graphLoadState.status
    })
    graphOn = resolveGraphFlag()
    replayQueue = hydrateFromParams(sp)
  })

  // ── Graph pane state (M2) ─────────────────────────────────────────────────

  let sigmaApi = null
  let graphOn = false
  let popTable = null
  let popPos = { x: 0, y: 0 }
  let liveNodes = new Set()
  let replayQueue = []
  let replaying = false

  function resolveGraphFlag() {
    const sp = new URLSearchParams(location.search)
    if (sp.has('graph')) return sp.get('graph') === '1'
    try { return localStorage.getItem('graphEnabled') === '1' } catch { return false }
  }

  // Initial slice + seed metadata for the trace view (rarest-first, Q4).
  // The graph pane (selectSlice) predates the tiered engine and reads the legacy
  // result shape: qualityClass, and edges with from/to/fromField/toField. The
  // tiered engine reports tierFloor and edges in DECLARED direction (child/parent)
  // plus a traversal flag, so convert at the boundary in one place rather than
  // teaching two modules each other's vocabulary.
  /**
   * @param {any[]} results
   * @returns {any[]}
   */
  function toLegacyShape(results) {
    if (!graphAvailable) return results
    const TIER_TO_CLASS = { A: 3, B: 2, C: 1, D: 0 }
    return results.map((r) => ({
      ...r,
      qualityClass: TIER_TO_CLASS[r.tierFloor] ?? 0,
      breakdown: { plumbing: 0, generic: 0 },
      score: 0,
      steps: r.steps.map((st) => {
        if (!st.edge) return st
        const e = st.edge
        // Re-orient in traversal direction so `from` is where the path arrives from.
        return {
          ...st,
          edge: {
            from: st.table === e.child ? e.child : e.parent,
            to: st.table === e.child ? e.parent : e.child,
            fromField: st.table === e.child ? e.childField : e.parentField,
            toField: st.table === e.child ? e.parentField : e.childField,
          },
        }
      }),
    }))
  }

  $: slice =
    searchState === 'done' && pathResults.length > 0
      ? selectSlice(toLegacyShape(pathResults), { cap: 40, specMap: getSpecificityMap() })
      : null
  $: if (slice) liveNodes = new Set(slice.nodes)

  $: metaMap = buildMeta(pathResults)
  function buildMeta(results) {
    const m = {}
    results.forEach((r, pi) => r.steps.forEach((s, si) => { if (!(s.table in m)) m[s.table] = { hop: si, pathIdx: pi } }))
    return m
  }

  $: graphStateSnap = $graphState
  $: modCounts = countModules(slice?.nodes ?? [])
  function countModules(tables) {
    const counts = {}
    for (const t of tables) {
      const m = canonicalModule(tableDefs[t]?.module)
      counts[m ?? 'Unknown'] = (counts[m ?? 'Unknown'] ?? 0) + 1
    }
    return counts
  }

  // ── URL loop: replaceState only, never pushState (Q12). Pager stays out. ──
  function syncGraphUrl() {
    const sp = new URLSearchParams(location.search)
    if (!graphOn) {
      ;['graph', 'expand', 'modules'].forEach((k) => sp.delete(k))
      history.replaceState(null, '', `${location.pathname}?${sp.toString()}`)
      return
    }
    sp.set('graph', '1')
    // NOTE: read $graphState directly, NOT the $: derived graphStateSnap —
    // deriveds flush AFTER the sync click handler, so reading them here would
    // serialize the PRE-toggle visibleModules/expandedSet (2e6abc5 family).
    const snap = $graphState
    const ex = [...snap.expandedSet]
    ex.length ? sp.set('expand', ex.join(',')) : sp.delete('expand')
    const mods = snap.visibleModules
    mods.length && mods.length < CANONICAL_MODULES.length ? sp.set('modules', mods.join(',')) : sp.delete('modules')
    history.replaceState(null, '', `${location.pathname}?${sp.toString()}`)
  }

  function enableGraph() {
    try { localStorage.setItem('graphEnabled', '1') } catch {}
    graphOn = true
    syncGraphUrl()
  }
  function disableGraph() {
    graphOn = false
    popTable = null
    try { localStorage.setItem('graphEnabled', '0') } catch {}
    syncGraphUrl()
  }
  function toggleMod(m) {
    toggleModule(m)
    syncGraphUrl()
  }
  function setPlumbing(e) {
    setShowPlumbing(e.currentTarget.checked) // deliberately NOT in URL (Q11/Q12 lock)
  }

  // ── Node pop: Goto / Expand(+N) ───────────────────────────────────────────
  function openPop(table) {
    popTable = table
    popPos = sigmaApi?.nodeDisplayPos(table) ?? { x: 40, y: 40 }
  }
  function closePop() {
    popTable = null
  }
  function gotoTable(t) {
    closePop()
    goto(`/tables/${t}?graph=1`)
  }

  /** Structured FK edges touching t, both directions (child→t and t→parent). */
  function structuredNeighbours(t) {
    const out = []
    for (const [child, pf, cf] of getForwardMap()?.[t] ?? []) out.push({ from: child, to: t, fromField: cf, toField: pf })
    for (const [p, pf, cf] of getReverseMap()?.[t] ?? []) out.push({ from: t, to: p, fromField: cf, toField: pf })
    return out
  }

  function pendingCount(t) {
    const seen = new Set(liveNodes)
    let n = 0
    for (const e of structuredNeighbours(t)) {
      const other = e.from === t ? e.to : e.from
      if (!seen.has(other)) n += 1
    }
    return n
  }

  function doExpand() {
    const t = popTable
    if (!t || !sigmaApi) return closePop()
    const cands = [...new Set(structuredNeighbours(t).map((e) => (e.from === t ? e.to : e.from)))].filter(
      (x) => !liveNodes.has(x),
    )
    const { accepted } = requestExpand(t, cands) // NODE_CAP enforced inside (ceiling 120)
    if (accepted.length === 0) return closePop()
    const acc = new Set(accepted)
    accepted.forEach((x) => liveNodes.add(x))
    const edges = mergeStructuredEdges(
      structuredNeighbours(t).filter((e) => acc.has(e.from) || acc.has(e.to)),
      getSpecificityMap(),
    )
    sigmaApi.addToGraph({ parentTable: t, tables: accepted, edges })
    syncGraphUrl()
    closePop()
  }

  /** Progressive replay of ?expand=A,B — sequential warm fans, order matters. */
  async function replayFromUrl() {
    if (replaying || !sigmaApi || !slice) return
    replaying = true
    for (const t of replayQueue) {
      if (liveNodes.has(t) || !getForwardMap()) continue
      const cands = [...new Set(structuredNeighbours(t).map((e) => (e.from === t ? e.to : e.from)))].filter(
        (x) => !liveNodes.has(x),
      )
      const { accepted } = requestExpand(t, cands)
      if (accepted.length) {
        const acc = new Set(accepted)
        accepted.forEach((x) => liveNodes.add(x))
        const edges = mergeStructuredEdges(
          structuredNeighbours(t).filter((e) => acc.has(e.from) || acc.has(e.to)),
          getSpecificityMap(),
        )
        sigmaApi.addToGraph({ parentTable: t, tables: accepted, edges })
        await new Promise((r) => setTimeout(r, 560)) // one warm budget per fan
      }
    }
    replayQueue = []
    replaying = false
  }
  $: if (sigmaApi && graphOn && slice && replayQueue.length > 0 && !replaying) replayFromUrl()

  // Back/forward re-hydrates from URL — single source of truth.
  function onPopState() {
    const sp = new URLSearchParams(location.search)
    graphOn = resolveGraphFlag()
    hydrateFromParams(sp)
  }

  // ── Autocomplete ───────────────────────────────────────────────────────────

  // @type {string[]}
  let sourceSuggestions = []
  // @type {string[]}
  let targetSuggestions = []

  // Rebuilt once FK map loads; empty until then
  $: allKnownTables = $fkLoadState === 'ready' ? getAllFkTableNames() : []

  // Returns up to 12 matches, ranking exact prefix matches above substring matches.
  // @param {string} query @param {string} selected
  function getSuggestions(query, selected) {
    const q = query.trim().toLowerCase()
    if (q.length < 2 || query === selected) return []
    const prefixMatches = []
    const substringMatches = []
    for (const tableName of allKnownTables) {
      const lower = tableName.toLowerCase()
      if (lower === q) return [tableName]
      if (lower.startsWith(q)) prefixMatches.push(tableName)
      else if (lower.includes(q)) substringMatches.push(tableName)
      if (prefixMatches.length + substringMatches.length >= 40) break
    }
    return [...prefixMatches, ...substringMatches].slice(0, 12)
  }

  $: sourceSuggestions = getSuggestions(sourceInput, sourceTable)
  $: targetSuggestions = getSuggestions(targetInput, targetTable)

  // @param {string} name
  function selectSource(name) {
    sourceTable = name
    sourceInput = name
    sourceSuggestions = []
  }

  // @param {string} name
  function selectTarget(name) {
    targetTable = name
    targetInput = name
    targetSuggestions = []
  }

  // Swap source and target tables.
  function swapTables() {
    const s = sourceTable || sourceInput
    const t = targetTable || targetInput
    sourceTable = t
    sourceInput = t
    targetTable = s
    targetInput = s
    sourceSuggestions = []
    targetSuggestions = []
  }

  // @param {KeyboardEvent} e @param {'source' | 'target'} which
  function handleInputKey(e, which) {
    const suggestions = which === 'source' ? sourceSuggestions : targetSuggestions
    if (e.key === 'Enter' && suggestions.length > 0) {
      which === 'source' ? selectSource(suggestions[0]) : selectTarget(suggestions[0])
    } else if (e.key === 'Escape') {
      which === 'source' ? (sourceSuggestions = []) : (targetSuggestions = [])
    }
  }

  // Kick off pre-loading on first keypress to reduce perceived latency
  function handleFirstType() {
    if ($fkLoadState === 'idle') loadFkMap()
    if ($specificityLoadState === 'idle') loadSpecificity()
  }

  // ── Pathfinding ────────────────────────────────────────────────────────────

  // Filters re-run the search themselves. Before this, clicking a tier or rank
  // control changed nothing visible until "Find paths" was pressed again — the
  // controls looked broken because they were inert. Guarded on searchState so a
  // programmatic set (e.g. restoring from the URL store) does not recurse.
  let autoRerunArmed = false
  let autoRerunTimer = null

  /**
   * Set a filter and re-run immediately.
   *
   * Filters used to be inert until "Find paths" was pressed a second time, which
   * read as broken controls. Re-running on change is safe here because the
   * exhaustive search is measured at ~500ms worst case on the densest pair, and
   * the timer collapses rapid clicks into one search.
   * @param {'tier' | 'rank'} which @param {string} value
   */
  function setFilter(which, value) {
    if (which === 'tier') tierFilter = value
    else rankBy = value
    scheduleRerun()
  }

  /** @param {number} value */
  function setHops(value) {
    maxHops = value
    scheduleRerun()
  }

  function scheduleRerun() {
    if (!autoRerunArmed || !sourceTable || !targetTable) return
    clearTimeout(autoRerunTimer)
    autoRerunTimer = setTimeout(() => handleFind(), 120)
  }

  async function handleFind() {
    searchError = ''
    pathResults = []
    truncated = false
    shortestHops = null
    missing = []

    if (!sourceTable || !targetTable) {
      searchError = 'Pick both a source and a target table first.'
      return
    }

    if ($fkLoadState !== 'ready') {
      searchState = 'running'
      await loadFkMap()
      if ($fkLoadState === 'error') {
        searchState = 'idle'
        searchError = `Failed to load FK data: ${$fkLoadError}`
        return
      }
    }

    // v2 ranking depends on the edge-specificity artifact (Q7-Q9); without it
    // every edge falls back to bucket 3 (rare), which would silently change
    // scores and ordering vs the golden contract. Load it before ranking.
    if ($specificityLoadState !== 'ready') {
      await loadSpecificity()
      if ($specificityLoadState === 'error') {
        // Degrade honestly: fall back to the all-rare map rather than fail
        // the search; the ranking stays deterministic, just less specific.
        console.warn(`edge-specificity map unavailable (${$specificityLoadError}); ranking with all-rare buckets`)
      }
    }

    searchState = 'running'
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Which engine answers. The tiered engine needs the generated graph; a public
    // clone has only the MIT seed map, so it falls back to the legacy scorer.
    // Never silent: graphAvailable drives a visible provenance notice.
    let results, shortest, wasTruncated, missingTables
    if (graphAvailable) {
      const r = findPathsTiered(sourceTable, targetTable, {
        maxHops,
        maxResults: 50,
        minTier: tierFilter,
        rankBy,
        scope: engineScope,
        canonicalChains: canonicalMap.has(sourceTable + '|' + targetTable)
          ? [canonicalMap.get(sourceTable + '|' + targetTable)]
          : null,
      })
      results = r.results
      shortest = r.shortest
      wasTruncated = r.truncated
      missingTables = r.missing
    } else {
      const r = findPathsLegacy(sourceTable, targetTable, maxHops, { sort: sortMode })
      results = r.results
      shortest = r.shortest
      wasTruncated = r.truncated
      missingTables = r.missing
    }
    pathResults = results
    shortestHops = shortest
    truncated = wasTruncated
    missing = missingTables
    searchState = 'done'
    autoRerunArmed = true
    // Fixture file is optional enrichment for hints / known paths. Load it
    // lazily after the search so it never sits on the main data path.
    loadCanonicalFixtures()
  }

  // ── Fixture-driven canonical paths (Q8) ────────────────────────────────────

  // Lazy, cached, failure-silent: the fixture file only powers the
  // "canonical path" hint and pinned row. If it fails to load, the search
  // results are unaffected.
  // @type {Array<object> | null}
  let canonicalFixtures = null
  let canonicalLoadAttempted = false

  async function loadCanonicalFixtures() {
    if (canonicalLoadAttempted) return
    canonicalLoadAttempted = true
    try {
      const res = await fetch('/data/regression-must-surface.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      canonicalFixtures = (await res.json()).pairs ?? []
    } catch {
      canonicalFixtures = []
    }
  }

  // Fixtures whose source/target match the queried pair, in the same
  // direction (a fixture asserts a directed chain; flipping it would imply
  // a different statement than the one validated against the dataset).
  $: canonicalForPair = canonicalFixtures
    ? canonicalFixtures.filter((f) => f.source === sourceTable && f.target === targetTable)
    : []

  // Every mustSurface path from the matched fixtures, deduped by sequence.
  $: canonicalPaths = (() => {
    const seen = new Set()
    const out = []
    for (const f of canonicalForPair) {
      for (const path of f.mustSurface ?? []) {
        const key = path.join('>')
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ fixtureId: f.id, path, hops: path.length - 1 })
      }
    }
    return out
  })()

  // Canonical paths that are not already in the result list get pinned as
  // known-good rows (fixture #1's story path never ranks; this is its home).
  $: resultKeys = new Set(pathResults.map((r) => r.steps.map((s) => s.table).join('>')))
  $: canonicalToShow = canonicalPaths.filter((c) => !resultKeys.has(c.path.join('>')))

  // Q8 hint: a canonical path exists above the current maxHops selection.
  $: canonicalHint = (() => {
    const above = canonicalPaths.filter((c) => c.hops > maxHops)
    return above.length ? { hops: Math.min(...above.map((c) => c.hops)) } : null
  })()

  // Index of the top-ranked path (Q4-modified display contract). The result
  // list is already ordered by the v2 hierarchy (class → score@2dp → hops →
  // diversity → key), so results[0] IS the rank-1 row; selecting max-score
  // instead could point at a lower-class row than the rank order.
  $: cleanestIndex = pathResults.length > 0 ? 0 : -1

  // ── v2 display helpers (presentation-only; the data is untouched) ─────────

  // Human-readable rendering of the deterministic reason codes emitted by
  // pathScoring.js (Q5 vocabulary). Unknown codes fall back to themselves so
  // a future code never renders blank.
  const REASON_LABELS = {
    'business-flow-pattern': 'follows a document flow',
    'document-id-continuity': 'document IDs stay continuous across hops',
    'named-reference-joins': 'named reference joins (no anonymous record ID)',
    'business-key-joins': 'business-key path',
    'generic-lookup-intermediate': 'passes through a generic lookup',
    'curated-tables': 'passes curated tables',
    'rare-relations': 'uses rare relation fields',
    'common-relations': 'uses common relation fields',
    'weak-semantic-signal': 'weak semantic signal',
    'plumbing-detour': 'contains a plumbing detour',
    'same-table': 'same table on both ends',
  }

  // Class-3 rows get this badge instead of a raw score.
  const CLASS_3_LABEL = 'Business flow'

  // Table-sequence keys of every fixture canonical path. A result row that
  // matches one of these IS the curated path for the pair, so it earns the
  // editorial badge even while it ranks in the algorithm list.
  $: canonicalKeySet = new Set(canonicalPaths.map((c) => c.path.join('>')))

  // Class-3 rows show no number, so an identical visible profile must be
  // called out: when consecutive class-3 rows tie on score, hops and reason
  // codes, their order is held by the diversity tiebreak alone. Saying so
  // keeps the within-class ordering explainable without a score.
  function class3TieNote(results, i) {
    if (i === 0) return ''
    const prev = results[i - 1]
    const cur = results[i]
    if (prev.qualityClass !== 3 || cur.qualityClass !== 3) return ''
    if (prev.score !== cur.score || prev.hops !== cur.hops) return ''
    if (prev.reasonCodes.join('|') !== cur.reasonCodes.join('|')) return ''
    return 'tied criteria with the row above · order held by diversity tiebreak'
  }

  // Switch sort order: re-run the search so the result pool is sliced for the
  // active mode (shortest vs unique pick different top-50 sets).
  function changeSort(mode) {
    if (mode === sortMode) return
    sortMode = mode
    if (sourceTable && targetTable) handleFind()
  }

  // ── Badge tooltips (dependency-free) ──────────────────────────────────────
  //
  // One shared tooltip div, driven by delegated listeners on window. Any
  // element with a data-tip attribute is a target: hover shows it (mouse),
  // focus shows it (keyboard / tap focus), click toggles it (touch fallback),
  // and blur / Escape / outside click / scroll dismiss it. This is fast on
  // mobile (no native title delay) and needs no libraries.
  //
  // @type {HTMLElement | null}
  let tipOwner = null
  let tipSource = '' // 'hover' | 'focus' | 'click'
  let tipVisible = false
  let tipText = ''
  let tipX = 0
  let tipY = 0
  // @type {HTMLDivElement | null}
  let tipNode = null

  // @param {EventTarget | null} node
  function closestTip(node) {
    return node instanceof Element ? node.closest('[data-tip]') : null
  }

  // @param {HTMLElement} target
  function showTip(target, source) {
    const text = target.getAttribute('data-tip')
    if (!text) return
    tipOwner = target
    tipSource = source
    tipText = text
    tipVisible = true
    tick().then(() => positionTip(target))
  }

  function hideTip() {
    tipVisible = false
    tipOwner = null
    tipSource = ''
  }

  // Park the tooltip above the target, clamped to the viewport; flip below
  // when there is no room above.
  // @param {HTMLElement} target
  function positionTip(target) {
    if (!tipNode) return
    const t = target.getBoundingClientRect()
    const p = tipNode.getBoundingClientRect()
    let x = t.left + t.width / 2 - p.width / 2
    x = Math.max(8, Math.min(x, window.innerWidth - p.width - 8))
    let y = t.top - p.height - 8
    if (y < 8) y = t.bottom + 8
    tipX = x
    tipY = y
  }

  // @param {MouseEvent} e
  function onTipOver(e) {
    if (e.pointerType === 'touch') return // taps are handled by click
    const t = closestTip(e.target)
    if (t && t !== tipOwner) showTip(t, 'hover')
  }

  // @param {MouseEvent} e
  function onTipOut(e) {
    if (e.pointerType === 'touch') return
    const t = closestTip(e.target)
    if (t && !t.contains(e.relatedTarget)) hideTip()
  }

  // @param {FocusEvent} e
  function onTipFocusIn(e) {
    const t = closestTip(e.target)
    if (t) showTip(t, 'focus')
  }

  function onTipFocusOut() {
    hideTip()
  }

  // @param {MouseEvent} e
  function onTipClick(e) {
    const t = closestTip(e.target)
    if (!t) {
      hideTip()
      return
    }
    if (tipVisible && tipOwner === t && tipSource === 'click') hideTip()
    else if (tipOwner !== t) showTip(t, 'click')
  }

  // @param {KeyboardEvent} e
  function onTipKey(e) {
    if (e.key === 'Escape') hideTip()
  }

  // @param {Event} e
  function onTipScroll() {
    if (tipSource !== 'focus') hideTip()
  }

  onMount(() => {
    window.addEventListener('mouseover', onTipOver)
    window.addEventListener('mouseout', onTipOut)
    window.addEventListener('focusin', onTipFocusIn)
    window.addEventListener('focusout', onTipFocusOut)
    window.addEventListener('click', onTipClick)
    window.addEventListener('keydown', onTipKey)
    window.addEventListener('scroll', onTipScroll, true)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('mouseover', onTipOver)
      window.removeEventListener('mouseout', onTipOut)
      window.removeEventListener('focusin', onTipFocusIn)
      window.removeEventListener('focusout', onTipFocusOut)
      window.removeEventListener('click', onTipClick)
      window.removeEventListener('keydown', onTipKey)
      window.removeEventListener('scroll', onTipScroll, true)
      window.removeEventListener('popstate', onPopState)
    }
  })

  // Legend body paragraphs carry the dossier's backticks; render them as
  // <code>. The text is our own copy deck, so no untrusted HTML reaches here.
  // @param {string} text
  function mdInline(text) {
    return text.replace(/`([^`]+)`/g, '<code>$1</code>')
  }
</script>

<svelte:head>
  <title>Find Table Path · FnO Navigator</title>
</svelte:head>

<header class="hero">
  <div>
    <p class="eyebrow">Dynamics 365 Finance &amp; Operations</p>
    <h2>Find Table Path</h2>
    <p class="lede">
      {#if graphAvailable}Find how two D365FO tables connect through declared relations. Uses the AOT relation
        graph: <strong>27,582 nodes</strong> and 58,310 graded hops, derived from Microsoft metadata.{:else}Find how two
        D365FO tables connect through foreign keys. This build runs on the public seed graph
        (<strong>43,616 relations</strong> across 5,587 tables), which can be stale or incomplete.{/if}
    </p>
  </div>
</header>

<section class="finder-section">
  <div class="finder-form">
    <!-- Source table input -->
    <div class="table-input-group">
      <label for="source-input">From table</label>
      <div class="autocomplete-wrap">
        <input
          id="source-input"
          type="text"
          placeholder="e.g. SalesLine"
          bind:value={sourceInput}
          on:input={() => { handleFirstType(); sourceTable = '' }}
          on:keydown={(e) => handleInputKey(e, 'source')}
          autocomplete="off"
          spellcheck="false"
        />
        {#if sourceSuggestions.length > 0}
          <ul class="suggestions" role="listbox">
            {#each sourceSuggestions as name}
              <li role="option" aria-selected="false">
                <button on:click={() => selectSource(name)}>
                  <span class="suggest-name">{name}</span>
                  {#if tableDefs[name]}
                    <span class="suggest-mod" data-module={canonicalModule(tableDefs[name].module)}>
                      {canonicalModule(tableDefs[name].module) ?? ''}
                    </span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    <div class="finder-arrow" aria-hidden="true">
      <button class="swap-btn" on:click={swapTables} title="Swap source and target" aria-label="Swap source and target tables">
        ⇄
      </button>
    </div>

    <!-- Target table input -->
    <div class="table-input-group">
      <label for="target-input">To table</label>
      <div class="autocomplete-wrap">
        <input
          id="target-input"
          type="text"
          placeholder="e.g. CustTable"
          bind:value={targetInput}
          on:input={() => { handleFirstType(); targetTable = '' }}
          on:keydown={(e) => handleInputKey(e, 'target')}
          autocomplete="off"
          spellcheck="false"
        />
        {#if targetSuggestions.length > 0}
          <ul class="suggestions" role="listbox">
            {#each targetSuggestions as name}
              <li role="option" aria-selected="false">
                <button on:click={() => selectTarget(name)}>
                  <span class="suggest-name">{name}</span>
                  {#if tableDefs[name]}
                    <span class="suggest-mod" data-module={canonicalModule(tableDefs[name].module)}>
                      {canonicalModule(tableDefs[name].module) ?? ''}
                    </span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    <!-- Options + action -->
    <div class="finder-controls">
      <fieldset class="hops-fieldset">
        <legend class="sort-label">Max hops</legend>
        <div class="hops-toggle" role="group" aria-label="Max hops">
          {#each [2, 3, 4, 5] as hops}
            <button
              type="button"
              class="hops-btn"
              class:hops-active={maxHops === hops}
              aria-pressed={maxHops === hops}
              on:click={() => setHops(hops)}
            >{hops}</button>
          {/each}
        </div>
      </fieldset>

      {#if graphAvailable}
        <fieldset class="sort-fieldset">
          <legend class="sort-label">Rank by</legend>
          <div class="sort-toggle" role="group" aria-label="Ranking profile">
            <button type="button" class="sort-btn"
              class:sort-active={rankBy === 'evidence'} aria-pressed={rankBy === 'evidence'}
              title={TOOLTIP_COPY['rank-evidence']}
              on:click={() => setFilter('rank', 'evidence')}>Evidence</button>
            <button type="button" class="sort-btn"
              class:sort-active={rankBy === 'canonical'} aria-pressed={rankBy === 'canonical'}
              title={TOOLTIP_COPY['rank-story']}
              on:click={() => setFilter('rank', 'canonical')}>Story</button>
          </div>
        </fieldset>
      {:else}
        <fieldset class="sort-fieldset">
          <legend class="sort-label">Sort</legend>
          <div class="sort-toggle" role="group" aria-label="Path sort order">
            <button type="button" class="sort-btn"
              class:sort-active={sortMode === 'shortest'} aria-pressed={sortMode === 'shortest'}
              on:click={() => changeSort('shortest')}>Shortest</button>
            <button type="button" class="sort-btn"
              class:sort-active={sortMode === 'unique'} aria-pressed={sortMode === 'unique'}
              on:click={() => changeSort('unique')}>Most unique</button>
          </div>
        </fieldset>
      {/if}

      <button class="find-btn" on:click={handleFind} disabled={searchState === 'running'}>
        {#if searchState === 'running'}
          {$fkLoadState === 'loading' ? 'Loading data…' : 'Searching…'}
        {:else}
          Find paths
        {/if}
      </button>
    </div>
  </div>

  {#if searchError}
    <p class="finder-error">{searchError}</p>
  {/if}

  <!-- Loading state -->
  {#if searchState === 'running'}
    <div class="finder-loading">
      <span class="spinner" aria-hidden="true"></span>
      <div class="loading-text">
        {#if $fkLoadState === 'loading'}
          <strong>Loading FK map…</strong>
          <span class="mini">Fetching 43,616 verified table associations for the first time (~2.4 MB). This only happens once per session.</span>
        {:else}
          <strong>Searching for paths…</strong>
          <span class="mini">Running a guided search across the FK graph from <em>{sourceTable}</em> to <em>{targetTable}</em>.</span>
        {/if}
      </div>
    </div>
  {/if}
  {#if searchState === 'done'}
    {#if missing.length > 0}
      <div class="finder-empty">
        <p data-tip={TOOLTIP_COPY['missing-note']} tabindex="0" aria-describedby="find-tip"><strong>{missing.join(', ')}</strong> {missing.length === 1 ? 'is' : 'are'} not in the {#if graphAvailable}27,582-node AOT graph{:else}5,587-table seed graph{/if}.</p>
        <p class="mini">Check the spelling, then try again. Table names are case-sensitive (for example SalesLine, CustTable).</p>
        <p class="mini">
          {#each missing as name, i}
            <a target="_blank" rel="noopener" href={missingTableIssueUrl(name, `/find (${$page.url.href})`)}>Report {name}</a>{i < missing.length - 1 ? ' · ' : ''}
          {/each}
        </p>
      </div>
    {:else if pathResults.length === 0}
      <div class="finder-empty">
        <p>No path found between <strong>{sourceTable}</strong> and <strong>{targetTable}</strong>
        within {maxHops} hop{maxHops !== 1 ? 's' : ''}.</p>
        <p class="mini">Try increasing the max hops, or check that both table names are correct.</p>
      </div>
    {:else}
      <div class="results-header">
        <p class="graph-notice" class:seed-notice={!graphAvailable}>
          {#if graphAvailable}
            Every hop is a declared D365FO relation, graded A–D by join strength. Ranking is verified for the six core
            flows — sales, procurement, production, inventory, project, finance. Tables outside them still resolve, but
            the order is best-effort.
          {:else}
            This build uses the public seed graph, derived from an older dataset — some relations may be stale or missing.
          {/if}
        </p>
        <span class="section-heading">
          {pathResults.length}{truncated ? '+' : ''} path{pathResults.length !== 1 ? 's' : ''}
          from <strong>{sourceTable}</strong> to <strong>{targetTable}</strong>
          {#if shortestHops !== null}
            · <span title={TOOLTIP_COPY['shortest-hops']}>shortest <strong>{shortestHops}</strong> hop{shortestHops !== 1 ? 's' : ''}</span>
          {/if}
          · {#if graphAvailable}joins at {tierFilter} or better · {rankBy === 'canonical' ? 'documented flows favoured' : 'metadata evidence only'}{:else if sortMode === 'shortest'}fewest hops first{:else}ranked by class &amp; score{/if}
        </span>
        <!-- Legend: badge explanations next to the results header (DESIGN.md
             §/find.5) — collapsed by default, dossier copy unchanged. -->
        <details class="legend">
          <summary class="legend-summary">What do badges mean?</summary>
          <div class="legend-body">
            {#each LEGEND_GROUPS as group}
              <section class="legend-group">
                <h3 class="legend-group-heading">{group.heading}</h3>
                {#each group.sections as section}
                  <div class="legend-section">
                    <h4 class="legend-section-title">{section.title}</h4>
                    {#each section.body as para}
                      <p>{@html mdInline(para)}</p>
                    {/each}
                    {#if section.table}
                      <table class="legend-table">
                        <thead>
                          <tr>
                            <th>Code</th>
                            <th>Current chip text</th>
                            <th>Plain-language meaning</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each section.table as row}
                            <tr>
                              <td><code>{row.code}</code></td>
                              <td>{row.chip}</td>
                              <td>{row.meaning}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {/if}
                  </div>
                {/each}
              </section>
            {/each}
          </div>
        </details>
      </div>

      {#if truncated}
        {#if graphAvailable}
          <p
            class="finder-note"
            data-tip={TOOLTIP_COPY['truncated-note']}
            tabindex="0"
            aria-describedby="find-tip"
          >Top {pathResults.length} shown — more ranked paths exist for this pair.</p>
        {:else}
          <p class="finder-note">Search space sampled: showing {pathResults.length} of many more possible paths. Reduce max hops for a shorter list.</p>
        {/if}
      {/if}
    {/if}

    {#if canonicalHint && canonicalToShow.length === 0}
      <p
        class="finder-note canonical-hint"
        data-tip={TOOLTIP_COPY['canonical-hint']}
        tabindex="0"
        aria-describedby="find-tip"
      >A canonical path for this pair exists at {canonicalHint.hops} hop{canonicalHint.hops !== 1 ? 's' : ''}. Increase max hops to include it.</p>
    {/if}

    {#if canonicalToShow.length > 0}
      <div class="canonical-block">
        <div class="canonical-heading">
          <span
            class="canonical-title"
            data-tip={TOOLTIP_COPY['known-canonical']}
            tabindex="0"
            aria-describedby="find-tip"
          >Known canonical path</span>
          <span class="canonical-caption">Curated knowledge: a validated chain for this pair, pinned from the fixture set, not algorithm-ranked</span>
          {#if canonicalHint}
            <span class="canonical-caption" data-tip={TOOLTIP_COPY['canonical-hint']} tabindex="0" aria-describedby="find-tip">
              · a {canonicalHint.hops}-hop canonical path also exists
            </span>
          {/if}
        </div>
        {#each canonicalToShow as c}
          <div class="canonical-path">
            {#each c.path as table, i}
              {#if i > 0}
                <span class="path-arrow">→</span>
              {/if}
              <a href="/tables/{table}" class="path-table-link">{table}</a>
            {/each}
            <span class="canonical-badge">{c.hops} hop{c.hops !== 1 ? 's' : ''}</span>
            <span
              class="curated-badge"
              data-tip={TOOLTIP_COPY.canonical}
              tabindex="0"
              aria-describedby="find-tip"
            >canonical</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if slice && graphOn}
      <section class="graph-pane" aria-label="Interactive path graph">
        <div class="graph-wrap">
          <ForceGraph3D
            nodes={slice.nodes}
            edges={slice.mergedEdges}
            meta={metaMap}
            height={520}
            bind:this={sigmaApi}
            onnodeclick={openPop}
          >
            <div slot="fallback" class="finder-empty" style="margin:0">
              <p>WebGL is unavailable in this browser — the interactive graph is disabled.</p>
              <p class="mini">The ranked path list below remains fully functional.</p>
            </div>
          </ForceGraph3D>
          <!-- Solid toolbar pinned to the top of the canvas (DESIGN.md: not
               floating glass; one module select + switch + hide) -->
          <div class="graph-toolbar" role="toolbar" aria-label="Graph controls">
            <label class="mod-select-label">
              <span class="mini">Module</span>
              <select
                class="mod-select"
                value={graphStateSnap.visibleModules.length === 0 ? '' : graphStateSnap.visibleModules[0]}
                on:change={(e) => {
                  const v = e.currentTarget.value
                  setAllModules()
                  if (v) toggleMod(v)
                  syncGraphUrl()
                }}
                aria-label="Filter tables by module"
              >
                <option value="">All modules</option>
                {#each CANONICAL_MODULES as m (m)}
                  <option value={m}>{m} ({modCounts[m] ?? 0})</option>
                {/each}
                <option value="Unknown">Unknown ({modCounts.Unknown ?? 0})</option>
              </select>
            </label>
            <label class="plumb-toggle">
              <input type="checkbox" checked={graphStateSnap.showPlumbing} on:change={setPlumbing} />
              Show system FKs
            </label>
            <button class="hide-graph-btn" on:click={disableGraph}>Hide graph</button>
          </div>
          <div class="graph-status mini" role="status">
            Showing {slice.nodes.length} of the ranked-path tables{slice.overflow > 0 ? ` · ${slice.overflow} not shown` : ''}
          </div>
          {#if popTable}
            <div class="pop-card" style="left:{popPos.x}px; top:{popPos.y}px" role="dialog" aria-label="{popTable} actions">
              <button class="pop-x" on:click={closePop} aria-label="Close">✕</button>
              <strong>{popTable}</strong>
              <span class="mini pop-mod" data-module={canonicalModule(tableDefs[popTable]?.module) ?? ''}>
                {canonicalModule(tableDefs[popTable]?.module) ?? 'Unknown'}
              </span>
              <div class="pop-actions">
                <button class="pop-goto" on:click={() => gotoTable(popTable)}>Goto →</button>
                <button class="pop-expand" on:click={doExpand} disabled={pendingCount(popTable) === 0}>
                  Expand (+{pendingCount(popTable)})
                </button>
              </div>
            </div>
          {/if}
        </div>
      </section>
    {:else if slice && !graphOn}
      <div class="show-graph-row">
        <button class="show-graph-btn" on:click={enableGraph}>Show graph</button>
        <span class="mini">WebGL constellation view of the paths below</span>
      </div>
    {/if}

    {#if pathResults.length > 0}
      <ol class="path-list">
        {#each pathResults as result, i}
          {@const hops = result.steps.length - 1}
          {@const pathKey = result.steps.map((s) => s.table).join('>')}
          {@const isCurated = canonicalKeySet.has(pathKey)}
          {@const tieNote = class3TieNote(pathResults, i)}
          <li class="path-item">
            <span class="path-index">#{i + 1}</span>
            <div class="path-body">
              <!-- Row 1: clean horizontal chain — table names + arrows only -->
              <div class="path-chain">
                {#each result.steps as step, stepIndex}
                  {#if stepIndex > 0}
                    <span class="path-arrow">→</span>
                  {/if}
                  <a href="/tables/{step.table}" class="path-table-link"
                    class:path-source={stepIndex === 0}
                    class:path-target={stepIndex === result.steps.length - 1}
                  >{step.table}</a>
                  <!-- Per-hop tier chips removed 2026-11-19: six chips per row was
                       the main source of visual noise. The only tier fact that
                       changes what you DO with a row is whether the join is
                       paste-safe, and that is now one tag on the row. -->
                {/each}
                <!-- One badge max per row (DESIGN.md §/find.4):
                     rank #1 → cleanest; else one semantic badge (business flow
                     wins over curated; shortest badge dropped — it's the sort
                     mode, stated in the header). -->
                {#if graphAvailable}
                  {#if result.canonical}
                    <span
                      class="canonical-pin-badge"
                      title={canonicalWhy.get(sourceTable + '|' + targetTable) || TOOLTIP_COPY.canonical}
                    >
                      canonical
                    </span>
                  {:else if result.relationClass === 'header-line'}
                    <!-- Layer 1: a derivable relation class, not a curated pin. -->
                    <span
                      class="class-badge"
                      title={TOOLTIP_COPY['header-line']}
                    >
                      header→line
                    </span>
                  {:else if graphAvailable}
                    <span class="inferred-badge" title={TOOLTIP_COPY.inferred}>inferred</span>
                  {/if}
                  {#if result.joinable}
                    <button
                      type="button"
                      class="copy-xpp-btn"
                      title={TOOLTIP_COPY['copy-xpp']}
                      on:click={() => copyXpp(result)}
                    >{copiedKey === result.key ? 'Copied' : 'Copy X++'}</button>
                  {:else}
                    <!-- One tag instead of four chips. It carries the only tier
                         fact that changes behaviour: why this row has no
                         Copy X++ button. -->
                    <span
                      class="join-tag join-tag-{result.tierFloor}"
                      title={TOOLTIP_COPY['tag-' + (result.tierFloor === 'B' ? 'scan' : result.tierFloor === 'C' ? 'conditional' : 'convention')]}
                    >
                      {result.tierFloor === 'B' ? 'scan' : result.tierFloor === 'C' ? 'conditional' : 'convention'}
                    </span>
                  {/if}
                {:else if i === cleanestIndex}
                  <span
                    class="cleanest-badge"
                    data-tip={SEED_TOOLTIP_COPY['cleanest-path']}
                    tabindex="0"
                    aria-describedby="find-tip"
                  >cleanest path</span>
                {:else if result.qualityClass === 3}
                  <span
                    class="class3-badge"
                    data-tip={SEED_TOOLTIP_COPY['business-flow']}
                    tabindex="0"
                    aria-describedby="find-tip"
                  >Business flow</span>
                {:else if isCurated}
                  <span
                    class="curated-badge"
                    data-tip={SEED_TOOLTIP_COPY.curated}
                    tabindex="0"
                    aria-describedby="find-tip"
                  >curated</span>
                {/if}
              </div>
              <!-- Row 2: FK field labels, one per hop -->
              {#if result.bridges?.length}
                <div class="bridge-warn" role="note">
                  {#each result.bridges as br}
                    <span
                      class="bridge-flag"
                      title={br.reason === 'same-field-cartesian' ? TOOLTIP_COPY['bridge-cartesian'] : TOOLTIP_COPY['bridge-setup']}
                    >⚠ {br.table}</span>
                  {/each}
                </div>
              {/if}
              {#if result.steps.some((s) => s.via)}
                <div class="path-fk-list">
                  {#each result.steps.slice(1) as step}
                    {#if step.via}
                      <span class="path-fk-field">{step.via}</span>
                    {/if}
                  {/each}
                </div>
              {/if}
              <!-- Row 3: breakdown — hops · raw score (class ≤2 only) · semantic link counts · via tables -->
              <div class="path-breakdown">
                {hops} hop{hops !== 1 ? 's' : ''}
                {#if graphAvailable}
                  <span aria-hidden="true"> · </span>cost {result.cost}
                {:else if result.qualityClass <= 2}
                  <span aria-hidden="true"> · </span>score {result.score}
                {/if}
                {#if !graphAvailable && (result.breakdown?.generic ?? 0) > 0}
                  <span aria-hidden="true"> · </span>{result.breakdown.generic} generic link{result.breakdown.generic !== 1 ? 's' : ''}
                {/if}
                {#if !graphAvailable && (result.breakdown?.plumbing ?? 0) > 0}
                  <span aria-hidden="true"> · </span>{result.breakdown.plumbing} plumbing link{result.breakdown.plumbing !== 1 ? 's' : ''}
                {/if}
              </div>
              <!-- Class-3 rows: why this ranks here, spelled out instead of a number -->
              {#if result.qualityClass === 3}
                <div
                  class="reason-chips"
                  role="list"
                  aria-label="Why this path ranks here"
                  data-tip={SEED_TOOLTIP_COPY['reason-chips']}
                  tabindex="-1"
                >
                  {#each result.reasonCodes as code}
                    <span
                      class="reason-chip"
                      role="listitem"
                      data-tip={REASON_LABELS[code] ?? code}
                      tabindex="0"
                      aria-describedby="find-tip"
                    >{REASON_LABELS[code] ?? code}</span>
                  {/each}
                </div>
                {#if tieNote}
                  <p class="tie-note">{tieNote}</p>
                {/if}
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}

  {#if tipVisible}
    <div
      id="find-tip"
      class="find-tip"
      role="tooltip"
      bind:this={tipNode}
      style="left: {tipX}px; top: {tipY}px"
    >{tipText}</div>
  {/if}
</section>

<ScrollTop />

<style>
  /* ── Form layout ── */
  .finder-section {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .finder-form {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    flex-wrap: wrap;
    background: var(--clr-surface);
    border: 1px solid var(--clr-border-subtle);
    border-radius: var(--r-md, 10px);
    padding: 24px;
    min-width: 0;
    max-width: 100%;
  }

  .table-input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 180px;
    max-width: 100%;
  }

  .table-input-group label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--clr-text-muted);
  }

  .finder-arrow {
    font-size: 22px;
    color: var(--clr-text-faint);
    padding-bottom: 4px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .swap-btn {
    background: transparent;
    border: 1px solid var(--clr-border);
    color: var(--clr-text-muted);
    border-radius: var(--r-sm, 6px);
    width: 38px;
    height: 34px;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.15s, color 0.15s;
  }

  .swap-btn:hover {
    border-color: var(--clr-border-accent);
    color: var(--clr-text);
  }

  .finder-controls {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    flex-shrink: 0;
  }

  .hops-fieldset {
    border: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .hops-toggle {
    display: inline-flex;
    border: 1px solid var(--clr-border);
    border-radius: var(--r-sm, 6px);
    overflow: hidden;
  }

  .hops-btn {
    background: var(--clr-surface);
    color: var(--clr-text-muted);
    border: none;
    padding: 8px 12px;
    min-width: 38px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .hops-btn + .hops-btn {
    border-left: 1px solid var(--clr-border);
  }

  .hops-btn:hover:not(.hops-active) {
    background: var(--clr-surface-raised);
    color: var(--clr-text);
  }

  .hops-btn.hops-active {
    background: var(--clr-accent-light-bg, rgba(90, 148, 232, 0.12));
    color: var(--clr-blue-strong);
  }

  .find-btn {
    padding: 10px 18px;
    background: var(--clr-blue);
    color: var(--clr-primary-button-text, #0d1117);
    border: none;
    border-radius: var(--r-sm, 6px);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s, background 0.15s;
    white-space: nowrap;
    min-height: 44px;
  }

  .find-btn:hover:not(:disabled) { background: var(--clr-blue-strong); opacity: 1; }
  .find-btn:disabled { opacity: 0.45; cursor: default; }

  /* ── Autocomplete ── */
  .autocomplete-wrap {
    position: relative;
  }

  .autocomplete-wrap input {
    width: 100%;
    box-sizing: border-box;
    background: var(--clr-surface-raised);
    color: var(--clr-text);
    border: 1px solid var(--clr-border);
    border-radius: var(--r-sm, 6px);
    padding: 8px 10px;
    font-size: 14px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s;
  }

  .autocomplete-wrap input:focus {
    border-color: var(--clr-border-accent);
  }

  .autocomplete-wrap input::placeholder {
    color: var(--clr-text-faint);
  }

  .suggestions {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--clr-surface-raised);
    border: 1px solid var(--clr-border);
    border-radius: var(--r-md, 10px);
    list-style: none;
    margin: 0;
    padding: 4px;
    z-index: 40;
    max-height: 280px;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .suggestions li { margin: 0; }

  .suggestions button {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 7px 10px;
    border-radius: var(--r-sm, 6px);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--clr-text);
    font-size: 13px;
  }

  .suggestions button:hover {
    background: var(--clr-surface-raised);
  }

  .suggest-name { flex: 1; font-family: var(--font-mono, monospace); }

  .suggest-mod {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: var(--r-pill, 6px);
    background: var(--mod-clr-bg, var(--clr-border));
    color: var(--mod-clr, var(--clr-blue-strong));
    flex-shrink: 0;
  }

  /* ── States ── */
  .finder-error {
    color: #f87171;
    font-size: 14px;
    padding: 10px 14px;
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.2);
    border-radius: var(--r-md, 10px);
  }

  .finder-note {
    color: var(--clr-text-muted);
    font-size: 12px;
    padding: 8px 12px;
    background: rgba(255, 180, 0, 0.08);
    border: 1px solid rgba(255, 180, 0, 0.18);
    border-radius: var(--r-md, 10px);
  }

  .canonical-hint {
    background: rgba(79, 195, 247, 0.07);
    border-color: rgba(79, 195, 247, 0.2);
  }

  /* ── Fixture-driven canonical path (Q8) ── */
  .canonical-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(79, 195, 247, 0.06);
    border: 1px solid rgba(79, 195, 247, 0.28);
    border-radius: var(--r-md, 10px);
    padding: 12px 16px;
  }

  .canonical-heading {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }

  .canonical-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--clr-text-muted);
  }

  .canonical-caption {
    font-size: 11px;
    color: var(--clr-text-muted);
  }

  .canonical-path {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  .canonical-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 1px 6px;
    border-radius: var(--r-pill, 6px);
    background: rgba(76, 175, 80, 0.12);
    border: 1px solid rgba(76, 175, 80, 0.3);
    color: var(--clr-green);
    margin-left: 4px;
    flex-shrink: 0;
  }

  .finder-empty {
    text-align: center;
    padding: 40px 24px;
    color: var(--clr-text-muted);
    border: 1px dashed var(--clr-border-subtle);
    border-radius: 10px;
  }

  .finder-empty strong { color: var(--clr-text); }

  /* ── Results ── */
  .results-header {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
  }
  .results-header .legend {
    /* left-anchored block fill (DESIGN.md §/find.5); the width probe asserts
       the legend fills the content column from the left, capped at 1760px */
    margin-top: 8px;
    width: 100%;
  }
  @media (min-width: 701px) {
    .results-header .legend { margin-top: 12px; }
  }

  .path-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .path-item {
    background: var(--clr-surface);
    border: 1px solid var(--clr-border-subtle);
    border-radius: var(--r-md, 10px);
    padding: 10px 14px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  /* Rank #1 highlighted with accent border (DESIGN.md §Path rows) */
  .path-item:first-child {
    border-color: var(--clr-border-accent);
  }

  .path-index {
    font-size: 11px;
    color: var(--clr-text-faint);
    min-width: 24px;
    flex-shrink: 0;
    padding-top: 3px;
  }

  /* Body holds both the chain row and the FK labels row */
  .path-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Row 1: table names + arrows, no extra decorations */
  .path-chain {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  .path-arrow {
    color: var(--clr-text-faint);
    font-size: 12px;
    flex-shrink: 0;
  }

  .cleanest-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 1px 6px;
    border-radius: var(--r-sm, 6px);
    background: var(--clr-accent-light-bg, rgba(90, 148, 232, 0.12));
    border: 1px solid var(--clr-border-accent);
    color: var(--clr-blue-strong);
    margin-left: 4px;
    flex-shrink: 0;
  }

  /* Class-3 (business flow): replaces the raw score with a distinct badge */
  .class3-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 1px 6px;
    border-radius: var(--r-pill, 6px);
    background: rgba(255, 180, 0, 0.14);
    border: 1px solid rgba(255, 180, 0, 0.35);
    color: #ffb400;
    margin-left: 4px;
    flex-shrink: 0;
  }

  /* Editorial badge: fixture-driven curated knowledge. Semantic success
     (DESIGN.md: curated purple #ab47bc dropped for contrast — 3.93:1 fail). */
  .curated-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 1px 6px;
    border-radius: var(--r-pill, 6px);
    background: rgba(63, 185, 80, 0.12);
    border: 1px solid rgba(63, 185, 80, 0.3);
    color: var(--clr-green);
    margin-left: 4px;
    flex-shrink: 0;
  }

  /* Reason codes rendered as human-readable chips (class-3 rows) */
  .reason-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
  }

  .reason-chip {
    font-size: 10px;
    color: var(--clr-text-muted);
    background: rgba(79, 195, 247, 0.07);
    border: 1px solid rgba(79, 195, 247, 0.22);
    border-radius: var(--r-pill, 6px);
    padding: 1px 6px;
  }

  .tie-note {
    font-size: 10px;
    font-style: italic;
    color: var(--clr-text-faint);
    margin: 2px 0 0;
  }

  .path-table-link {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    font-weight: 600;
    color: var(--clr-text);
    text-decoration: none;
    transition: color 0.1s;
  }

  .path-table-link:hover {
    color: var(--clr-text);
    text-decoration: underline;
  }

  .path-table-link.path-source { color: var(--clr-blue); }
  .path-table-link.path-target { color: var(--clr-green); }

  /* Row 2: FK field labels, one per hop — very secondary */
  .path-fk-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    border-left: 2px solid var(--clr-border-subtle);
    margin-left: 2px;
    padding-left: 8px;
  }

  .path-fk-field {
    font-size: 10px;
    color: var(--clr-text-faint);
    font-family: var(--font-mono, monospace);
    word-break: break-all;
  }

  /* Row 3: breakdown — hops · generic/plumbing links · via tables */
  .path-breakdown {
    font-size: 10px;
    color: var(--clr-text-muted);
    font-family: var(--font-mono, monospace);
  }

  /* ── Sort toggle ── */
  .sort-fieldset {
    border: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sort-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--clr-text-muted);
    padding: 0;
  }

  .sort-toggle {
    display: inline-flex;
    border: 1px solid var(--clr-border);
    border-radius: var(--r-sm, 6px);
    overflow: hidden;
  }

  .sort-btn {
    background: var(--clr-surface);
    color: var(--clr-text-muted);
    border: none;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .sort-btn + .sort-btn {
    border-left: 1px solid var(--clr-border);
  }

  .sort-btn:hover:not(.sort-active) {
    background: var(--clr-surface-raised);
    color: var(--clr-text);
  }

  .sort-btn.sort-active {
    background: var(--clr-accent-light-bg, rgba(90, 148, 232, 0.12));
    color: var(--clr-blue-strong);
  }

  @media (max-width: 900px) {
    .finder-form {
      flex-direction: column;
      align-items: stretch;
    }

    .finder-arrow { display: none; }
    .finder-controls { flex-direction: row; justify-content: flex-start; flex-wrap: wrap; }
    .finder-controls .find-btn { flex: 1; min-width: 140px; }
  }

  /* ── Loading state ── */
  .finder-loading {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 20px 24px;
    background: rgba(138, 213, 255, 0.05);
    border: 1px solid var(--clr-border);
    border-radius: var(--r-md, 10px);
  }

  .loading-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .loading-text strong {
    font-size: 14px;
    color: var(--clr-text);
  }

  .loading-text .mini {
    color: var(--clr-text-faint);
  }

  .loading-text em {
    font-style: normal;
    color: var(--clr-blue);
  }

  .spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    margin-top: 1px;
    border: 2px solid var(--clr-border);
    border-top-color: var(--clr-border-accent);
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Shared badge tooltip (dependency-free, dark-theme consistent) ── */
  [data-tip] {
    cursor: help;
  }

  [data-tip]:focus-visible,
  .tip-target:focus-visible {
    outline: 2px solid var(--clr-border-accent);
    outline-offset: 2px;
    border-radius: 3px;
  }

  .find-tip {
    position: fixed;
    z-index: 100;
    max-width: 300px;
    background: var(--clr-surface-raised);
    border: 1px solid var(--clr-border);
    border-radius: var(--r-md, 10px);
    padding: 6px 10px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--clr-text);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }

  /* ── Legend ("What do these mean?") ── */
  .legend {
    margin-top: 18px;
    /* Fills the content column on desktop so the finder + legend use the
       horizontal space on wide viewports. The old hard 1076px cap bound as
       soon as the content column (viewport − 280px nav − 84px gutters)
       exceeded 1076px, i.e. viewport > 1440px, leaving a dead strip on the
       right at 100% zoom and below. Width 100% + a 1760px ceiling keeps
       ultra-wide screens from getting edge-to-edge text. The middle grid
       track (2.4fr) absorbs the extra width and the reason-code table is
       table-layout: fixed, so wide tracks stay usable. The cap never binds
       below 1440px, so tablet and mobile layouts are untouched. */
    width: 100%;
    max-width: 1760px;
    font-size: 12px;
  }

  .legend-summary {
    cursor: pointer;
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--clr-text-muted);
    user-select: none;
    border-radius: var(--r-sm, 6px);
    padding: 6px 0;
  }

  .legend-summary:hover { color: var(--clr-text); }

  .legend-summary::-webkit-details-marker {
    display: none;
  }

  .legend-summary::before {
    content: '';
    width: 0;
    height: 0;
    border-left: 5px solid var(--clr-text-muted);
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
    transition: transform 0.15s;
  }

  .legend[open] .legend-summary::before {
    transform: rotate(90deg);
  }

  .legend-body {
    margin-top: 12px;
    display: grid;
    /* 3-up on desktop: the middle group (Path quality) carries the 11-row
       reason-code table, so it gets a wider track to keep the table compact.
       The grid is collapsed to 1 column on mobile (media query below) and to
       a 2-column + full-width-table row on tablets. */
    grid-template-columns: 1fr 2.4fr 1fr;
    gap: 16px 24px;
    background: var(--clr-surface);
    border: 1px solid var(--clr-border-subtle);
    border-radius: 10px;
    padding: 14px 16px;
    color: var(--clr-text-muted);
  }

  .legend-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .legend-group-heading {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--clr-text-muted);
  }

  .legend-section {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .legend-section-title {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    color: var(--clr-text);
  }

  .legend-section p {
    margin: 0;
    font-size: 12px;
    line-height: 1.55;
  }

  .legend-section code {
    background: var(--clr-surface-raised);
    border: 1px solid var(--clr-border-subtle);
    border-radius: 3px;
    padding: 0 4px;
    font-size: 11px;
    color: var(--clr-blue-strong);
  }

  .legend-table {
    border-collapse: collapse;
    margin-top: 2px;
    font-size: 11px;
    line-height: 1.45;
    /* In 3-up mode each group column is ~290px, too narrow for the table's
       natural min-content (nowrap code cells + long phrases). Fixed layout
       with wrapping keeps every row visible; the hyphenated reason-code
       slugs wrap cleanly at their hyphens. */
    table-layout: fixed;
    width: 100%;
  }

  .legend-table th {
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--clr-text-faint);
    padding: 4px 8px;
    border-bottom: 1px solid var(--clr-border);
  }

  .legend-table td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--clr-border-subtle);
    vertical-align: top;
    color: var(--clr-text-muted);
    overflow-wrap: break-word;
  }

  .legend-table td:first-child {
    /* Reason-code slugs are hyphenated: they wrap at hyphens in the narrow
       3-up columns because we removed white-space: nowrap here. */
    color: var(--clr-blue-strong);
  }

  /* Responsive ladder for the legend grid:
       - ≥1200px viewport: 3-up (Path ranking | Path quality | Notes)
       - 701–1199px (tablets): 2 columns on row 1, Path quality spans the
         full width on row 2 so the reason-code table stays wide and short
       - ≤700px (mobile): single-column stack, as before */
  @media (max-width: 1199px) and (min-width: 701px) {
    .legend-body {
      grid-template-columns: 1fr 1fr;
    }

    .legend-group:nth-child(1) {
      grid-column: 1;
      grid-row: 1;
    }

    .legend-group:nth-child(2) {
      grid-column: 1 / -1;
      grid-row: 2;
    }

    .legend-group:nth-child(3) {
      grid-column: 2;
      grid-row: 1;
    }
  }

  @media (max-width: 700px) {
    .legend-body {
      grid-template-columns: 1fr;
    }
  }
  /* ── M5 graph pane: constellation over deep space ── */
  .graph-pane {
    margin: 18px 0 8px;
    border-radius: var(--r-lg, 8px);
    background: transparent;
    overflow: hidden;
  }
  .graph-wrap {
    position: relative;
  }
  .graph-toolbar {
    position: absolute;
    top: 10px;
    left: 10px;
    right: 10px;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    /* solid bar (DESIGN.md: not floating glass; light mode = solid) */
    background: var(--toolbar-bg);
    border: 1px solid var(--toolbar-bd);
    border-radius: var(--r-md, 10px);
    box-shadow: var(--elevation-raised, 0 1px 2px rgba(1, 4, 9, 0.4));
  }
  .mod-select-label {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  .mod-select-label .mini {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--clr-text-muted);
  }
  .mod-select {
    background: var(--clr-surface-raised);
    color: var(--clr-text);
    color-scheme: inherit;
    border: 1px solid var(--clr-border);
    border-radius: var(--r-sm, 6px);
    padding: 6px 10px;
    font-size: 13px;
    min-width: 140px;
    cursor: pointer;
  }
  /* mobile: keep the toolbar a single slim swipe row over the canvas */
  @media (max-width: 700px) {
    .graph-toolbar { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; }
    .graph-toolbar::-webkit-scrollbar { display: none; }
    .mod-select { min-width: 120px; }
  }
  .plumb-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--clr-text-muted);
    cursor: pointer;
    white-space: nowrap;
  }
  .plumb-toggle input { accent-color: var(--clr-blue); }
  .hide-graph-btn,
  .show-graph-btn {
    background: none;
    border: 1px solid var(--clr-border-subtle);
    border-radius: var(--r-sm, 6px);
    color: var(--clr-text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 6px 12px;
    white-space: nowrap;
    transition: color 0.12s, border-color 0.12s;
  }
  .hide-graph-btn:hover, .show-graph-btn:hover { color: var(--clr-text); border-color: var(--clr-border-accent); }
  .show-graph-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 14px 0 4px;
  }
  .graph-status {
    position: absolute;
    bottom: 10px;
    right: 12px;
    z-index: 20;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--clr-text-muted);
    background: var(--toolbar-status-bg);
    border: 1px solid var(--toolbar-bd);
    border-radius: 6px;
    pointer-events: none;
  }
  .pop-card {
    position: absolute;
    transform: translate(-50%, -130%);
    z-index: 25;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 180px;
    padding: 10px 12px;
    background: var(--toolbar-bg);
    border: 1px solid var(--clr-label-bd);
    border-radius: var(--r-md, 10px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(90, 148, 232, 0.08);
    pointer-events: auto;
  }
  .pop-card strong { font-family: inherit; font-size: 13px; color: var(--clr-text); }
  .pop-x {
    position: absolute;
    top: 4px;
    right: 6px;
    background: none;
    border: none;
    color: var(--clr-text-faint);
    cursor: pointer;
    font-size: 11px;
  }
  .pop-x:hover { color: var(--clr-text); }
  .pop-actions { display: flex; gap: 6px; margin-top: 6px; }
  .pop-goto, .pop-expand {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: var(--r-sm, 4px);
    cursor: pointer;
    white-space: nowrap;
  }
  .pop-goto {
    background: none;
    border: 1px solid var(--clr-border-accent);
    color: var(--clr-blue);
  }
  .pop-expand {
    background: var(--clr-blue-strong, var(--clr-blue));
    border: 1px solid transparent;
    color: #fff;
    box-shadow: 0 0 12px rgba(90, 148, 232, 0.35);
  }
  .pop-expand:disabled { opacity: 0.4; cursor: default; box-shadow: none; }


  /* ── Tier vocabulary (added with the tiered engine) ─────────────────────── */
  .tier-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.15rem;
    height: 1.15rem;
    margin-left: 0.22rem;
    border-radius: 3px;
    font-size: 0.66rem;
    font-weight: 700;
    line-height: 1;
    border: 1px solid currentColor;
  }
  /* Strength descends visually, but never by colour alone — the letter is shown. */
  .tier-A { color: var(--ok, #2f9e5f); }
  .tier-B { color: var(--text, #cfd6e4); }
  .tier-C { color: var(--warn, #c08a2e); }
  .tier-D { color: var(--dim, #7b8698); }

  .tier-floor-badge {
    margin-left: 0.5rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    font-size: 0.68rem;
    color: var(--dim, #7b8698);
    border: 1px dashed currentColor;
  }

  .copy-xpp-btn {
    margin-left: 0.5rem;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.68rem;
    cursor: pointer;
    color: var(--ok, #2f9e5f);
    background: transparent;
    border: 1px solid currentColor;
  }
  .copy-xpp-btn:hover { background: rgba(47, 158, 95, 0.12); }

  .graph-notice {
    margin: 0 0 0.5rem;
    font-size: 0.72rem;
    color: var(--dim, #7b8698);
  }
  .join-tag {
    margin-left: 0.5rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.68rem;
    color: var(--dim, #7b8698);
    border: 1px solid currentColor;
  }
  .join-tag-C {
    color: var(--warn, #c08a2e);
  }
  .join-tag-D {
    color: var(--warn, #c08a2e);
    opacity: 0.85;
  }

  .class-badge {
    margin-left: 0.5rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--accent, #5b8dd9);
    border: 1px solid currentColor;
  }

  .canonical-exempt {
    opacity: 0.75;
    font-style: italic;
  }

  .inferred-badge {
    margin-left: 0.5rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.68rem;
    color: var(--dim, #7b8698);
    border: 1px dotted currentColor;
  }

  .bridge-warn {
    display: flex;
    gap: 0.35rem;
    margin-top: 0.2rem;
  }
  .bridge-flag {
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.68rem;
    color: var(--warn, #c08a2e);
    border: 1px solid currentColor;
  }

  .canonical-pin-badge {
    margin-left: 0.5rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--ok, #2f9e5f);
    border: 1px solid currentColor;
  }

  .graph-notice.seed-notice {
    padding: 0.35rem 0.55rem;
    border-left: 2px solid var(--warn, #c08a2e);
    color: var(--warn, #c08a2e);
  }
</style>
