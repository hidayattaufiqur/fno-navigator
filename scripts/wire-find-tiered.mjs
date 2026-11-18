#!/usr/bin/env node
// One-shot wiring of /find to the tiered engine. Idempotent-ish: run on a clean
// file. Kept as a script rather than hand-edits because the previous attempt
// corrupted the Svelte <style> block, and a script that asserts each anchor
// exists fails loudly instead of producing a broken file.
//
//   node scripts/wire-find-tiered.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'src', 'routes', 'find', '+page.svelte')
let s = readFileSync(P, 'utf8')
const before = s

const sub = (name, old, neu) => {
  if (!s.includes(old)) throw new Error(`anchor missing: ${name}`)
  s = s.replace(old, neu)
  console.log(`  ok ${name}`)
}

// ── script: imports ────────────────────────────────────────────────────────
sub(
  'import engine',
  `  import { findPaths } from '$lib/pathfinder'`,
  `  import { findPaths as findPathsLegacy } from '$lib/pathfinder'
  import { loadGraph, findPaths as findPathsTiered, setFlowCohorts, graphLoadState } from '$lib/pathEngine'`,
)

sub('import flows', `import { tableDefs } from '$lib/data/flows'`, `import { tableDefs, flows } from '$lib/data/flows'`)

// ── script: state + helpers ────────────────────────────────────────────────
sub(
  'state + helpers',
  `  let sortMode = $findState.sortMode`,
  `  let sortMode = $findState.sortMode

  // Tiered engine state. graphStatus decides which engine answers: 'ready' means
  // the generated verification graph is present; anything else means this build
  // has only the public seed map and must use the legacy scorer.
  let graphStatus = 'idle'
  let tierFilter = 'D'
  let rankBy = 'evidence'
  let copiedKey = ''
  $: graphAvailable = graphStatus === 'ready'

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
  function buildFlowCohorts() {
    const m = new Map()
    let stage = 0
    for (const flow of flows ?? []) {
      for (const st of flow.stages ?? []) {
        const id = stage++
        for (const t of st.tables ?? []) if (!m.has(t)) m.set(t, id)
      }
    }
    return m
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
  }`,
)

// ── script: mount load ─────────────────────────────────────────────────────
sub(
  'mount',
  `    graphOn = resolveGraphFlag()`,
  `    // Cohorts first (so the story profile has its stage adjacency), then the
    // artifact. A 404 is a normal state for a public clone, not an error.
    setFlowCohorts(buildFlowCohorts())
    loadGraph().then(() => {
      graphStatus = graphLoadState.status
    })
    graphOn = resolveGraphFlag()`,
)

// ── script: search dispatch ────────────────────────────────────────────────
sub(
  'search dispatch',
  `    const { results, shortest, truncated: wasTruncated, missing: missingTables } = findPaths(sourceTable, targetTable, maxHops, { sort: sortMode })`,
  `    // Which engine answers. The tiered engine needs the generated graph; a public
    // clone has only the MIT seed map, so it falls back to the legacy scorer.
    // Never silent: graphAvailable drives a visible provenance notice.
    let results, shortest, wasTruncated, missingTables
    if (graphAvailable) {
      const r = findPathsTiered(sourceTable, targetTable, {
        maxHops,
        maxResults: 50,
        minTier: tierFilter,
        rankBy,
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
    }`,
)

// ── template: controls ─────────────────────────────────────────────────────
sub(
  'controls',
  `      <fieldset class="sort-fieldset">
        <legend class="sort-label">Sort</legend>
        <div class="sort-toggle" role="group" aria-label="Path sort order">
          <button
            type="button"
            class="sort-btn"
            class:sort-active={sortMode === 'shortest'}
            aria-pressed={sortMode === 'shortest'}
            on:click={() => changeSort('shortest')}
          >Shortest</button>
          <button
            type="button"
            class="sort-btn"
            class:sort-active={sortMode === 'unique'}
            aria-pressed={sortMode === 'unique'}
            on:click={() => changeSort('unique')}
          >Most unique</button>
        </div>
      </fieldset>`,
  `      {#if graphAvailable}
        <fieldset class="sort-fieldset">
          <legend class="sort-label">Join strength</legend>
          <div class="sort-toggle" role="group" aria-label="Minimum join strength">
            <button type="button" class="sort-btn"
              class:sort-active={tierFilter === 'A'} aria-pressed={tierFilter === 'A'}
              title={TIER_MEANING.A} on:click={() => (tierFilter = 'A')}>A · joinable</button>
            <button type="button" class="sort-btn"
              class:sort-active={tierFilter === 'B'} aria-pressed={tierFilter === 'B'}
              title={TIER_MEANING.B} on:click={() => (tierFilter = 'B')}>B · real FK</button>
            <button type="button" class="sort-btn"
              class:sort-active={tierFilter === 'C'} aria-pressed={tierFilter === 'C'}
              title={TIER_MEANING.C} on:click={() => (tierFilter = 'C')}>C · conditional</button>
            <button type="button" class="sort-btn"
              class:sort-active={tierFilter === 'D'} aria-pressed={tierFilter === 'D'}
              title={TIER_MEANING.D} on:click={() => (tierFilter = 'D')}>D · all</button>
          </div>
        </fieldset>
        <fieldset class="sort-fieldset">
          <legend class="sort-label">Rank by</legend>
          <div class="sort-toggle" role="group" aria-label="Ranking profile">
            <button type="button" class="sort-btn"
              class:sort-active={rankBy === 'evidence'} aria-pressed={rankBy === 'evidence'}
              title="Rank on D365FO metadata alone: join type, table group, deprecation"
              on:click={() => (rankBy = 'evidence')}>Evidence</button>
            <button type="button" class="sort-btn"
              class:sort-active={rankBy === 'story'} aria-pressed={rankBy === 'story'}
              title="Favour documented business flows: document-ID continuity and documented stages"
              on:click={() => (rankBy = 'story')}>Story</button>
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
      {/if}`,
)

// ── template: header prose ─────────────────────────────────────────────────
sub(
  'header prose',
  `          · {#if sortMode === 'shortest'}fewest hops first{:else}ranked by class &amp; score{/if}`,
  `          · {#if graphAvailable}weakest join {tierFilter} · {rankBy === 'story' ? 'documented flows favoured' : 'metadata evidence only'}{:else if sortMode === 'shortest'}fewest hops first{:else}ranked by class &amp; score{/if}`,
)

// ── template: honest truncation note ───────────────────────────────────────
sub(
  'truncation note',
  `>Search space sampled: showing {pathResults.length} of many more possible paths. Reduce max hops for a shorter list.</p>`,
  `>{graphAvailable
            ? \`Top \${pathResults.length} shown — the search stopped once no remaining path could beat those already found.\`
            : \`Search space sampled: showing \${pathResults.length} of many more possible paths. Reduce max hops for a shorter list.\`}</p>`,
)

// ── template: provenance notice ────────────────────────────────────────────
sub(
  'provenance notice',
  `      <div class="results-header">
        <span class="section-heading">`,
  `      <div class="results-header">
        <p class="graph-notice" class:seed-notice={!graphAvailable}>
          {#if graphAvailable}
            Paths verified against D365FO metadata: every hop is a declared relation, graded A–D by join strength.
          {:else}
            This build uses the public seed graph, derived from an older dataset — some relations may be stale or missing.
          {/if}
        </p>
        <span class="section-heading">`,
)

// ── template: tier chip per hop ────────────────────────────────────────────
sub(
  'tier chip',
  `                  <a href="/tables/{step.table}" class="path-table-link"
                    class:path-source={stepIndex === 0}
                    class:path-target={stepIndex === result.steps.length - 1}
                  >{step.table}</a>
                {/each}`,
  `                  <a href="/tables/{step.table}" class="path-table-link"
                    class:path-source={stepIndex === 0}
                    class:path-target={stepIndex === result.steps.length - 1}
                  >{step.table}</a>
                  {#if graphAvailable && step.tier}
                    <span class="tier-chip tier-{step.tier}" title={TIER_MEANING[step.tier]}>{step.tier}</span>
                  {/if}
                {/each}`,
)

// ── template: copy X++ / weakest hop badge ─────────────────────────────────
sub(
  'row badge',
  `                {#if i === cleanestIndex}
                  <span
                    class="cleanest-badge"
                    data-tip={TOOLTIP_COPY['cleanest-path']}
                    tabindex="0"
                    aria-describedby="find-tip"
                  >cleanest path</span>
                {:else if result.qualityClass === 3}`,
  `                {#if graphAvailable}
                  {#if result.joinable}
                    <button
                      type="button"
                      class="copy-xpp-btn"
                      title="Copy this chain as an X++ select-join — every hop is an indexed foreign key"
                      on:click={() => copyXpp(result)}
                    >{copiedKey === result.key ? 'Copied' : 'Copy X++'}</button>
                  {:else}
                    <span class="tier-floor-badge" title={TIER_MEANING[result.tierFloor]}>
                      weakest hop {result.tierFloor}
                    </span>
                  {/if}
                {:else if i === cleanestIndex}
                  <span
                    class="cleanest-badge"
                    data-tip={TOOLTIP_COPY['cleanest-path']}
                    tabindex="0"
                    aria-describedby="find-tip"
                  >cleanest path</span>
                {:else if result.qualityClass === 3}`,
)

// ── template: breakdown cost ───────────────────────────────────────────────
sub(
  'breakdown cost',
  `                {hops} hop{hops !== 1 ? 's' : ''}
                {#if result.qualityClass <= 2}
                  <span aria-hidden="true"> · </span>score {result.score}
                {/if}`,
  `                {hops} hop{hops !== 1 ? 's' : ''}
                {#if graphAvailable}
                  <span aria-hidden="true"> · </span>cost {result.cost}
                {:else if result.qualityClass <= 2}
                  <span aria-hidden="true"> · </span>score {result.score}
                {/if}`,
)

// ── style: insert INSIDE the existing block, before its closing tag ────────
const css = `
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
  .graph-notice.seed-notice {
    padding: 0.35rem 0.55rem;
    border-left: 2px solid var(--warn, #c08a2e);
    color: var(--warn, #c08a2e);
  }
`
if (!s.includes('</style>')) throw new Error('no closing style tag to anchor on')
s = s.replace(/<\/style>\s*$/, `${css}</style>\n`)
console.log('  ok style block')

if (s === before) throw new Error('no change produced')
writeFileSync(P, s)
console.log('wired /find for the tiered engine')
