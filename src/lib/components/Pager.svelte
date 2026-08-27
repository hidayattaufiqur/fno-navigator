<script>
  // Svelte 5 runes component. Presentational pagination bar.
  // Controlled: receives page/pageSize/total and calls onPrev/onNext/onFirst/onLast.
  // Dependency-free, matches existing token language.
  let {
    page = 1,
    pageSize = 20,
    total = 0,
    onPrev = () => {},
    onNext = () => {},
  } = $props()

  const totalPages = $derived(total === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize)))
  const start = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1)
  const end = $derived(Math.min(page * pageSize, total))
</script>

{#if total > 0}
  <div class="pager" aria-label="Pagination">
    <span class="pager-range">{start}–{end} of {total}</span>
    <div class="pager-btns">
      <button
        class="pager-btn"
        disabled={page <= 1}
        on:click={() => onPrev()}
        aria-label="Previous page"
      >‹ Prev</button>
      <span class="pager-pages">{page} / {totalPages}</span>
      <button
        class="pager-btn"
        disabled={page >= totalPages}
        on:click={() => onNext()}
        aria-label="Next page"
      >Next ›</button>
    </div>
  </div>
{/if}

<style>
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .pager-range {
    font-size: 11px;
    color: var(--clr-text-muted);
    letter-spacing: 0.02em;
  }

  .pager-btns {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pager-pages {
    font-size: 11px;
    color: var(--clr-text-faint);
    min-width: 48px;
    text-align: center;
  }

  .pager-btn {
    padding: 8px 14px;
    min-height: 32px;
    border-radius: var(--r-sm, 6px);
    border: 1px solid var(--clr-border);
    background: var(--clr-surface-raised);
    color: var(--clr-text);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, opacity 0.15s;
  }
  @media (max-width: 700px) {
    .pager-btn { min-height: 44px; }
  }

  .pager-btn:hover:not(:disabled) {
    border-color: var(--clr-border-accent);
  }

  .pager-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Light mode border */
  html.light .pager { border-top-color: var(--clr-border-subtle); }
</style>
