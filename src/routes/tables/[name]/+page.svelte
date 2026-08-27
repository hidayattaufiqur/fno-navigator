<script>
  import { onMount } from 'svelte'
  import RelationGraph from '$lib/components/RelationGraph.svelte'
  import Pager from '$lib/components/Pager.svelte'
  import { canonicalModule } from '$lib/utils'
  import { flows, tableDefs } from '$lib/data/flows'
  import { fkLoadState, loadFkMap, getSchemaEdgesForTable } from '$lib/stores/fkMap'
  import { getSpecificityMap, loadSpecificity } from '$lib/stores/specificity'
  import { COMMON_METHODS, METHOD_CATEGORIES } from '$lib/data/tableMethods'
  import ForceGraph3D from '$lib/components/ForceGraph3D.svelte'
  import { mergeStructuredEdges } from '$lib/graph/selectSlice'
  import { graphState, CANONICAL_MODULES, toggleModule, setAllModules, setShowPlumbing } from '$lib/stores/graphState'
  import { goto } from '$app/navigation'

  // @type {import('./$types').PageData}
  export let data

  // ── Known tables set (for filtering schema edges to relevant neighbors) ────
  // Includes every table referenced in any flow stage, plus all tableDefs
  const knownTables = new Set([
    ...Object.keys(tableDefs),
    ...flows.flatMap((flow) => flow.stages.flatMap((stage) => stage.tables)),
  ])

  // ── Schema FK enrichment (loaded lazily, non-blocking) ─────────────────────
  onMount(() => { loadFkMap(); loadSpecificity() })

  // SVG (List tab) keeps the 24-neighbour orbit contract; Sigma (Graph tab)
  // uses the Q4 40 cap. Both filtered to known tables.
  $: schemaEdges = $fkLoadState === 'ready'
    ? getSchemaEdgesForTable(data.name, knownTables, 24)
    : []
  $: sigmaSchemaEdges = $fkLoadState === 'ready'
    ? getSchemaEdgesForTable(data.name, knownTables, 40)
    : []

  // Remove schema edges that duplicate a hand-written relation (same from+to pair)
  $: manualEdgePairs = new Set(data.relationsUsing.map((r) => `${r.from}|${r.to}`))
  $: dedupedSchemaEdges = schemaEdges.filter((e) => !manualEdgePairs.has(`${e.from}|${e.to}`))
  $: dedupedSigmaSchemaEdges = sigmaSchemaEdges.filter((e) => !manualEdgePairs.has(`${e.from}|${e.to}`))

  // Combined edges for the graph
  $: allEdges = [...data.relationsUsing, ...dedupedSchemaEdges]
  $: allSigmaEdges = [...data.relationsUsing, ...dedupedSigmaSchemaEdges]

  // ── M3: List | Graph tabs (Q13 verbatim: Sigma after 24, SVG fallback) ─────
  // Tabs are per-page state; the Graph tab's default is SVG when the slice is
  // small. `?graph=1` forces the Sigma tab open on load (shareable).
  let activeTab = 'list' // 'list' | 'graph'
  onMount(() => {
    const sp = new URLSearchParams(location.search)
    if (sp.get('graph') === '1') activeTab = 'graph'
  })
  $: graphOn = activeTab === 'graph'

  // Sigma neighbourhood slice: centre = current table, satellites = merged
  // structured edges (manual + schema), cap 40 rare-first (Q4).
  // Built by a plain function (not an inline IIFE) — rollup's SSR pre-parse
  // chokes on `$: x = (() => { /** @type ... */ ... })()`.
  function buildStructuredNeighbourhood(edges) {
    const out = []
    for (const e of edges) {
      if (e.from === e.to) continue
      // edges carry fields[] as 'Child.childField → Parent.parentField' strings
      for (const f of e.fields ?? []) {
        const m = f.match(/^([^.]+)\.([^\s]+) → ([^.]+)\.([^\s]+)$/)
        if (!m) continue
        out.push({ from: m[1], fromField: m[2], to: m[3], toField: m[4] })
      }
    }
    return out
  }
  $: structuredNeighbourhood = buildStructuredNeighbourhood(allSigmaEdges)

  $: sigmaSlice = structuredNeighbourhood.length > 0
    ? { nodes: [...new Set(structuredNeighbourhood.flatMap((e) => [e.from, e.to]))].slice(0, 40), mergedEdges: mergeStructuredEdges(structuredNeighbourhood, getSpecificityMap()) }
    : null

  $: sigmaNodes = sigmaSlice?.nodes ?? []
  $: sigmaEdges = sigmaSlice?.mergedEdges ?? []
  $: sigmaOverflow = (structuredNeighbourhood.length > 0 ? sigmaNodes.length : 0) > 40 ? Math.max(0, sigmaNodes.length - 40) : 0

  // Module pills (Q10): counts over the current Sigma slice.
  $: graphStateSnap = $graphState
  $: modCounts = countModules(sigmaNodes)
  function countModules(tables) {
    const counts = {}
    for (const t of tables) {
      const m = canonicalModule(tableDefs[t]?.module)
      counts[m ?? 'Unknown'] = (counts[m ?? 'Unknown'] ?? 0) + 1
    }
    return counts
  }

  // URL loop: `?graph=1&modules=...` on toggle (Q12). Pager stays transient.
  function syncGraphUrl() {
    const sp = new URLSearchParams(location.search)
    if (!graphOn) { sp.delete('graph'); sp.delete('modules') }
    else {
      sp.set('graph', '1')
      const mods = graphStateSnap.visibleModules
      mods.length && mods.length < CANONICAL_MODULES.length ? sp.set('modules', mods.join(',')) : sp.delete('modules')
    }
    history.replaceState(null, '', `${location.pathname}?${sp.toString()}`)
  }
  function setTab(t) { activeTab = t; syncGraphUrl() }
  function onSigmaNodeClick(e) {
    const t = e?.table ?? e?.node ?? e
    if (t && t !== data.name) goto('/tables/' + t)
  }

  // ── Split by direction ─────────────────────────────────────────────────────
  $: outgoing = data.relationsUsing.filter((r) => r.from === data.name)
  $: incoming = data.relationsUsing.filter((r) => r.to === data.name)
  $: schemaOutgoing = dedupedSchemaEdges.filter((e) => e.from === data.name)
  $: schemaIncoming = dedupedSchemaEdges.filter((e) => e.to === data.name)

  $: mod = canonicalModule(data.def?.module)

  // ── Methods section state ──────────────────────────────────────────────────
  let methodSearch = ''
  let methodCategory = 'all'
  let showCommonOnly = true

  $: filteredMethods = COMMON_METHODS.filter((m) => {
    if (showCommonOnly && !m.common) return false
    if (methodCategory !== 'all' && m.category !== methodCategory) return false
    if (methodSearch) {
      const q = methodSearch.toLowerCase()
      return m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)
    }
    return true
  })

  const categoryKeys = ['all', ...Object.keys(METHOD_CATEGORIES)]

  // ── Lean sort + pagination helpers (dependency-free) ───────────────────────
  // sortedBy: stable sort of a copy by an accessor; accessor returns a string|number.
  function sortedBy(arr, accessor, dir) {
    if (!accessor) return arr
    const c = dir === 'desc' ? -1 : 1
    return [...arr].sort((a, b) => {
      const av = String(accessor(a) ?? '').toLowerCase()
      const bv = String(accessor(b) ?? '').toLowerCase()
      if (av < bv) return -1 * c
      if (av > bv) return 1 * c
      return 0
    })
  }
  function slicePage(arr, page, pageSize) {
    const start = (page - 1) * pageSize
    return arr.slice(start, start + pageSize)
  }

  // ── Field table sort + pagination ─────────────────────────────────────────◦
  const FIELD_PAGE_SIZE = 20
  let fieldSort = { key: 'name', dir: 'asc' }
  let fieldPage = 1
  const fieldAccessors = {
    name: (f) => f.name ?? '',
    type: (f) => f.type ?? '',
    fk: (f) => f.fkTarget ?? '',
    note: (f) => f.note ?? '',
  }
  $: allFields = data.def?.fields ?? []
  $: sortedFields = sortedBy(allFields, fieldAccessors[fieldSort.key], fieldSort.dir)
  $: shownFields = slicePage(sortedFields, fieldPage, FIELD_PAGE_SIZE)
  function setFieldSort(key) {
    if (fieldSort.key === key) {
      fieldSort = { key, dir: fieldSort.dir === 'asc' ? 'desc' : 'asc' }
    } else {
      fieldSort = { key, dir: 'asc' }
    }
    fieldPage = 1
  }

  // ── Methods sort + pagination ──────────────────────────────────────────────
  const METHOD_PAGE_SIZE = 20
  let methodSort = { key: 'name', dir: 'asc' }
  let methodPage = 1
  const methodAccessors = {
    name: (m) => m.name ?? '',
    category: (m) => METHOD_CATEGORIES[m.category].label ?? '',
    signature: (m) => m.signature ?? '',
    description: (m) => m.description ?? '',
  }
  $: sortedMethods = sortedBy(filteredMethods, methodAccessors[methodSort.key], methodSort.dir)
  $: shownMethods = slicePage(sortedMethods, methodPage, METHOD_PAGE_SIZE)
  function setMethodSort(key) {
    if (methodSort.key === key) {
      methodSort = { key, dir: methodSort.dir === 'asc' ? 'desc' : 'asc' }
    } else {
      methodSort = { key, dir: 'asc' }
    }
    methodPage = 1
  }

  // ── Relations sort + pagination (applies to every direction group) ────────
  const REL_PAGE_SIZE = 50
  let relSortKey = 'from'
  let relSortDir = 'asc'
  const relAccessors = {
    from: (r) => r.from ?? '',
    to: (r) => r.to ?? '',
    fields: (r) => (r.fields ?? []).join(' ') ?? '',
    stage: (r) => r.stageTitle ?? '',
    note: (r) => r.note ?? '',
  }
  function sortRels(rows, key, dir) { return sortedBy(rows, relAccessors[key], dir) }
  function setRelSort(key) {
    if (relSortKey === key) {
      relSortDir = relSortDir === 'asc' ? 'desc' : 'asc'
    } else {
      relSortKey = key
      relSortDir = 'asc'
    }
  }

  // Per direction-group page state + derived sorted/paged lists.
  let outgoingPage = 1
  let incomingPage = 1
  let schemaOutgoingPage = 1
  let schemaIncomingPage = 1
  $: sortedOutgoing = sortRels(outgoing, relSortKey, relSortDir)
  $: sortedIncoming = sortRels(incoming, relSortKey, relSortDir)
  $: sortedSchemaOutgoing = sortRels(schemaOutgoing, relSortKey, relSortDir)
  $: sortedSchemaIncoming = sortRels(schemaIncoming, relSortKey, relSortDir)
  $: shownOutgoing = slicePage(sortedOutgoing, outgoingPage, REL_PAGE_SIZE)
  $: shownIncoming = slicePage(sortedIncoming, incomingPage, REL_PAGE_SIZE)
  $: shownSchemaOutgoing = slicePage(sortedSchemaOutgoing, schemaOutgoingPage, REL_PAGE_SIZE)
  $: shownSchemaIncoming = slicePage(sortedSchemaIncoming, schemaIncomingPage, REL_PAGE_SIZE)
</script>

<svelte:head>
  <title>{data.name} · Table Reference · FnO Navigator</title>
</svelte:head>

<div class="breadcrumb">
  <a href="/tables">Table Reference</a>
  <span>/</span>
  <span>{data.name}</span>
</div>

<header class="table-def-header" data-module={mod}>
  {#if mod}
    <span class="module-badge" data-module={mod} title={data.def?.module}>{mod}</span>
  {:else if data.def?.module}
    <span class="module-badge">{data.def.module}</span>
  {:else}
    <p class="eyebrow">D365FO Table</p>
  {/if}
  <h2 class="table-def-name">{data.name}</h2>
  {#if data.def?.description}
    <p class="lede">{data.def.description}</p>
  {/if}
  {#if data.def?.docsUrl}
    <a href={data.def.docsUrl} target="_blank" rel="noreferrer" class="docs-link">
      Microsoft Learn docs ↗
    </a>
  {/if}
  <div class="trace-links">
    <a href="/find?from={data.name}" class="trace-link">⇢ Trace paths from {data.name}</a>
    <a href="/find?to={data.name}" class="trace-link trace-link-secondary">⇠ Trace paths to {data.name}</a>
  </div>
</header>

{#if data.def?.fields?.length}
  <section class="detail-section">
    <div class="section-heading">Key fields ({allFields.length})</div>
    <div class="field-table-wrap">
      <table class="field-table sortable-table">
        <thead>
          <tr>
            <th><button class="th-sort" class:active={fieldSort.key === 'name'} on:click={() => setFieldSort('name')}>Field{fieldSort.key === 'name' ? (fieldSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
            <th><button class="th-sort" class:active={fieldSort.key === 'type'} on:click={() => setFieldSort('type')}>Type{fieldSort.key === 'type' ? (fieldSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
            <th><button class="th-sort" class:active={fieldSort.key === 'fk'} on:click={() => setFieldSort('fk')}>FK / Reference{fieldSort.key === 'fk' ? (fieldSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
            <th><button class="th-sort" class:active={fieldSort.key === 'note'} on:click={() => setFieldSort('note')}>Description{fieldSort.key === 'note' ? (fieldSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
          </tr>
        </thead>
        <tbody>
          {#each shownFields as field}
            <tr>
              <td class="field-name">{field.name}</td>
              <td class="field-type">{field.type}</td>
              <td class="field-fk">
                {#if field.fkTarget}
                  <a href="/tables/{field.fkTarget}">{field.fkTarget}</a>
                {:else}
                  <span class="mini">—</span>
                {/if}
              </td>
              <td>{field.note}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pager
      page={fieldPage}
      pageSize={FIELD_PAGE_SIZE}
      total={sortedFields.length}
      onPrev={() => (fieldPage -= 1)}
      onNext={() => (fieldPage += 1)}
    />
  </section>
{:else}
  <div class="card no-def-notice">
    <div class="card-label">Field definitions</div>
    <p class="mini">
      No detailed field definitions yet for <strong>{data.name}</strong>. They'll be added as flows
      are enriched.
    </p>
  </div>
{/if}

<section class="detail-section">
  <div class="section-heading">
    Table Methods ({filteredMethods.length})
    <a
      href="https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/dev-ref/system-tables#common"
      target="_blank"
      rel="noreferrer"
      class="section-docs-link"
    >Common docs ↗</a>
  </div>
  <p class="mini methods-note">
    Inherited by every D365FO table from <code>Common</code>/<code>xRecord</code>. Static methods
    (<code>find</code>, <code>exist</code>, <code>findRecId</code>) are a near-universal convention
    on virtually every table. Toggle <em>Common only</em> off to see all 55 methods.
  </p>

  <div class="method-controls">
    <input
      class="method-search"
      type="text"
      placeholder="Search methods…"
      bind:value={methodSearch}
    />
    <div class="method-cat-pills">
      {#each categoryKeys as cat}
        <button
          class="cat-pill"
          class:active={methodCategory === cat}
          on:click={() => (methodCategory = cat)}
        >
          {cat === 'all' ? 'All' : METHOD_CATEGORIES[cat].label}
        </button>
      {/each}
    </div>
    <label class="common-toggle">
      <input type="checkbox" bind:checked={showCommonOnly} />
      Common only
    </label>
  </div>

  {#if filteredMethods.length === 0}
    <p class="mini" style="opacity:0.4;margin-top:12px">No methods match your filters.</p>
  {:else}
    <div class="field-table-wrap">
      <table class="field-table methods-table sortable-table">
        <thead>
          <tr>
            <th><button class="th-sort" class:active={methodSort.key === 'name'} on:click={() => setMethodSort('name')}>Method{methodSort.key === 'name' ? (methodSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
            <th><button class="th-sort" class:active={methodSort.key === 'category'} on:click={() => setMethodSort('category')}>Category{methodSort.key === 'category' ? (methodSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
            <th><button class="th-sort" class:active={methodSort.key === 'signature'} on:click={() => setMethodSort('signature')}>Signature{methodSort.key === 'signature' ? (methodSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
            <th><button class="th-sort" class:active={methodSort.key === 'description'} on:click={() => setMethodSort('description')}>Description{methodSort.key === 'description' ? (methodSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
          </tr>
        </thead>
        <tbody>
          {#each shownMethods as method (method.name)}
            <tr>
              <td class="field-name method-name-cell">
                {method.name}
                {#if method.overridable}
                  <span class="overridable-dot" title="Overridable in extension class">↑</span>
                {/if}
              </td>
              <td>
                <span class="method-badge cat-badge cat-{method.category}">
                  {METHOD_CATEGORIES[method.category].label}
                </span>
              </td>
              <td class="method-sig-cell"><code>{method.signature}</code></td>
              <td class="method-desc-cell">{method.description}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pager
      page={methodPage}
      pageSize={METHOD_PAGE_SIZE}
      total={sortedMethods.length}
      onPrev={() => (methodPage -= 1)}
      onNext={() => (methodPage += 1)}
    />
  {/if}
</section>

{#if allEdges.length > 0}
  <section class="detail-section">
    <div class="section-heading">
      Relation graph — {data.relationsUsing.length} documented{dedupedSchemaEdges.length > 0 ? ` + ${dedupedSchemaEdges.length} schema FK` : ''}
      {#if $fkLoadState === 'loading'}<span class="mini" style="margin-left:8px;opacity:0.5">loading schema…</span>{/if}
    </div>

    <!-- M3: List | Graph tabs (Q13). List = SVG orbit (unchanged, ≤24 fast path);
         Graph = Sigma neighbourhood (40 cap, pills + plumbing toggle). -->
    <div class="graph-tabs" role="tablist" aria-label="Relation graph view">
      <button
        class="graph-tab"
        class:active={activeTab === 'list'}
        role="tab"
        aria-selected={activeTab === 'list'}
        on:click={() => setTab('list')}
      >List</button>
      <button
        class="graph-tab"
        class:active={activeTab === 'graph'}
        role="tab"
        aria-selected={activeTab === 'graph'}
        on:click={() => setTab('graph')}
      >Graph{allSigmaEdges.length > 24 ? ' (24+)' : ''}</button>
    </div>

    {#if !graphOn}
      <!-- List tab: existing SVG orbit, unchanged -->
      <RelationGraph tableName={data.name} relations={allEdges} />
    {:else if graphOn}
      <!-- Graph tab: Sigma neighbourhood (Sigma after 24; SVG fallback if WebGL
           unavailable or the slice is tiny). -->
      {#if sigmaSlice && sigmaNodes.length > 0}
        <div class="graph-wrap">
          <ForceGraph3D
            nodes={sigmaNodes}
            edges={sigmaEdges}
            centre={data.name}
            height={520}
            onnodeclick={onSigmaNodeClick}
          >
            <div slot="fallback" class="graph-fallback">
              <p>WebGL is unavailable in this browser — showing the list view instead.</p>
            </div>
          </ForceGraph3D>
          <div class="graph-toolbar" role="toolbar" aria-label="Graph controls">
            <div class="mod-pills" role="group" aria-label="Filter tables by module">
              <button class="mod-pill" class:active={graphStateSnap.visibleModules.length === 0} on:click={setAllModules}>All</button>
              {#each CANONICAL_MODULES as m (m)}
                {@const c = modCounts[m] ?? 0}
                <button class="mod-pill" class:active={graphStateSnap.visibleModules.includes(m)} class:empty={c === 0} data-module={m} on:click={() => toggleModule(m)}><span class="dot"></span>{m} ({c})</button>
              {/each}
              <button class="mod-pill" class:active={graphStateSnap.visibleModules.includes('Unknown')} on:click={() => toggleModule('Unknown')}><span class="dot dot-unknown"></span>Unknown ({modCounts.Unknown ?? 0})</button>
            </div>
            <label class="plumb-toggle">
              <input type="checkbox" role="switch" checked={graphStateSnap.showPlumbing} on:change={(e) => setShowPlumbing(e.currentTarget.checked)} />
              Show plumbing
            </label>
          </div>
          {#if sigmaOverflow > 0}
            <p class="graph-status mini">Showing {sigmaNodes.length} of the nearest relations · {sigmaOverflow} more not shown</p>
          {/if}
        </div>
      {:else}
        <!-- Tiny slice (<1 structured edge): fall back to the orbit rather than a blank Sigma -->
        <RelationGraph tableName={data.name} relations={allEdges} />
      {/if}
    {/if}
  </section>
{/if}

{#if outgoing.length > 0 || incoming.length > 0}
  <section class="detail-section">
    <div class="section-heading">
      Table relations — documented ({data.relationsUsing.length})
    </div>

    <div class="rel-sort-bar" role="group" aria-label="Sort relations">
      <span class="rel-sort-label">Sort</span>
      <button class="rel-sort-btn" class:active={relSortKey === 'from'} on:click={() => setRelSort('from')}>From{relSortKey === 'from' ? (relSortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
      <button class="rel-sort-btn" class:active={relSortKey === 'to'} on:click={() => setRelSort('to')}>To{relSortKey === 'to' ? (relSortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
      <button class="rel-sort-btn" class:active={relSortKey === 'fields'} on:click={() => setRelSort('fields')}>FK field{relSortKey === 'fields' ? (relSortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
      <button class="rel-sort-btn" class:active={relSortKey === 'stage'} on:click={() => setRelSort('stage')}>Stage{relSortKey === 'stage' ? (relSortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
    </div>

    {#if outgoing.length > 0}
      <div class="rel-direction-section">
        <p class="rel-direction-label">Outgoing — {data.name} references these tables ({outgoing.length})</p>
        <div class="inline-relations">
          {#each shownOutgoing as rel}
            <div class="inline-rel">
              <a href="/tables/{rel.from}" class="rel-from self">{rel.from}</a>
              <span class="rel-arrow">→</span>
              <a href="/tables/{rel.to}" class="rel-to">{rel.to}</a>
              {#if rel.fields?.length}
                <code class="rel-fields">{rel.fields.join(', ')}</code>
              {/if}
              {#if rel.note}
                <span class="mini">{rel.note}</span>
              {/if}
              <a href="/flow/{rel.flowId}/{rel.stageId}" class="pill rel-source">{rel.stageTitle}</a>
            </div>
          {/each}
        </div>
        <Pager
          page={outgoingPage}
          pageSize={REL_PAGE_SIZE}
          total={sortedOutgoing.length}
          onPrev={() => (outgoingPage -= 1)}
          onNext={() => (outgoingPage += 1)}
        />
      </div>
    {/if}

    {#if incoming.length > 0}
      <div class="rel-direction-section">
        <p class="rel-direction-label">Incoming — tables that reference {data.name} ({incoming.length})</p>
        <div class="inline-relations">
          {#each shownIncoming as rel}
            <div class="inline-rel">
              <a href="/tables/{rel.from}" class="rel-from">{rel.from}</a>
              <span class="rel-arrow">→</span>
              <a href="/tables/{rel.to}" class="rel-to self">{rel.to}</a>
              {#if rel.fields?.length}
                <code class="rel-fields">{rel.fields.join(', ')}</code>
              {/if}
              {#if rel.note}
                <span class="mini">{rel.note}</span>
              {/if}
              <a href="/flow/{rel.flowId}/{rel.stageId}" class="pill rel-source">{rel.stageTitle}</a>
            </div>
          {/each}
        </div>
        <Pager
          page={incomingPage}
          pageSize={REL_PAGE_SIZE}
          total={sortedIncoming.length}
          onPrev={() => (incomingPage -= 1)}
          onNext={() => (incomingPage += 1)}
        />
      </div>
    {/if}
  </section>
{/if}

{#if dedupedSchemaEdges.length > 0}
  <section class="detail-section">
    <div class="section-heading schema-section-heading">
      Schema FK connections — auto-detected ({dedupedSchemaEdges.length})
      <span class="schema-badge">from FK schema</span>
    </div>
    <p class="mini schema-note">
      These FK links come directly from the D365FO database schema (43,584 verified associations across 5,587 tables),
      filtered to tables already referenced in documented flows. Self-referencing FKs (a table pointing to itself)
      are excluded. They show the physical FK field — not all of them are relevant to every business process.
    </p>

    {#if schemaOutgoing.length > 0}
      <div class="rel-direction-section">
        <p class="rel-direction-label">Outgoing — {data.name} has FK fields pointing to ({schemaOutgoing.length})</p>
        <div class="inline-relations">
          {#each shownSchemaOutgoing as rel}
            <div class="inline-rel schema-rel">
              <a href="/tables/{rel.from}" class="rel-from self">{rel.from}</a>
              <span class="rel-arrow">→</span>
              <a href="/tables/{rel.to}" class="rel-to">{rel.to}</a>
              {#if rel.fields?.length}
                <code class="rel-fields">{rel.fields[0]}</code>
              {/if}
            </div>
          {/each}
        </div>
        <Pager
          page={schemaOutgoingPage}
          pageSize={REL_PAGE_SIZE}
          total={sortedSchemaOutgoing.length}
          onPrev={() => (schemaOutgoingPage -= 1)}
          onNext={() => (schemaOutgoingPage += 1)}
        />
      </div>
    {/if}

    {#if schemaIncoming.length > 0}
      <div class="rel-direction-section">
        <p class="rel-direction-label">Incoming — tables with FK fields pointing to {data.name} ({schemaIncoming.length})</p>
        <div class="inline-relations">
          {#each shownSchemaIncoming as rel}
            <div class="inline-rel schema-rel">
              <a href="/tables/{rel.from}" class="rel-from">{rel.from}</a>
              <span class="rel-arrow">→</span>
              <a href="/tables/{rel.to}" class="rel-to self">{rel.to}</a>
              {#if rel.fields?.length}
                <code class="rel-fields">{rel.fields[0]}</code>
              {/if}
            </div>
          {/each}
        </div>
        <Pager
          page={schemaIncomingPage}
          pageSize={REL_PAGE_SIZE}
          total={sortedSchemaIncoming.length}
          onPrev={() => (schemaIncomingPage -= 1)}
          onNext={() => (schemaIncomingPage += 1)}
        />
      </div>
    {/if}
  </section>
{:else if $fkLoadState === 'idle'}
  <!-- FK map not yet loaded; will auto-populate once user interacts with the page -->
{/if}

{#if data.usedIn.length > 0}
  <section class="detail-section">
    <div class="section-heading">
      Used in {data.usedIn.length} stage{data.usedIn.length !== 1 ? 's' : ''}
    </div>
    <div class="table-usages">
      {#each data.usedIn as usage}
        <a href="/flow/{usage.flowId}/{usage.stageId}" class="table-usage">
          <span class="pill">{usage.flowTitle}</span>
          <span>{usage.stageTitle}</span>
        </a>
      {/each}
    </div>
  </section>
{/if}

<style>
  .trace-links {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 10px;
  }

  .trace-link {
    font-size: 12px;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 6px;
    text-decoration: none;
    border: 1px solid var(--clr-border);
    background: var(--clr-surface-raised);
    color: var(--clr-blue);
    transition: border-color 0.15s, background 0.15s;
  }

  .trace-link:hover {
    border-color: var(--clr-border-accent);
    background: var(--clr-surface-raised);
    text-decoration: none;
  }

  .trace-link-secondary { color: var(--clr-green); }

  .schema-section-heading {
    color: var(--clr-text-muted);
  }

  .schema-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
    background: var(--clr-surface-raised);
    border: 1px solid var(--clr-border);
    color: var(--clr-text-faint);
    margin-left: 8px;
    vertical-align: middle;
    letter-spacing: 0.3px;
  }

  .schema-note {
    color: var(--clr-text-faint);
    margin-bottom: 12px;
  }

  .schema-rel {
    opacity: 0.65;
  }

  .schema-rel:hover {
    opacity: 1;
  }

  /* ── Methods section ──────────────────────────────────────────────────────── */

  .section-docs-link {
    font-size: 11px;
    font-weight: 500;
    margin-left: 10px;
    color: var(--accent, #4fc3f7);
    opacity: 0.7;
    text-decoration: none;
  }
  .section-docs-link:hover { opacity: 1; }

  .methods-note {
    color: var(--clr-text-faint);
    margin-bottom: 14px;
    line-height: 1.6;
  }

  /* Controls row */
  .method-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }

  .method-search {
    flex: 0 0 200px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--clr-border);
    background: var(--clr-surface-raised);
    color: inherit;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }
  .method-search::placeholder { color: var(--clr-text-faint); }
  .method-search:focus { border-color: rgba(79, 195, 247, 0.5); }

  .method-cat-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .cat-pill {
    padding: 4px 10px;
    border-radius: 20px;
    border: 1px solid var(--clr-border);
    background: transparent;
    color: var(--clr-text-muted);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .cat-pill:hover { background: rgba(255,255,255,0.07); color: var(--clr-text); }
  .cat-pill.active { background: rgba(79,195,247,0.15); border-color: rgba(79,195,247,0.4); color: #4fc3f7; }

  .common-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--clr-text-muted);
    cursor: pointer;
    user-select: none;
    margin-left: auto;
  }
  .common-toggle input { cursor: pointer; accent-color: #4fc3f7; }

  /* Table tweaks for methods */
  .methods-table .method-name-cell {
    white-space: nowrap;
  }

  .overridable-dot {
    font-size: 10px;
    color: rgb(180, 140, 255);
    margin-left: 4px;
    cursor: default;
  }

  .method-sig-cell code {
    font-size: 11.5px;
    font-family: 'Fira Code', 'Cascadia Code', monospace;
    color: var(--clr-text-muted);
    white-space: nowrap;
  }

  .method-desc-cell {
    font-size: 12.5px;
    color: var(--clr-text);
    line-height: 1.5;
    min-width: 280px;
  }

  /* Category badge colours */
  .method-badge { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; letter-spacing: 0.3px; white-space: nowrap; }
  .cat-badge.cat-crud       { background: rgba(76,175,80,0.12);  border: 1px solid rgba(76,175,80,0.3);  color: var(--clr-green); }
  .cat-badge.cat-validation { background: rgba(255,152,0,0.12);  border: 1px solid rgba(255,152,0,0.3);  color: #ffb74d; }
  .cat-badge.cat-init       { background: rgba(33,150,243,0.12); border: 1px solid rgba(33,150,243,0.3); color: #64b5f6; }
  .cat-badge.cat-events     { background: rgba(156,39,176,0.12); border: 1px solid rgba(156,39,176,0.3); color: #ce93d8; }
  .cat-badge.cat-dataAccess { background: rgba(0,188,212,0.12);  border: 1px solid rgba(0,188,212,0.3);  color: #4dd0e1; }
  .cat-badge.cat-utility    { background: rgba(96,125,139,0.15); border: 1px solid rgba(96,125,139,0.35);color: #90a4ae; }
  .cat-badge.cat-static     { background: rgba(233,30,99,0.12);  border: 1px solid rgba(233,30,99,0.3);  color: #f48fb1; }

  /* ── Sortable column headers ─────────────────────────────────────────────── */
  .sortable-table th { padding: 0; vertical-align: middle; }

  .th-sort {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 10px 14px;
    border: none;
    background: transparent;
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--clr-text-muted);
    cursor: pointer;
    white-space: nowrap;
    text-align: left;
    transition: color 0.15s;
  }
  .th-sort:hover { color: var(--clr-text); }
  .th-sort.active { color: var(--clr-blue); }

  /* ── Relation sort toolbar ───────────────────────────────────────────────── */
  .rel-sort-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .rel-sort-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--clr-text-faint);
    margin-right: 4px;
  }
  .rel-sort-btn {
    padding: 4px 10px;
    border-radius: 20px;
    border: 1px solid var(--clr-border);
    background: transparent;
    color: var(--clr-text-muted);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .rel-sort-btn:hover { background: rgba(255,255,255,0.07); color: var(--clr-text); }
  .rel-sort-btn.active { background: rgba(79,195,247,0.15); border-color: rgba(79,195,247,0.4); color: #4fc3f7; }

  html.light .rel-sort-btn:hover { background: rgba(0,0,0,0.05); }

  /* ── M3: List | Graph tabs + Sigma toolbar (mirrors /find) ── */
  .graph-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
    border-bottom: 1px solid var(--clr-border);
  }
  .graph-tab {
    padding: 6px 14px;
    border: none;
    background: transparent;
    color: var(--clr-text-muted);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: all 0.15s;
  }
  .graph-tab:hover { color: var(--clr-text); }
  .graph-tab.active {
    color: var(--clr-blue-strong);
    border-bottom-color: var(--clr-blue-strong);
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
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 10px;
    /* glassmorphism over the starfield — same chrome as /find */
    background: var(--toolbar-glass, rgba(13, 17, 23, 0.55));
    border: 1px solid var(--clr-border-subtle);
    border-radius: var(--r-lg, 8px);
    backdrop-filter: blur(14px) saturate(1.3);
    -webkit-backdrop-filter: blur(14px) saturate(1.3);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
  }
  .mod-pills {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    flex: 1;
  }
  /* ── mobile: keep the glass toolbar a single slim swipe row over the canvas ── */
  @media (max-width: 700px) {
    .graph-toolbar { flex-wrap: nowrap; }
    .mod-pills {
      flex-wrap: nowrap;
      overflow-x: auto;
      min-width: 0;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .mod-pills::-webkit-scrollbar { display: none; }
    .mod-pill { flex: 0 0 auto; white-space: nowrap; }
  }
  .mod-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 20px;
    border: 1px solid var(--clr-border);
    background: transparent;
    color: var(--clr-text-muted);
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .mod-pill:hover { background: rgba(255,255,255,0.07); color: var(--clr-text); }
  .mod-pill.active { background: rgba(79,195,247,0.12); border-color: rgba(79,195,247,0.4); color: var(--clr-blue-strong); }
  .mod-pill .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--clr-blue);
    flex: none;
  }
  .mod-pill .dot-unknown { background: var(--clr-text-faint); }
  .mod-pill.empty { opacity: 0.45; }
  .plumb-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--clr-text-muted);
    cursor: pointer;
    margin-left: auto;
  }
  .graph-status {
    position: absolute;
    bottom: 10px;
    right: 12px;
    z-index: 20;
    padding: 4px 10px;
    color: var(--clr-text-muted);
    background: var(--toolbar-glass, rgba(13, 17, 23, 0.55));
    border: 1px solid var(--clr-border-subtle);
    border-radius: 999px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    pointer-events: none;
  }
  .graph-fallback {
    padding: 24px;
    text-align: center;
    color: var(--clr-text-faint);
    border: 1px dashed var(--clr-border);
    border-radius: 8px;
  }
  html.light .mod-pill:hover { background: rgba(0,0,0,0.05); }
  html.light .graph-toolbar,
  html.light .graph-status {
    --toolbar-glass: rgba(246, 248, 250, 0.72);
  }
</style>
