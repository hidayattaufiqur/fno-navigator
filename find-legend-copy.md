# Table Path Finder legend copy

Copy for `/find`, based on the current strings and `REASON_LABELS` map in `src/routes/find/+page.svelte`.

## Tooltip one-liners

Every tooltip below is 12 words or fewer.

| UI label | Tooltip copy |
| --- | --- |
| `Business flow` | Follows a document flow with continuous document IDs. |
| `curated` | Verified by the app team, pinned from the dataset, not algorithm-ranked. |
| `cleanest path` / `Top-ranked path` | The #1 row under class, score, and hop ranking. |
| `shortest` badge | This path uses the fewest verified FK hops found. |
| `Shortest: N hops` | Fewest verified FK hops, independent of business meaning. |
| `ranked by class & score` | Class shows quality tier. Score totals weighted evidence. |
| `reason chips` | Each chip names evidence behind this path's rank. |
| `search space sampled, showing N of M+` | Best paths found in a limited search sample, not exhaustive. |
| `X is not in the dataset` | The named table is absent from the dataset. |
| `canonical path exists at N hops` | A verified canonical path needs more hops than selected. |
| `Known canonical path` | Verified chain pinned from documented flows, not algorithm-ranked. |

### Reason chip tooltips

| Code | Tooltip copy |
| --- | --- |
| `business-flow-pattern` | Follows a document flow. |
| `document-id-continuity` | Document IDs stay continuous across hops. |
| `named-reference-joins` | Named reference joins, with no anonymous RecId. |
| `business-key-joins` | Uses a business-key path. |
| `generic-lookup-intermediate` | Passes through a generic lookup. |
| `curated-tables` | Passes curated tables. |
| `rare-relations` | Uses rare relation fields. |
| `common-relations` | Uses common relation fields. |
| `weak-semantic-signal` | Weak semantic signal. |
| `plumbing-detour` | Contains a plumbing detour. |
| `same-table` | Same table on both ends. |

## Legend section copy

### Path ranking

#### Cleanest path and Top-ranked path

The `cleanest path` marker identifies row #1 in the current result list. The ranking compares class first, then score, then hop count, with deterministic tie-breakers after that. It does not mean the path is shortest or universally best.

#### Shortest: N hops

`Shortest: N hops` counts the fewest verified foreign-key hops between the selected tables. It measures distance in the relationship graph, so a shorter path can still be less useful as a business route.

#### Ranked by class and score

Class means path quality tier. Score totals weighted evidence used within that tier. The caption describes the ordering method, not a guarantee that the first row matches a documented business process.

### Path quality

#### Business flow

`Business flow` marks a class-3 path that follows a coherent document route, such as Master → Transaction → Origin → Document Line → Party. Document IDs remain continuous across the hops. This is the algorithm's highest-confidence signal that the path follows the natural business route.

#### Curated

`curated` marks a pinned canonical example selected by the app team. The team verified it against the dataset and documented business flows. It is editorial knowledge, not algorithm output, so a curated path can appear beside an algorithm-ranked row.

#### Reason chips

Each reason chip names one piece of evidence behind the path's class or score, with positive chips pointing to document structure, named joins, business keys, curated tables, or rare relations and caution chips flagging generic lookups, common relations, weak semantic signals, plumbing detours, or a same-table path. Paths that avoid generic references avoid that penalty. The current map expresses the generic-reference case as `passes through a generic lookup`, and the pinned canonical example is represented by the separate `curated` badge.

| Code | Current chip text | Plain-language meaning |
| --- | --- | --- |
| `business-flow-pattern` | follows a document flow | The tables follow a recognizable business document sequence. |
| `document-id-continuity` | document IDs stay continuous across hops | Each hop keeps the document identity connected. |
| `named-reference-joins` | named reference joins (no anonymous RecId) | The joins use named references instead of an anonymous record ID. |
| `business-key-joins` | business-key path | The path uses a meaningful business key. |
| `generic-lookup-intermediate` | passes through a generic lookup | A broad lookup table sits between the selected tables. |
| `curated-tables` | passes curated tables | The path crosses tables marked as useful in the dataset. |
| `rare-relations` | uses rare relation fields | The path uses less common relation fields. |
| `common-relations` | uses common relation fields | The path uses widely shared relation fields. |
| `weak-semantic-signal` | weak semantic signal | The table names provide limited evidence of a meaningful link. |
| `plumbing-detour` | contains a plumbing detour | The path takes an indirect technical route. |
| `same-table` | same table on both ends | The selected source and target are the same table. |

### Notes

#### Search space sampled, showing N of M+

`Search space sampled: showing N of many more possible paths` means the search explored a limited sample of possible paths. The displayed rows are the best paths found in that sample, not an exhaustive list.

#### X is not in the dataset

`X is not in the dataset` means the named table was not found in the 5,587-table dataset. Check spelling and capitalization before searching again.

#### Canonical path exists at N hops

`A canonical path for this pair exists at N hops` means a verified canonical chain is available, but it exceeds the selected hop limit. Increase max hops to include it.

#### Known canonical path

A `Known canonical path` is a verified chain pinned from the fixture set for this table pair. It is shown as curated knowledge and is not ranked by the search algorithm. Semantically required legs may rank outside the top results by design when they route through shared hubs such as `TaxGroupHeading`. If an expected leg is missing from the ranked rows, check the pinned `Known canonical path` entries for the pair.
