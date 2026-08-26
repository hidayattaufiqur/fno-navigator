# fk-map regeneration audit — reproducible public-only pipeline

Card: t_8c94da06 (Pathfinder pipeline: reproducible fk-map generator + provenance manifest)
Date: 2026-08-17
Generator: `tools/generate-map.mjs` v1.0.0
Source dataset: MicrosoftDynamicsTableAssociations @ `433cc8dadb65b3efbc1ca5822bf334139307cc40`
  (`tablefieldassociations.json`, 39,380 entries, sha256 e5f47034c4f9c668ac610af0c27a9fc7dbe68d901db88412199ccf285ab7f2b1)
Fingerprint: `431c8ba78d05301024a8d0a77b167e00636d659969c7497c046bbf3a770be7b4`
Manifest: `static/data/map-manifest.json` (ships alongside the map)

## 1. What was built

- `tools/generate-map.mjs` — checked-in, dependency-free Node generator. Rebuilds
  `static/data/fk-map.json` + `static/data/map-manifest.json` from the PUBLIC
  dataset only (license boundary honored: no mirror/Learn data feeds this repo).
- Manifest write + read-back verification: `node tools/generate-map.mjs --verify`
  recomputes table/edge counts, the fingerprint, and the dataset content hash
  from the committed files (all 5 checks pass).
- npm scripts: `npm run generate:map`, `npm run verify:map`.
- README + NOTICE rewritten to describe the public-only provenance and
  regeneration workflow.

## 2. Transform rules (encoded in the generator)

| # | Rule |
|---|------|
| 1 | Schema unchanged: parent-keyed dict -> array of `[childTable, parentField, childField]` |
| 2 | Single-field relations emitted as-is, in dataset encounter order (reproduces the historical map's key and edge ordering exactly) |
| 3 | Composite specs (multi-field FKs like `dataAreaId, TaxGroup`) split on `,`, trim, drop `Pky?/Fky?/Pky/Fky` markers, pair surviving fields positionally; ONE edge per constituent pair |
| 4 | Marker-only specs (no usable field survives) dropped, counted: 25. Unequal parsed lengths: 0 |
| 5 | Exact-duplicate triples deduped globally (first occurrence wins), counted: 475 |
| 6 | Self-references kept (714 edges), as in the source and the historical map |

## 3. Headline numbers

| Metric | Before (committed 1a575bd) | After (regenerated) | Delta |
|---|---|---|---|
| Tables (parent keys) | 5,561 | 5,588 | +27 |
| Edges | 37,443 | 44,202 | +6,759 (0 lost) |
| Composite relations expanded | n/a (quarantined) | 7,042 -> 11,920 expansion edges | +6,759 net-new |
| Dropped (marker-only / unequal / unparseable) | n/a | 25 / 0 / 0 | -25 source relations |
| Duplicate edges deduped | 169 | 475 | -306 |
| Orphan tables (zero edges) | 0 | 0 | — |
| Connected components (undirected) | n/a | 48 | — |
| Self edges | 498 | 714 | +216 |

Notes:
- The regenerated map is a strict SUPERSET of the committed one: every edge in
  the old map exists in the new map (0 edgesOnlyInOld), because the old map's
  mirror/Learn-resolved entries used the same positional parser, so the raw
  spec pairs coincide with the resolution tuples for the exact-set-matched
  class. 14 within-key order variations exist (resolved entries whose
  resolution emitted pairs in a different order than the raw spec parse;
  14/37,443 shared edges).
- 27 tables return as map keys: CompanyImage, DocuField, HcmCourseAgendaTmp,
  HierarchyLinkTable, LanguageTxt, LvPayOrderSubAmount, MyLegalEntities,
  PBALanguageTxt, PBAParameters, PBARuleCodeCompiled, PdsDefaultOrderItems,
  ProjJournalStatusHistory, RetailConcessionSorting, RetailConnTable*,
  RetailInventItemFamily, RetailListingCount, SalesPurchJournalLine_IN,
  SysImport* (4), TSTimesheetEntryTotalsPart, TmpAotImport, TmpSysLabel.
  They disappeared from the committed map because every one of their relations
  was a quarantined composite spec; the expansion restores them.

## 4. Diff summary vs the committed map

- New tables: the 27 above (all recovered from composite-expansion).
- New edges: 6,759, all from composite expansion (11,920 emitted, 31 collided
  with existing clean edges and 444 with other expansions, deduped).
  Largest clusters visible in the new edges:
  - CompanyInfo gained 14 edges (BankAccountTable Bank/AccountID pairs,
    BankCentralBankPurpose, WorkCalendarTable, CompanyImage polymorphic refs).
  - BankAccountTable gained 6 (CompanyInfo x2, CustPaymManFeeLines).
  - TaxItemGroupHeading gained composite edges e.g.
    `ProcCategoryItemTaxGroup.TaxItemGroupDataAreaId -> TaxItemGroupHeading.dataAreaId`
    and `ProcCategoryItemTaxGroup.TaxItemGroup -> TaxItemGroupHeading.TaxItemGroup`.
- Nothing disappeared (superset).

## 5. Suspect-class overlap (aggregate, license-safe)

The committed map was previously enriched by a private verification pipeline
(37,443 edges = 32,313 raw + 5,130 metadata-resolved). The regenerated map
drops NONE of that: the raw-spec positional parsing the pipeline used for its
exact-set matches is the same rule this generator encodes, so all 5,130 appear
again as expansion edges.

Of the 44,202 edges in the regenerated map, 3,199 trace back to source entries
the verification pipeline still marks SUSPECT (aggregate counts only; the
per-entry reasons live in the private companion project):

| Spike D2 reason class | Edges in regenerated map |
|---|---|
| not confirmable via docs (tables undocumented on MS Learn: PBA/COS/Retail/Aif/...) | 2,123 |
| no relation between pair in D365FO metadata mirror | 650 |
| mirror relation exists but field set differs | 216 |
| mirror metadata contradicts | 166 |
| docs contradict | 44 |

These are the honest cost of the license boundary: the public dataset states
these pairs, so they are emitted as stated. The counts in this section describe
our internal verification process only; no Licensed Application/mirror data or
content is reproduced. Entries the pipeline proved wrong
(mirror/docs contradict classes, 210 edges) are candidates for the patch card
(t_5f9e4f6a) to correct/remove at the dataset level. No ghost relations were
invented: every emitted edge traces to a literal public-dataset entry.

## 6. Tax case baseline (pre-patch)

- `TaxItemGroupHeading` is a map key with 300+ child edges, including
  `SalesLine.TaxItemGroup -> TaxItemGroupHeading.TaxItemGroup` and
  `SalesLine.DeliveryTaxItemGroup_BR -> TaxItemGroupHeading.TaxItemGroup`.
- `TaxItemGroupData` is NOT a map key and appears nowhere as an edge endpoint:
  the public dataset has 0 entries naming that table (the 10 string hits are
  field names like `TaxItemGroupDataAreaId`). Its relations cannot be derived
  from public data; they arrive via the dataset patch card.
- Walkability of `SalesLine > TaxItemGroupHeading > TaxItemGroupData > TaxTable`:
  NOT walkable (fails at TaxItemGroupData; also `TaxItemGroupHeading--TaxTable`
  and `TaxGroupHeading--TaxTable` have no edges). This is the documented
  pre-patch baseline the sibling card must flip.

## 7. Determinism + verification evidence

- `node tools/generate-map.mjs --out-dir /tmp/gen-a` vs `--out-dir /tmp/gen-b`:
  `diff -r` reports BYTE-IDENTICAL (map + manifest), plus a built-in in-process
  double-build determinism check passes. `generatedAt` is derived from the
  dataset git commit date (no wall clock), so outputs are stable across runs
  and environments.
- `node tools/generate-map.mjs --verify` on the committed files: 5/5 checks
  pass (parse, table count, edge count, fingerprint recompute, dataset hash).
- The commit is tagged with the fingerprint (`map-fp-431c8ba78d05`) — the
  tag name carries the digest so a future CI gate can assert tag == manifest.

## 8. Consumer test results against the regenerated map

| Test | Result | Detail |
|---|---|---|
| tests/validate-fixtures.mjs | PASS | 21/21 fixtures, 17/17 mustSurface chains exist |
| tests/assert-fixtures.mjs | PASS | 21/21, ranking surfacing + class expectations + named asserts intact |
| tests/golden-test.mjs | FAIL (13 mismatches, 11 pairs) | ranking drift only: same path universe, reordered / better alternatives |
| tests/harness.mjs | loads | stub build + pathfinder run fine |

Golden-test drift is expected and correct: new edges (e.g. 14 new CompanyInfo
edges) create cheaper/stronger paths. Example with evidence:
`Currency->CompanyInfo` rank 2 is now
`Currency>BankAccountTrans>BankAccountTable>CompanyInfo` (score 9, class 2),
displacing `Currency>BankAccountTrans>LogisticsAddressCountryRegion>CompanyInfo`
(score 6, class 1) — the former only became possible because the expansion
emitted `CompanyInfo.Bank -> BankAccountTable.AccountID` etc. Full diff
captured in this card's run (13 rows, see completion metadata for the file).
Re-baselining `tests/golden-results.json` (and any fixture touch-ups) is the
downstream re-baseline card's job: this card deliberately did NOT touch
scoring, fixtures, or the golden lockfile.

## 9. Handoff facts for downstream cards (t_5f9e4f6a)

- datasetShaBefore/After (for the patch card): before = 433cc8d, after = the
  patch-commit SHA the sibling card records.
- tablesBefore 5,561 / tablesAfter 5,588; edgesBefore 37,443 / edgesAfter 44,202.
- dropped = 25 marker-only (0 unequal, 0 unparseable) + 475 duplicate edges;
  expanded = 7,042 composite relations -> 11,920 expansion edges.
- Remaining gaps to attack via dataset patches: TaxItemGroupData (absent),
  TaxGroupHeading--TaxTable (absent), the 3,199 SUSPECT-derived edges listed in
  section 5 (210 of them directly contradicted by ground truth).