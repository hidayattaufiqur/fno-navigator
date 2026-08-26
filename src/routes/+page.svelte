<script>
  import { flows, modules, tableDefs } from '$lib/data/flows'

  $: grouped = modules
    .filter((m) => m !== 'All')
    .map((m) => ({
      module: m,
      flows: flows.filter((f) => f.module === m),
    }))
    .filter((g) => g.flows.length > 0)

  $: totalStages = flows.reduce((n, f) => n + f.stages.length, 0)
  $: totalTables = Object.keys(tableDefs).length
</script>

<svelte:head>
  <title>FnO Navigator</title>
</svelte:head>

<header class="home-hero">
  <p class="eyebrow">Dynamics 365 Finance &amp; Operations</p>
  <h2>FnO Navigator</h2>
  <p class="lede">
    Understand business processes, trace table relations, and navigate technical customisations —
    without diving into the AOT blind.
  </p>
  <div class="hero-ctas">
    <a href="/tables" class="cta-button">⬡ Table Reference →</a>
    <a href="/find" class="cta-button cta-secondary">⇢ Find Table Path →</a>
  </div>
</header>

<div class="home-stats">
  <div class="stat-item">
    <span class="stat-num">{flows.length}</span>
    <span class="stat-label">Flows</span>
  </div>
  <div class="stat-item">
    <span class="stat-num">{totalStages}</span>
    <span class="stat-label">Stages</span>
  </div>
  <div class="stat-item">
    <span class="stat-num">{totalTables}</span>
    <span class="stat-label">Tables documented</span>
  </div>
  <div class="stat-item">
    <span class="stat-num">{grouped.length}</span>
    <span class="stat-label">Modules</span>
  </div>
</div>

<div class="module-grid">
  {#each grouped as group}
    <div class="module-card" data-module={group.module}>
      <div class="module-card-header">
        <span class="module-badge" data-module={group.module}>{group.module}</span>
      </div>
      {#each group.flows as flow}
        <a href="/flow/{flow.id}/{flow.stages[0].id}" class="flow-link">
          <div class="flow-link-title">{flow.title}</div>
          <div class="flow-link-summary">{flow.summary}</div>
        </a>
      {/each}
    </div>
  {/each}
</div>
