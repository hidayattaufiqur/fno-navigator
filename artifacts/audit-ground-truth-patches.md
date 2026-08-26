# Audit: ground-truth patches applied to public dataset + map regenerated (t_5f9e4f6a)

Date: 2026-08-17
Worker: software-engineer
Card: t_5f9e4f6a (substrate-fix step)
Parents: t_8c94da06 (generator + manifest pipeline), t_03c43002 (mirror-verified patch manifest)

## Datasets and repos touched

| Repo | Commit before | Commit after |
|---|---|---|
| MicrosoftDynamicsTableAssociations (public dataset) | 433cc8dadb65b3efbc1ca5822bf334139307cc40 | af2a7c3df2569c9a97aeed79c4d94610938bf1ba |
| fno-interactor (map) | ec6b838 (fp 431c8ba78d05) | 37b2e48 (fp 342774f9933f, tag map-fp-342774f9933f) |

Dataset intermediate commits (two-phase application, architect recommendation):
- 04485a9 phase 1: 15 tax adds + 77 add_corrected + 10 promote_verified (39,380 -> 39,395 entries)
- af2a7c3 phase 2: 317 removes (39,395 -> 39,078 entries)

## Phase application (all entries mirror-traced in manifest, applied verbatim)

Pre-flight (scripts/analyze-patch-manifest.mjs): 0 missing targets, 0 phantom adds, 0 phase overlaps, dataset keys unique.

- Phase 1 (commit 04485a9): +15 tax adds (TaxOnItem/TaxGroupHeading/TaxTrans/TaxRegistration/TaxTable edges), 77 add_corrected in-place replaces, 10 promote_verified in-place replaces.
- Phase 2 (commit af2a7c3): 317 removes - class log:
  - 267 noRelation (both tables present in mirror pack, no declared relation)
  - 50 phantomField (field does not exist on the real table in the D365FO mirror)
  - All 317 removed entries had a surfaced edge in the OLD map (311 distinct parent/child pairs), so every removal is a real map change, not a no-op.
- 1,347 deferred (missingTable: pack lacks core platform tables like Currency, UnitOfMeasure, LogisticsAddress*) - recorded, OUT OF SCOPE this round.

## Map diff: old (ec6b838) vs new (regenerated)

| Metric | Before | After | Delta |
|---|---|---|---|
| Tables (parent-keyed) | 5,588 | 5,587 | -1 |
| Edges | 44,202 | 43,584 | -618 |
| Total referenced tables | 5,633 | 5,632 | -1 |
| Connected components | 48 | 48 | 0 |
| Self edges | 713 | 713 | 0 |
| Orphan tables | 0 | 0 | 0 |

Breakdown of edge deltas:
- +86 edges added (15 tax adds plus corrected/promoted field sets)
- -704 edges removed (317 remove entries, many of which were composite-key entries expanding to multiple edge pairs)

### Tables
- Added: none
- Lost: LanguageTxt (its relations PaymTerm/LanguageTxt etc. were classified noRelation; the table now has zero surviving edges in the public dataset)

### Removed edges - sample (verified mirror-grounds, class noRelation/phantomField)
- PaymTerm.RecId -> LanguageTxt.TxtRecId (noRelation)
- PaymTerm.TableId -> LanguageTxt.TxtTableId (noRelation)
- CustInterest.RecId -> LanguageTxt.TxtRecId (noRelation)
- CustInterest.TableId -> LanguageTxt.TxtTableId (noRelation)
- PurchTable.dataAreaId -> DocuRef.RefCompanyId (noRelation)
- PurchTable.TableId -> DocuRef.RefTableId (noRelation)
- PurchTable.RecId -> DocuRef.RefRecId (noRelation)
- PurchTable.RecId -> PrintMgmtDocInstance.ReferencedRecId (phantomField)
- CustTable.dataAreaId -> DocuRef (noRelation)
- 704 total, full list reconstructable from git diff on fno-interactor 1eec116 vs ec6b838.

## Tax-case walkability (REVISED ground truth from t_03c43002)

TaxItemGroupData is a GHOST table (no AxTable in the 12,974-file mirror, 0 relations, absent from alexmeyer tables.json). The corrected pre-posting chain is:

  SalesLine > TaxItemGroupHeading > TaxOnItem > TaxTable

Verified on the regenerated map with the edgeExists pattern (tests/validate-fixtures.mjs):
- SalesLine -- TaxItemGroupHeading: OK (e.g. SalesLine.TaxItemGroup -> TaxItemGroupHeading.TaxItemGroup)
- TaxItemGroupHeading -- TaxOnItem: OK (TaxItemGroupHeading.TaxItemGroup -> TaxOnItem.TaxItemGroup)
- TaxOnItem -- TaxTable: OK (TaxOnItem.TaxCode -> TaxTable.TaxCode)

Result:
- taxOnItemWalkable: true
- taxItemGroupDataAbsent: true (NOT added to map - stays absent per ghost rule)

## Suspect resolution (moment of truth for the 7,067-suspect class)

Origin: 7,067 SUSPECT "malformed field spec" entries in the public dataset (forensics from VERIFICATION_REPORT.md, all verbatim source entries). Architect card classified 1,768 remaining suspects into a root-cause taxonomy and built the 419-entry patch:

- Resolved by this card: 419 patch entries applied (15 tax adds + 77 add_corrected + 10 promote_verified + 317 removes)
- Deferred (recorded in manifest): 1,347 missingTable - pack lacks core platform tables; needs fuller sync or Learn docs pass
- Remainder (19 ok, 8 markerOnly): verified fine as-is or auto-dropped by the generator; 0 direction flips.

Note: the 419 addressed entries are the mirror-grounded subset. The full 7,067 population is not entirely resolvable from the current mirror pack alone (deferred 1,347).

## Fixture sanity (tests/validate-fixtures.mjs against regenerated map)

- PASS 21/21 fixtures, 17 mustSurface paths checked. Exit 0.
- fixturesBroken: [] - zero fixture paths rotted. LanguageTxt loss did not affect any fixture.

## Determinism (acceptance gate)

- Phase-1 regen: 2 separate process runs -> byte-identical (diff -r), fp 1c098c9a0f06
- Phase-2 regen: 2 separate process runs -> byte-identical (diff -r), fp 342774f9933f
- tools/generate-map.mjs --verify on committed static/data: 5/5 checks pass.

## Remaining gaps (for downstream fixture + re-baseline cards)

1. 1,347 missingTable relations deferred (Currency, UnitOfMeasure, LogisticsAddress*...). Needs fuller metadata sync or Learn-docs verification pass.
2. 8 markerOnly entries: kept in dataset (dataset records them) but dropped by generator (no usable field name) - no map impact.
3. Ranking drift: new map changes cheapest-path topology (net -618 edges). Golden-test re-baseline is the downstream card's job; this card did not touch rankers.
4. Fixture card (sibling) should add the corrected tax-case fixture SalesLine > TaxItemGroupHeading > TaxOnItem > TaxTable (TaxItemGroupData variant must NOT be authored - ghost).

## License boundary

Nothing mirror-derived landed in the public repo. Only the applied dataset edits (public-shaped facts, each mirror-traced with source section) changed tablefieldassociations.json; the map is regenerated purely from that public dataset by the checked-in generator. The aggregate counts in this document describe our internal verification process only; no Licensed Application/mirror data or content is reproduced. Files changed:
- MicrosoftDynamicsTableAssociations/tablefieldassociations.json (2 commits)
- fno-interactor/static/data/fk-map.json + map-manifest.json (2 commits)
- fno-interactor/scripts/{analyze,apply,audit-map-diff}-patch-manifest.mjs (tooling, 1 commit)