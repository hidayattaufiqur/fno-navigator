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

License:
The upstream repositories referenced above are MIT licensed. The derived
dataset in this repository is provided under the MIT License with attribution
to the upstream sources. If you reuse or redistribute the dataset, include the
above attribution and the MIT license text.
