<script>
  // SectionToggle.svelte — collapsible .detail-section wrapper (UX #5).
  // Legacy Svelte idiom (no runes), zero deps. Default: expanded.
  // Collapse state persists in localStorage under one key per table:
  //   fno:tables:collapsed:{table} → comma-separated section ids
  export let table = ''
  export let sectionId = ''
  export let heading = '' // visible heading text (rendered by parent; aria-label for a11y)
  export let onToggle = null // (collapsed) => void — lets the page react (TOC ▸ indicator)

  let collapsed = false
  const storageKey = () => `fno:tables:collapsed:${table}`

  function readStored() {
    try {
      const raw = localStorage.getItem(storageKey())
      return (raw ?? '').split(',').filter(Boolean).includes(sectionId)
    } catch { return false }
  }

  function writeStored() {
    try {
      const raw = (localStorage.getItem(storageKey()) ?? '').split(',').filter(Boolean)
      const next = collapsed ? [...raw.filter((s) => s !== sectionId), sectionId] : raw.filter((s) => s !== sectionId)
      if (next.length) localStorage.setItem(storageKey(), next.join(','))
      else localStorage.removeItem(storageKey())
    } catch { /* private mode etc — collapse just won't persist */ }
  }

  $: if (typeof localStorage !== 'undefined') collapsed = readStored()

  function toggle() {
    collapsed = !collapsed
    writeStored()
    if (onToggle) onToggle(collapsed)
  }

  /** Expand (used by TOC jump to the Graph section) + focus the heading. */
  export function expand() {
    if (collapsed) { collapsed = false; writeStored(); if (onToggle) onToggle(false) }
  }
</script>

<section class="detail-section" class:collapsed={collapsed} id={`section-${sectionId}`}>
  <div class="section-heading">
    <button
      type="button"
      class="section-toggle"
      class:open={!collapsed}
      aria-expanded={!collapsed}
      aria-controls={`${sectionId}-body`}
      on:click={toggle}
      title={collapsed ? `Expand ${heading}` : `Collapse ${heading}`}
    >
      <span class="chev" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      <span class="section-title">{heading}</span>
    </button>
    <slot name="docs"></slot>
  </div>
  {#if !collapsed}
    <div id={`${sectionId}-body`} class="section-body">
      <slot></slot>
    </div>
  {/if}
</section>

<style>
  .section-toggle {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: transparent;
    border: none;
    padding: 8px 10px;
    margin: 0;
    font: inherit;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--clr-text-muted);
    cursor: pointer;
    text-align: left;
    min-height: 32px;
    border-radius: var(--r-sm, 6px);
  }
  @media (max-width: 700px) {
    .section-toggle { min-height: 44px; }
  }
  .section-toggle:hover { color: var(--clr-text); background: var(--clr-surface-raised); }
  .section-toggle:focus-visible { outline: 2px solid var(--clr-blue); outline-offset: 3px; border-radius: var(--r-sm, 6px); }
  .chev {
    display: inline-block;
    width: 14px;
    flex: none;
    color: var(--clr-text-muted);
    transition: transform 0.15s ease;
  }
  .section-toggle.open .chev { transform: rotate(0deg); }
  .section-title { color: inherit; }
</style>
