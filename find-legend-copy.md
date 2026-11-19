# Table Path Finder legend copy

Copy for `/find`, rewritten for the page as it ships after `d375d03` (2026-11-19, the commit that removed the tier filter and the per-hop chips). `107bdb2` lands on top of it and touches no copy. Source of truth for the verbatim mirror in `src/lib/findLegendCopy.js`.

## How this deck maps to code

This is the third deck. The first documented the retired `pathScoring.js` engine, the second documented the tiered engine with a visible tier filter and per-hop chips. Both of those UI facts are gone, so this rewrite is mostly deletion.

- The **tier filter buttons were removed 2026-11-19.** The four-button "Minimum join" group (A · joinable / B · real FK / C · conditional / D · all) is no longer in the toolbar; the toolbar is Max hops (2/3/4/5) + Rank by (Story / Evidence). Two reasons, both measured: with the derived header→line relation class and 74 canonical pins the filter no longer changed the answer, and six per-hop chips per row were the main source of visual noise. The tier still gates the search and still decides whether `Copy X++` is offered — it is just no longer a control, and it is communicated as one tag on the rows that need it.
- `## Tooltip one-liners` feeds `TOOLTIP_COPY`. One row per tooltip, and the table holds every live tooltip: provenance badges, the relation-class pill, the three join tags, bridge flags, rank profiles, notes.
- Suggested keys, one per row in table order: `canonical`, `inferred`, `header-line`, `tag-scan`, `tag-conditional`, `tag-convention`, `bridge-cartesian`, `bridge-setup`, `copy-xpp`, `rank-story`, `rank-evidence`, `shortest-hops`, `truncated-note`, `missing-note`, `canonical-hint`, `known-canonical`. Net count goes 13 → 16: `weakest-hop` is deleted (no badge carries it any more) and four are new (`header-line`, `tag-scan`, `tag-conditional`, `tag-convention`).
- `TIER_MEANING` in `+page.svelte` has exactly two references left: its own definition and the join tag's `title`. Its four strings are 16/16/11/11 words — over the limit — so they must never be copied into `TOOLTIP_COPY`; the gate would fail on them. Point the tag's `title` at the `tag-*` keys instead, after which `TIER_MEANING` has no consumer and can be deleted outright.
- The `header→line` pill currently carries an inline `title=` of 24 words: "Header→line relation: one table is the document header and the other its line, joined on the header's own key. Derived from TableGroup, no curation." The `header→line` row below is the 12-word replacement; wire the pill to it and the inline string goes.
- The bridge flags already read `TOOLTIP_COPY['bridge-cartesian']` / `['bridge-setup']` and the two badges already read `TOOLTIP_COPY.canonical` / `.inferred`, so those four need no wiring work. The `canonical` pill still prefers the pair's `why` note from `canonical-fixtures.json` and falls back to this string, which is correct: the 74 `why` notes run 3 to 46 words and stay in the fixture file. The gate's word limit applies to the fallback string only.
- Two fixture files, two jobs, and the copy must not blur them. `canonical-fixtures.json` (74 arbitrated entries, 37 pairs in both directions, each with `why`) drives the `canonical` pill and the pinning. `path-fixtures.json` (23 regression pairs, `mustSurface`) drives the `Known canonical path` block. The deck calls the second one "the validated fixture set" for that reason.
- `## Legend section copy` feeds `LEGEND_GROUPS`: 3 groups, 10 sections. Headings are `Path ranking`, `Join quality`, `Notes`. Eight sections have one prose paragraph; `Join tags` has four (an intro plus the three tag lines, mirroring the old tier list) and `Canonical and inferred` has two. Bullets are deliberately absent: the gate treats every non-blank, non-table, non-heading line as a paragraph.
- `## Page strings` is markup the gate does not check. It corrects the strings that still describe the retired controls, plus six `TOOLTIP_COPY` lookups that resolve to nothing today.
- Every tooltip is 12 words or fewer. Legend prose has no word limit.
- Every number in this deck was re-measured on `static/data/graph-compact.json` (27,582 nodes, 58,310 hops) at the time of writing, not carried over from the brief. Two stale code comments to fix while applying this: the block comment above `isHeaderLineEdge` in `pathEngine.js` (~line 341) and the `tierFilter` comment in `+page.svelte` (~line 44) both cite 918 header→line relations and 44% at tier C/D, from an earlier export. The shipped artifact gives 719 and 54%.

### What changed since the last deck, and where it lands

1. Tier filter buttons removed → "How this deck maps to code", bullet 1; Page strings, results header.
2. Per-hop tier chips gone → legend `Join tags`.
3. Default minimum join is B, rank default Story → legend `Join tags` and `Story vs Evidence`.
4. One tag replaces the chips (`scan` / `conditional` / `convention`) → legend `Join tags`; three new `tag-*` tooltips.
5. New `header→line` provenance badge → legend `Relation classes`; new `header-line` tooltip.
6. `weakest hop X · not filtered` string gone → `weakest-hop` key deleted; `Copy X++` section rewritten to point at the tags.
7. Canonical pins bidirectional (37 pairs, 74 entries) → legend `Canonical and inferred`, second paragraph.
8. `InventTable → InventDim` now pins via `InventItemLocation` → no copy change; it is one row in `canonical-fixtures.json`, whose `why` note the `canonical` pill already renders verbatim. Nothing in the legend names that chain.

## Tooltip one-liners

Every tooltip below is 12 words or fewer.

| UI label | Tooltip copy |
| --- | --- |
| `canonical` pill | Arbitrated chain for this pair — verified by a D365FO domain owner. |
| `inferred` badge | Algorithm-ranked fallback: no arbitrated canonical chain for this pair. |
| `header→line` pill | TableGroup says header and line, joined on the header's own key. |
| `scan` tag | Declared FK, no index: a query may scan this table. |
| `conditional` tag | Join also constrains a discriminator field, so no Copy X++. |
| `convention` tag | No FK declared: convention only, so no Copy X++. |
| `⚠ table` (cartesian bridge) | Both neighbours join the same field, so rows pair up freely. |
| `⚠ table` (setup bridge) | Broad setup table used as a bridge; rows may multiply. |
| `Copy X++` | Copies this chain as a select-join; every hop is an indexed FK. |
| `Story` | Ranks by documented stage order from the six core flows. |
| `Evidence` | Ranks on AOT metadata alone: join tier, table group, deprecation. |
| `Shortest: N hops` | Fewest hops in the relation graph, regardless of business meaning. |
| `Top N shown` | More ranked paths exist; these are the highest-ranked ones. |
| `X is not in the graph` | The named table is not in the loaded graph. |
| `canonical path exists at N hops` | A pinned chain for this pair needs more hops than selected. |
| `Known canonical path` | Chain pinned from the validated fixture set for this pair. |

## Page strings

Markup, not gate-checked. Three classes of change: strings that still mention a removed control, the truncation note, and six `TOOLTIP_COPY` lookups that currently resolve to `undefined` because the deck deleted those keys in the previous rewrite.

Results header, `+page.svelte` line ~1060. `weakest join {tierFilter}` is now the only place the search gate is stated — there is no button to change it — so it has to read as a threshold, not as a control that was set. Drop the word "weakest", which described the removed badge.

```
{#if graphAvailable}joins at {tierFilter} or better · {rankBy === 'canonical' ? 'documented flows favoured' : 'metadata evidence only'}
{:else if sortMode === 'shortest'}fewest hops first{:else}ranked by class &amp; score{/if}
```

Loading state, line ~1018. The file is 2.3 MB (`fk-map.json` is 2,378,151 bytes), not 2.4. While here, note that the tiered engine ignores this string's claim about the seed graph: the fk-map still loads for autocomplete on both paths.

```
{#if graphAvailable}
Loading the table list… the AOT relation graph is already in memory.
{:else}
Fetching 43,616 verified table associations for the first time (~2.3 MB). This only happens once per session.
{/if}
```

Truncation note, line ~1107. The tiered branch is already correct prose but reads `sampled-note`, a deleted key. One element serves both branches, so split it rather than pointing the shared `data-tip` at `truncated-note`: the seed branch's "search space sampled" is a different claim.

```
{#if graphAvailable}
<p class="finder-note" data-tip={TOOLTIP_COPY['truncated-note']} tabindex="0" aria-describedby="find-tip">Top {pathResults.length} shown — more ranked paths exist for this pair.</p>
{:else}
<p class="finder-note" tabindex="0">Search space sampled: showing {pathResults.length} of many more possible paths. Reduce max hops for a shorter list.</p>
{/if}
```

Known-canonical block, line ~1152. Still outstanding from the previous deck: the badge reads `curated` and looks up `TOOLTIP_COPY.curated`, a key the module no longer exports, so the tooltip is empty. It is the same arbitrated knowledge as the row pill, so it should read `canonical` and use that key.

```
<span class="curated-badge" data-tip={TOOLTIP_COPY.canonical} …>canonical</span>
```

Seed-engine branch, four lookups at lines 1299, 1306, 1313, 1360 point at deleted keys: `cleanest-path`, `business-flow`, `curated`, `reason-chips`. With the two above that is six dead lookups in the file. They are unreachable while the AOT artifact loads, but a public clone renders them as empty `title` attributes. Either give the seed branch its own map (`SEED_TOOLTIP_COPY`) or accept empty tooltips there; do not re-add the keys to `TOOLTIP_COPY`, because the gate compares that object against the tooltip table and this deck is about the AOT page.

`src/routes/tables/[name]/+page.svelte`, line ~707. Checked, accurate, no change:

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

`Story` is the default and ranks on documented stage progression: the ordered stages of the six core flows in `flows.ts`, so a chain that advances through one process outranks one that walks backwards or jumps between flows. `Evidence` drops that signal and ranks on AOT metadata alone. Both profiles begin with the same two hard rules — a header→line single hop first, then any declared one-hop relation — and only then diverge into stage progression versus tier. Both read the same exhaustive enumeration, so switching profiles reorders the list without changing which paths are in it.

#### Shortest: N hops

`Shortest: N hops` in the results header is the fewest hops any returned chain uses between the two tables, counted in the relation graph rather than in foreign keys alone, so tier C and tier D hops count. It measures distance, not usefulness: the shortest chain can still be the wrong business route.

#### Canonical and inferred

A row marked `canonical` is the chain arbitrated by a D365FO domain owner for this table pair, pinned from `canonical-fixtures.json` and moved to the top of the list whatever the algorithm rank says. Its tooltip is that chain's `why` note, which states the posting or document step the hop sequence follows. Every other row is marked `inferred` unless its single hop is a header→line relation, in which case it shows that pill instead: a row carries one badge, and the order is canonical, then header→line, then inferred.

Pins are bidirectional. All 37 arbitrated pairs are stored in both directions, 74 entries in all, so `SalesLine → SalesTable` returns the same spine as `SalesTable → SalesLine`; a relation is the same fact whichever way you trace it. A pin also survives the tier gate: the chain is rebuilt straight from the graph when the search filter would have excluded it, because the pin is an arbitrated answer and the filter only scores evidence. `Known canonical path` is the same knowledge outside the ranking. That block holds the must-surface chains of the validated fixtures for this pair, shown whether or not the ranking reaches them, because an asserted chain can rank below the top N and still be the right answer. Rows already in the list are not repeated there; they carry the `canonical` pill instead. If a chain is longer than the current hop limit the page says so and names the hop count: raise max hops and it can be enumerated and pinned.

### Join quality

#### Join tags

Rows no longer carry a tier chip per hop. A hop's tier still gates the search — the default is B, declared foreign keys, because A-only hid real relations and D brought back the cartesian bridges — but the only tier fact that changes what you do with a row is whether the join is paste-safe, and that is one tag on the row. A tag means the row has no `Copy X++` button; no tag means it does.

`scan` — foreign key declared, no index: a real relation, a query may need to scan the table

`conditional` — the join also constrains a discriminator field, so an unqualified join can match the wrong rows

`convention` — no foreign key declared for this relation: the names agree, nothing enforces them

#### Relation classes

`header→line` is a relation class, not a grade, and it outranks every tier signal in both ranking profiles. It fires on a single hop when Microsoft's `TableGroup` says one table is the document header (`WorksheetHeader`, `TransactionHeader`) and the other its line (`WorksheetLine`, `TransactionLine`) and the join uses the header's own key: the same field on both sides, `RecId`, or a `*RecId` surrogate. On the shipped artifact it fires on 719 of the 58,310 hops, 1.2%, and 54% of those are tier C or D — which is exactly why tier cannot be trusted to surface them. It is derived from metadata with no curation, so it is a statement about what the tables are, not about which chain is the business answer.

#### Bridge warnings

A `⚠ table` flag means the path enters that table in a way that can multiply rows. The cartesian case is both neighbours joining the table on the same field, as `SalesTable > Currency > CustTrans` does on `CurrencyCode`: every sales order then pairs with every customer transaction sharing a currency. The quieter setup-bridge case is a broad Group, Reference or Parameter table used as a bridge. Read either flag as an instruction to check the where conditions, not as a rejected path.

#### Copy X++

`Copy X++` appears only on all-tier-A chains, where every hop is an indexed foreign key and the database enforces the join. The snippet is a `select` with one `join` per hop, oriented in traversal direction, and it is paste-safe as written. A chain with any B, C or D hop gets a single join tag instead — `scan`, `conditional` or `convention` — because the generated join would not be equivalent to the path shown.

### Notes

#### Top N shown

`Top N shown` is a display fact, not a warning. Within the scoped subgraph the search enumerates every simple path up to the hop limit and returns the first 50 of that ranking, so the list is a slice of a complete ordering rather than a sample. Lower the hop limit to shorten it. Both endpoints are always allowed, so a table outside the scoped flows still resolves as a destination.

#### Table not in the graph

`X is not in the graph` means the name was not found in the graph this build loaded. On the AOT artifact that graph has 27,582 nodes, so a missing name is usually a typo or a table newer than the artifact. Check spelling and capitalization first: table names are case-sensitive.

#### Which graph is in use

Every claim above is about the AOT artifact, and whether this build loaded it is the page's `graphAvailable` flag. With the artifact present, each hop is a declared D365FO relation graded A–D, ranking is verified for the six core flows — sales, procurement, production, inventory, project, finance — and the tier gate, join tags, relation class and bridge detection all apply. Tables outside those flows still resolve, but the order is best-effort. Without the artifact, as in a public clone with no licensed environment, the page runs on the public seed graph and says so: relations may be stale, and tiers, join tags, the header→line class and bridge detection do not apply.
