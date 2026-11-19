# Table Path Finder legend copy

Copy for `/find`, rewritten for the tiered engine (`src/lib/pathEngine.js`) that replaced the retired `pathScoring.js` path on 2026-11-19. Source of truth for the verbatim mirror in `src/lib/findLegendCopy.js`.

## How this deck maps to code

This deck replaces the old one. The old copy documented a retired engine, so most of it goes away rather than gets edited.

- `## Tooltip one-liners` feeds `TOOLTIP_COPY`. One row per tooltip, and the general table holds every live tooltip: provenance badges, bridge flags, rank profiles, notes.
- Tier chip tooltips are the exception. They live in `TIER_MEANING` in `+page.svelte`, shared by the chip, the Minimum join filter and the `weakest hop` badge, and the four strings in the legend section below are copied from it word for word. Do not duplicate them into `TOOLTIP_COPY`; keep one array and have the legend section quote it.
- The old `### Reason chip tooltips` table and `REASON_TOOLTIP_COPY` are deleted outright. No reason chips exist in the tiered engine, so the gate's reason-table branch goes with them: remove the `REASON_TOOLTIP_COPY` import plus the `if (!reasonTable)` block (lines 85-93) from `tests/check-legend-copy.mjs`.
- Suggested keys, one per row in table order: `canonical`, `inferred`, `bridge-cartesian`, `bridge-setup`, `weakest-hop`, `copy-xpp`, `rank-story`, `rank-evidence`, `shortest-hops`, `truncated-note`, `missing-note`, `canonical-hint`, `known-canonical`. `missing-note`, `canonical-hint` and `known-canonical` are existing keys reused unchanged and `shortest-hops` keeps its key with new copy. The other nine are new; net count goes 11 → 13.
- Deletions. `curated` becomes `canonical` (two call sites, lines ~1102 and ~1254). `business-flow`, `cleanest-path`, `shortest`, `ranked-by-class-score` and `reason-chips` describe the retired engine and go with it; `shortest` and `ranked-by-class-score` are already unreferenced in `src/`, so those two cost nothing. `business-flow`, `cleanest-path` and `reason-chips` are still referenced in the `{:else}` seed-engine branch, so delete those data-tip attributes with the keys. The gate compares every `TOOLTIP_COPY` value against the table as a multiset, so a kept key without a row fails the check.
- The two provenance badges and the bridge flags currently carry inline `title=` strings rather than `TOOLTIP_COPY` lookups. Point them at the new keys so this deck stays the source of truth. Tier chips stay on `TIER_MEANING` (see above) because three UI surfaces read that one array.
- The bridge tooltip is one fixed string per reason, chosen on `br.reason`: `same-field-cartesian` gets `bridge-cartesian`, `setup-bridge` gets `bridge-setup`. The table name is already on the chip, so neither string needs interpolation and both stay inside the word limit. The current inline templates interpolate `br.table` and `br.field` mid-sentence, which is why they cannot move into `TOOLTIP_COPY` as they stand.
- The `canonical` pill tooltip is data-driven: render the pair's `why` note from `canonical-fixtures.json` when it exists, and fall back to this string when it does not. The 37 `why` notes run 3 to 35 words, so they stay in the fixture file and never enter `TOOLTIP_COPY`: the gate's word limit applies to the fallback string only.
- Two fixture files, two jobs, and the copy must not blur them. `canonical-fixtures.json` (37 arbitrated pairs, with `why`) drives the `canonical` pill and the pinning. `path-fixtures.json` (23 regression pairs, `mustSurface`) drives the `Known canonical path` block. The deck calls the second one "the validated fixture set" for that reason.
- `## Legend section copy` feeds `LEGEND_GROUPS`: 3 groups, 10 sections. Headings are `Path ranking`, `Join quality`, `Notes`. Eight sections have one prose paragraph; `Tier chips A–D` has five (an intro plus the four tier lines) and `Canonical and inferred` has two.
- `## Page strings` is markup the gate does not check. It corrects the strings that still describe the seed map or the sampled search. Apply by hand in `src/routes/find/+page.svelte` and `src/routes/tables/[name]/+page.svelte`.
- Every tooltip is 12 words or fewer. Legend prose has no word limit.

## Tooltip one-liners

Every tooltip below is 12 words or fewer.

| UI label | Tooltip copy |
| --- | --- |
| `canonical` pill | Arbitrated chain for this pair — verified by a D365FO domain owner. |
| `inferred` badge | Algorithm-ranked fallback: no arbitrated canonical chain for this pair. |
| `⚠ table` (cartesian bridge) | Both neighbours join the same field, so rows pair up freely. |
| `⚠ table` (setup bridge) | Broad setup table used as a bridge; rows may multiply. |
| `weakest hop X` | Weakest tier in this chain; not safe to paste as a join. |
| `Copy X++` | Copies this chain as a select-join; every hop is an indexed FK. |
| `Story` | Ranks by documented stage order from the six core flows. |
| `Evidence` | Ranks on AOT metadata alone: join tier, table group, deprecation. |
| `Shortest: N hops` | Fewest hops in the relation graph, regardless of business meaning. |
| `Top N shown` | More ranked paths exist; these are the highest-ranked ones. |
| `X is not in the graph` | The named table is not in the loaded graph. |
| `canonical path exists at N hops` | A pinned chain for this pair needs more hops than selected. |
| `Known canonical path` | Chain pinned from the validated fixture set for this pair. |

## Page strings

Markup, not gate-checked. Each block names the file and the state it applies to.

`src/routes/find/+page.svelte`, header lede. The number depends on which graph loaded, which the page already knows as `graphAvailable`.

```
{#if graphAvailable}
Find how two D365FO tables connect through declared relations. Uses the AOT relation graph:
<strong>27,582 nodes</strong> and 58,310 graded hops, derived from Microsoft metadata.
{:else}
Find how two D365FO tables connect through foreign keys. This build runs on the public seed graph
(<strong>43,616 relations</strong> across 5,587 tables), which can be stale or incomplete.
{/if}
```

Loading state. Fires on `$fkLoadState === 'loading'`, which happens on the seed path and also on the AOT path (the fk-map still loads for autocomplete). The seed-flavoured copy is only right in the first case, so split it, and fix the size: the file is 2.3 MB, not 2.4.

```
{#if graphAvailable}
Loading the table list… the AOT relation graph is already in memory.
{:else}
Fetching 43,616 verified table associations for the first time (~2.3 MB). This only happens once per session.
{/if}
```

Missing-table line, currently hard-coding 5,587 tables:

```
{#if graphAvailable}
<strong>{missing.join(', ')}</strong> {missing.length === 1 ? 'is' : 'are'} not in the 27,582-node AOT graph.
{:else}
<strong>{missing.join(', ')}</strong> {missing.length === 1 ? 'is' : 'are'} not in the 5,587-table seed graph.
{/if}
```

Truncation note. The tiered branch is wrong today: it says the search "stopped once no remaining path could beat those already found", but enumeration is exhaustive and `truncated` only means more ranked paths exist than were returned.

```
{#if graphAvailable}
Top {pathResults.length} shown — more ranked paths exist for this pair.
{:else}
Search space sampled: showing {pathResults.length} of many more possible paths. Reduce max hops for a shorter list.
{/if}
```

Results header, second clause only. The tier-filter half is accurate; `class & score` belongs to the legacy seed engine and stays under the `{:else}`.

```
{#if graphAvailable}weakest join {tierFilter} · {rankBy === 'canonical' ? 'documented flows favoured' : 'metadata evidence only'}
{:else if sortMode === 'shortest'}fewest hops first{:else}ranked by class &amp; score{/if}
```

Provenance notice. Already ships and is accurate; keep it as is, it carries the six-flow statement the legend reuses.

```
{#if graphAvailable}
Every hop is a declared D365FO relation, graded A–D by join strength. Ranking is verified for the six core
flows — sales, procurement, production, inventory, project, finance. Tables outside them still resolve, but
the order is best-effort.
{:else}
This build uses the public seed graph, derived from an older dataset — some relations may be stale or missing.
{/if}
```

Known-canonical caption, line ~1085. Two changes: the pill on that block reads `canonical` (line ~1102), and the caption stops implying the chain is outside the ranking when a matching row is pinned into it.

```
Curated knowledge: a validated chain for this pair, pinned from the fixture set, not algorithm-ranked
```

`src/routes/tables/[name]/+page.svelte`, line ~707. Same conditional as the lede.

```
{#if graphAvailable}
These links come from the AOT relation graph (27,582 nodes, 58,310 graded hops).
{:else}
These FK links come directly from the D365FO database schema (43,616 verified associations across 5,587 tables).
{/if}
```

## Legend section copy

### Path ranking

#### Story vs Evidence

`Story` ranks by documented stage progression: the ordered stages of the six core flows in `flows.ts`, so a chain that advances through one process outranks one that walks backwards or jumps between flows. `Evidence` drops that signal and ranks on AOT metadata alone. Both sort on the chain's weakest tier, then `cost`, then hop count; `Story` just puts stage progression ahead of all three. Both read the same enumeration, so switching profiles reorders the list without changing which paths are in it.

#### Shortest: N hops

`Shortest: N hops` is the fewest hops any returned chain uses between the two tables, counted in the relation graph rather than in foreign keys alone, so tier C and tier D hops count. It measures distance, not usefulness: the shortest chain can still be the wrong business route.

#### Canonical and inferred

A row marked `canonical` is the chain arbitrated by a D365FO domain owner for this table pair, pinned from `canonical-fixtures.json` and moved to the top of the list whatever the algorithm rank says. Its tooltip is that chain's `why` note, which states the posting or document step the hop sequence follows. Every other row is marked `inferred`: the ranking produced it and no arbitrated chain exists for the pair. Ranking signals cannot recover business intent on their own, which is why a pinned answer outranks them.

`Known canonical path` is the same knowledge outside the ranking. That block holds the must-surface chains of the validated fixtures for this pair, shown whether or not the ranking reaches them, because an asserted chain can rank below the top N and still be the right answer. Rows already in the list are not repeated there; they carry the `canonical` pill instead. If a chain is longer than the current hop limit the page says so and names the hop count: raise max hops and it can be enumerated and pinned.

### Join quality

#### Tier chips A–D

Every hop carries a tier chip graded from the declared AOT relation. The chip tooltip, the Minimum join filter and the chain's own verdict all use the same wording, and the lowest tier in the chain decides whether the row gets `Copy X++` or `weakest hop X`.

A — foreign key with an index: enforced by the database, safe to paste into X++

B — foreign key declared, no index: a real relation, a query may need to scan

C — conditional relation: the join also constrains a discriminator field

D — convention only: no foreign key declared for this relation

#### Weakest hop

`weakest hop X` names the lowest tier in a chain that is not fully joinable, and it is the reason that row has no `Copy X++` button. One hop weaker than an indexed foreign key means a pasted join may scan the table, or in the conditional case may omit the discriminator and match the wrong rows.

#### Bridge warnings

A `⚠ table` flag means the path enters that table in a way that can multiply rows. The cartesian case is both neighbours joining the table on the same field, as `SalesTable > Currency > CustTrans` does on `CurrencyCode`: every sales order then pairs with every customer transaction sharing a currency. The quieter `setup-bridge` case is a broad Group, Reference or Parameter table used as a bridge. Read either flag as an instruction to check the where conditions, not as a rejected path.

#### Copy X++

`Copy X++` appears only on all-tier-A chains, where every hop is an indexed foreign key and the database enforces the join. The snippet is a `select` with one `join` per hop, oriented in traversal direction, and it is paste-safe as written. A chain with any B, C or D hop gets `weakest hop X` instead, because the generated join would not be equivalent to the path shown.

### Notes

#### Top N shown

`Top N shown` is a display fact, not a warning. Within the scoped subgraph the search enumerates every simple path up to the hop limit and returns the first N of that ranking, so the list is a slice of a complete ordering rather than a sample. Lower the hop limit or raise the minimum join to shorten it. Both endpoints are always allowed, so a table outside the scoped flows still resolves as a destination.

#### Table not in the graph

`X is not in the graph` means the name was not found in the graph this build loaded. On the AOT artifact that graph has 27,582 nodes, so a missing name is usually a typo or a table newer than the artifact. Check spelling and capitalization first: table names are case-sensitive.

#### Which graph is in use

Every claim above is about the AOT artifact, and whether this build loaded it is the page's `graphAvailable` flag. With the artifact present, each hop is a declared D365FO relation graded A–D, and ranking is verified for the six core flows — sales, procurement, production, inventory, project, finance. Tables outside them still resolve, but the order is best-effort. Without the artifact, as in a public clone with no licensed environment, the page runs on the public seed graph and says so: relations may be stale, tiers and bridge detection do not apply, and an older scorer answers instead.
