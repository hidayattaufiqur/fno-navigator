<script>
  import '../app.css'
  import { onMount } from 'svelte'
  import { page } from '$app/stores'
  import { afterNavigate } from '$app/navigation'
  import { flows, tableDefs } from '$lib/data/flows'

  let search = ''
  let sidebarOpen = false
  let isLight = typeof document !== 'undefined'
    ? document.documentElement.classList.contains('light')
    : false

  onMount(() => {
    isLight = document.documentElement.classList.contains('light')
    const splash = document.getElementById('splash')
    if (splash) {
      splash.classList.add('out')
      setTimeout(() => splash.remove(), 260)
    }
  })

  function toggleTheme() {
    isLight = !isLight
    document.documentElement.classList.toggle('light', isLight)
    localStorage.setItem('theme', isLight ? 'light' : 'dark')
  }

  // Close sidebar on any navigation (back button, programmatic goto, etc.)
  afterNavigate(() => { sidebarOpen = false })

  // Close sidebar when a nav link is clicked (immediate feedback before navigation)
  function closeOnNavLink(e) {
    if (e.target.closest('a')) sidebarOpen = false
  }

  $: currentFlowId = $page.params.flowId
  $: isTablesPage = $page.url.pathname.startsWith('/tables')
  $: isFindPage = $page.url.pathname.startsWith('/find')

  $: filteredFlows =
    search.trim().length < 1
      ? flows
      : flows.filter(
          (f) =>
            f.title.toLowerCase().includes(search.toLowerCase()) ||
            f.module.toLowerCase().includes(search.toLowerCase())
        )

  // Group filtered flows by module, preserving order of first appearance
  $: groupedFlows = (() => {
    const seen = ([])
    const result = ([])
    for (const flow of filteredFlows) {
      if (!seen.includes(flow.module)) {
        seen.push(flow.module)
        result.push({ module: flow.module, flows: filteredFlows.filter((otherFlow) => otherFlow.module === flow.module) })
      }
    }
    return result
  })()

  $: tableCount = Object.keys(tableDefs).length
</script>

<div class="mobile-bar">
  <button class="hamburger" aria-label="Open navigation" on:click={() => (sidebarOpen = true)}>
    <span></span><span></span><span></span>
  </button>
  <span class="mobile-title">FnO Navigator</span>
  <button class="theme-toggle-mobile" on:click={toggleTheme} aria-label="Toggle theme" title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}>
    {#if isLight}☾{:else}☀{/if}
  </button>
</div>

<!-- Backdrop overlay — click to close sidebar -->
<div
  class="nav-overlay"
  class:visible={sidebarOpen}
  on:click={() => (sidebarOpen = false)}
  role="presentation"
  aria-hidden="true"
></div>

<div class="page">
  <aside class="nav" class:open={sidebarOpen} on:click={closeOnNavLink}>
    <button class="nav-close-btn" aria-label="Close navigation" on:click|stopPropagation={() => (sidebarOpen = false)}>✕</button>

    <a href="/" class="brand" aria-label="Home">
      <div class="dot"></div>
      <div>
        <div class="eyebrow">D365FO helper</div>
        <h1>FnO Navigator</h1>
      </div>
    </a>

    <div class="nav-search">
      <input
        type="text"
        placeholder="Filter flows…"
        bind:value={search}
        aria-label="Filter flows by name or module"
      />
      {#if search}
        <button class="nav-search-clear" on:click={() => (search = '')} aria-label="Clear filter">
          ✕
        </button>
      {/if}
    </div>

    <div class="flow-list">
      {#if groupedFlows.length === 0}
        <div class="mini" style="padding: 8px 4px;">No flows match "{search}".</div>
      {:else}
        {#each groupedFlows as group}
          <div class="flow-group" data-module={group.module}>
            <div class="flow-group-label">{group.module}</div>
            {#each group.flows as flow}
              <a
                href="/flow/{flow.id}/{flow.stages[0].id}"
                class:selected={flow.id === currentFlowId}
                data-module={flow.module}
                aria-label="Open {flow.title}"
              >
                <span class="flow-list-dot"></span>
                <div class="flow-list-text">
                  <span>{flow.title}</span>
                  <small>{flow.summary}</small>
                </div>
              </a>
            {/each}
          </div>
        {/each}
      {/if}
    </div>

    <a href="/tables" class="nav-link" class:selected={isTablesPage && !isFindPage}>
      <span class="nav-link-icon">⬡</span>
      <span>Table Reference</span>
      <span class="nav-link-count" title="{tableCount} tables">{tableCount}</span>
    </a>

    <a href="/find" class="nav-link" class:selected={isFindPage}>
      <span class="nav-link-icon">⇢</span>
      <span>Find Table Path</span>
    </a>
  </aside>

  <main class="content">
    <slot />
  </main>
</div>

<button class="theme-toggle" on:click={toggleTheme} aria-label="Toggle theme" title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}>
  {#if isLight}☾{:else}☀{/if}
</button>

<style>
  /* Mobile-only theme toggle inside the top bar (DESIGN.md: move theme
     toggle INTO the top bar on mobile — it overlapped the TOC pills) */
  .theme-toggle-mobile { display: none; }

  .nav-link-count {
    margin-left: auto;
    font-size: 11px;
    background: var(--clr-surface-raised);
    color: var(--clr-text-muted);
    padding: 1px 7px;
    border-radius: 10px;
  }

  /* Fixed top-right theme toggle (desktop only; mobile uses the top bar) */
  .theme-toggle {
    position: fixed;
    top: 14px;
    right: 16px;
    z-index: 300;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--clr-surface);
    border: 1px solid var(--clr-border);
    border-radius: 6px;
    color: var(--clr-text-muted);
    font-size: 15px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    font-family: inherit;
    line-height: 1;
  }

  .theme-toggle:hover {
    border-color: var(--clr-border-accent);
    color: var(--clr-text);
  }

  @media (max-width: 900px) {
    .theme-toggle { display: none; }
    .theme-toggle-mobile {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      margin-left: auto;
      background: var(--clr-surface);
      border: 1px solid var(--clr-border);
      border-radius: 6px;
      color: var(--clr-text-muted);
      font-size: 16px;
      cursor: pointer;
      font-family: inherit;
      line-height: 1;
    }
    .theme-toggle-mobile:hover { color: var(--clr-text); }
  }
</style>
