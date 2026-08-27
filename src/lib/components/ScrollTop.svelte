<script>
  // ScrollTop.svelte — zero-dep scroll-to-top FAB (UX round 2 #3).
  // Appears after 300px of scroll, hidden at top; reduced-motion → instant.
  import { onMount } from 'svelte'
  let visible = false
  let lastY = 0
  function onScroll() {
    const y = window.scrollY
    visible = y > 300
    lastY = y
  }
  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  function toTop() {
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }
  onMount(() => {
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  })
</script>

<button
  class="scroll-top"
  class:visible={visible}
  on:click={toTop}
  aria-label="Scroll to top"
  title="Scroll to top"
  tabindex={visible ? 0 : -1}
>↑</button>

<style>
  .scroll-top {
    position: fixed;
    right: 20px;
    bottom: 96px; /* above the graph pane zoom group (right:14 bottom:14) and the mobile bar */
    z-index: 120;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid var(--clr-border);
    background: var(--toolbar-bg, rgba(13, 17, 23, 0.72));
    color: var(--clr-text-muted);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
    opacity: 0;
    transform: translateY(8px);
    pointer-events: none;
    transition: opacity 0.2s, transform 0.2s, border-color 0.15s, color 0.15s;
  }
  .scroll-top:hover { border-color: var(--clr-border-accent); color: var(--clr-text); }
  .scroll-top.visible { opacity: 1; transform: translateY(0); pointer-events: auto; }
  :global(html.light) .scroll-top {
    /* solid surface in light (DESIGN.md rule 9) — token switches in html.light */
  }
</style>
