NOTICE

This repository includes a derived dataset: `static/data/fk-map.json`, plus its
provenance manifest `static/data/map-manifest.json`.

Provenance and attribution:
- The dataset derives from table relationship data originally published by
  Microsoft as HTML ERD files in the ax-2012-doc-tools repository:
  https://github.com/Microsoft/ax-2012-doc-tools
- The HTML ERD files were processed into structured data by Alex Meyer's
  MicrosoftDynamicsTableAssociations project, which is the sole data source
  for this derived file: https://github.com/ameyer505/MicrosoftDynamicsTableAssociations
- `static/data/fk-map.json` is regenerated from that public source by
  `tools/generate-map.mjs` (deterministic, see README "Data provenance and
  regeneration"). Current build: 5,587 tables, 43,616 directed edges from the
  39,113-entry source (source commit af2a7c3, content sha256 33b670264b47…, as
  recorded in map-manifest.json). Composite multi-field relations are expanded
  into one edge per constituent field pair; marker-only specs and duplicate
  triples are dropped, all counted in the manifest.
- No other source (including licensed D365FO standard-source material) feeds
  data into the files committed in this repository. The upstream dataset above
  is the only input to `static/data/fk-map.json`.

## Verification layer (`static/data/graph-verdicts.json`)

The upstream Ax2012 dataset is roughly a product generation out of date. Measured
against a D365FO 10.0.2645 AOT with 180 models / 18,684 tables (2026-11-18):
**84.3%** of its 17,599 undirected table pairs are still declared, **2,759** are
not, **805** of its 5,632 tables no longer exist anywhere in the product, and 1
differs only by case.

`static/data/graph-verdicts.json` records that check in the only form that can be
published: **verdicts about what is wrong with the public seed, with no metadata
content**. Each entry is a table name (`unverified`) or a seed pair
(`unconfirmed`), plus a case-variant resolution where one exists. It contains no
labels, field descriptions, help text, cardinality, relationship types, direction
or TableGroup values — nothing but the boolean fact that a seed entry is or is not
still declared in a given product version.

Deliberately **not** included: the 26,729 pairs the AOT declares and the seed
lacks. That list is most of the real relation graph, so publishing it would be
redistributing Microsoft's relation metadata under a "verdicts" label. Only its
count ships. The committed file therefore says what is *wrong* with the public
map, never what the licensed graph *contains* — regenerating `fk-map.json` from
public input alone remains possible.

The full AOT-derived graph (`relation-graph.local.json`) is produced by
`tools/gen-relation-graph.mjs` for local use and is gitignored: it is licensed
metadata and is never redistributed. Building it requires a licensed environment,
which is why `fk-map.json` is *not* generated from it.

Coverage is reported honestly rather than assumed: the generator splits
unresolvable relation targets into platform **kernel** tables (`DataArea`,
`UserInfo`, `Security*`, `SqlDictionary`… — shipped by the platform, absent from
every model corpus by construction: 18 names / 676 edges measured) and
**unknown** names (a genuinely missing model). Only the second fails the
completeness gate, and on the full corpus it is 1 table / 1 edge.

License:
The upstream repositories referenced above are MIT licensed. The derived
dataset in this repository is provided under the MIT License with attribution
to the upstream sources. If you reuse or redistribute the dataset, include the
above attribution and the MIT license text.
