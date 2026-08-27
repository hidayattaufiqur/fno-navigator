<script>
  import { flows, tableDefs } from '$lib/data/flows'
  import { canonicalModule } from '$lib/utils'

  // Build a lookup: tableName → [{flowId, flowTitle, stageId, stageTitle}]
  // Done inline (not via +page.js) to avoid Svelte 5 legacy-mode prop issues.
  const tableUsageIndex = (() => {
    // @type {Record<string, {flowId: string, flowTitle: string, stageId: string, stageTitle: string}[]>}
    const index = {}
    for (const flow of flows) {
      for (const stage of flow.stages) {
        for (const tableName of stage.tables) {
          if (!index[tableName]) index[tableName] = []
          index[tableName].push({ flowId: flow.id, flowTitle: flow.title, stageId: stage.id, stageTitle: stage.title })
        }
      }
    }
    return index
  })()

  let searchQuery = ''
  let moduleFilter = 'All'

  $: allTableNames = Object.keys(tableUsageIndex).sort()

  // Canonical module names for filter pills (≤8 clean names instead of 54 raw CDM strings)
  $: moduleOptions = [
    'All',
    ...Array.from(
      new Set(Object.values(tableDefs).map((def) => canonicalModule(def.module)).filter(Boolean))
    ).sort(),
  ]

// Returns a label explaining why a table matched the query (or null if matched by name).
// @param {string} tableName @param {string} queryLower
  function matchReason(tableName, queryLower) {
    const tableDef = tableDefs[tableName]
    if (tableName.toLowerCase().includes(queryLower)) return null // name match — no label needed
    if (tableDef?.description?.toLowerCase().includes(queryLower)) return 'description'
    if (tableDef?.fields?.some((field) => field.name.toLowerCase().includes(queryLower))) return 'field name'
    if (tableDef?.fields?.some((field) => field.note.toLowerCase().includes(queryLower))) return 'field note'
    return null
  }

// Returns true if the table matches the search query (name, description, field name, or field note).
// Single source of truth — used by both the results filter and matchReason.
// @param {string} tableName @param {string} queryLower
  function tableMatchesQuery(tableName, queryLower) {
    if (tableName.toLowerCase().includes(queryLower)) return true
    const tableDef = tableDefs[tableName]
    if (tableDef?.description?.toLowerCase().includes(queryLower)) return true
    if (tableDef?.fields?.some((field) => field.name.toLowerCase().includes(queryLower))) return true
    if (tableDef?.fields?.some((field) => field.note.toLowerCase().includes(queryLower))) return true
    return false
  }

  $: searchResults =
    searchQuery.trim().length < 2
      ? []
      : allTableNames.filter((name) => tableMatchesQuery(name, searchQuery.trim().toLowerCase()))

  $: allTables = searchQuery.trim().length < 2 ? allTableNames : []

  $: filteredTables =
    moduleFilter === 'All'
      ? allTables
      : allTables.filter((name) => canonicalModule(tableDefs[name]?.module) === moduleFilter)
</script>

<svelte:head>
  <title>Table Reference · FnO Navigator</title>
</svelte:head>

<header class="hero">
  <div>
    <p class="eyebrow">Dynamics 365 Finance &amp; Operations</p>
    <h2>Table Reference</h2>
    <p class="lede">
      Look up any D365FO table to see which business processes reference it, what fields link tables
      together, and where to find documentation.
    </p>
  </div>
  <div class="controls">
    <div class="search search-standalone">
      <label for="table-search">Search table / entity name</label>
      <input
        id="table-search"
        type="text"
        placeholder="e.g. SalesTable, CustTrans, InventTrans"
        bind:value={searchQuery}
      />
    </div>
  </div>
</header>

<section class="tables-section">
  {#if searchResults.length > 0}
    <div class="section-heading">{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</div>
    <div class="table-results">
      {#each searchResults as tableName}
        {@const usages = tableUsageIndex[tableName]}
        {@const tableDef = tableDefs[tableName]}
        {@const reason = matchReason(tableName, searchQuery.trim().toLowerCase())}
        <div class="table-result-group">
          <div class="table-result-header">
            <a href="/tables/{tableName}" class="table-name">{tableName}</a>
            {#if tableDef}
              {@const mod = canonicalModule(tableDef.module)}
              {#if mod}
                <span
                  class="pill"
                  data-module={mod}
                  title={tableDef.module}
                  style="background: var(--mod-clr-bg, var(--clr-border)); color: var(--mod-clr, var(--clr-blue-strong)); border: 1px solid var(--mod-clr-border, transparent);"
                >{mod}</span>
              {/if}
              <span class="mini">{tableDef.description}</span>
            {/if}
            {#if reason}
              <span class="match-reason">matched {reason}</span>
            {/if}
          </div>
          <div class="table-usages">
            {#each usages as usage}
              <a href="/flow/{usage.flowId}/{usage.stageId}" class="table-usage">
                <span class="pill">{usage.flowTitle}</span>
                <span>{usage.stageTitle}</span>
              </a>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else if searchQuery.trim().length >= 2}
    <div class="empty">No tables match "{searchQuery.trim()}".</div>
  {:else}
    <div class="module-filter-row">
      {#each moduleOptions as moduleOption}
        <button
          class="mod-pill"
          class:active={moduleFilter === moduleOption}
          data-module={moduleOption !== 'All' ? moduleOption : undefined}
          on:click={() => (moduleFilter = moduleOption)}
        >{#if moduleOption !== 'All'}<span class="dot"></span>{/if}{moduleOption}</button>
      {/each}
    </div>
    <div class="section-heading">
      {filteredTables.length} table{filteredTables.length !== 1 ? 's' : ''}
      {moduleFilter !== 'All' ? ` in ${moduleFilter}` : ''}
    </div>
    <div class="table-browse-grid">
      {#each filteredTables as tableName}
        {@const tableDef = tableDefs[tableName]}
        <a href="/tables/{tableName}" class="table-browse-item">
          <span class="table-name-sm">{tableName}</span>
          {#if tableDef}
            <span class="mini">{tableDef.description}</span>
          {:else}
            <span class="mini usage-count"
              >{tableUsageIndex[tableName].length} stage{tableUsageIndex[tableName].length !== 1
                ? 's'
                : ''}</span
            >
          {/if}
        </a>
      {/each}
    </div>
  {/if}
</section>
