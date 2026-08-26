# FnO Navigator

A static SvelteKit app for navigating Dynamics 365 Finance & Operations (D365FO) business processes, tracing table relationships, and exploring technical customisations.

Overview
--------
FnO Navigator provides a fast reference that helps answer questions such as which tables are involved in a process, how a purchase order flows through the system, and where a customisation plugs into the process. The app is a static site that maps process flows, exposes a searchable table reference, and includes a Table Path Finder that computes relationships between tables.

Problem
-------
D365FO is a deep, interconnected ERP. When joining a project or debugging an unfamiliar module, it's time-consuming to answer high-level questions using only the AOT or sprawling documentation. FnO Navigator surfaces those answers without opening Visual Studio or digging through internal wikis.

Role
----
Solo author: problem definition, data modelling, UI design, and implementation.

Solution & Features
-------------------
- Process Flows: grouped by D365FO module (AP, AR, Inventory, etc.) with stages and linked tables.
- Table Reference: searchable list of key tables with descriptions, fields, and relationships.
- Table Path Finder: finds paths between two tables through the data model.

Stack
-----
- Framework: SvelteKit (static adapter)
- Build tool: Vite
- Data: Static TypeScript data files (data-as-code)
  - Table relations dataset: included as static/data/fk-map.json + map-manifest.json, reproducibly generated from https://github.com/ameyer505/MicrosoftDynamicsTableAssociations (see "Dataset provenance & regeneration")

Key decisions
-------------
- Static site for zero-server cost and fast loads. Offline capability is planned but not yet implemented.
- Data-as-code (TypeScript) for type safety and ease of extension.

Status
------
Live and in active use. The site is deployed at https://fno.hidayattaufiqur.dev and the source code is available at https://github.com/hidayattaufiqur/fno-navigator.

What's inside
-------------
- `src/routes/` - SvelteKit pages: the process-flow overview (`/`), the searchable table reference (`/tables`, `/tables/[name]`), the guided Table Path Finder (`/find`), and per-module flow pages (`/flow/[flowId]`).
- `src/lib/` - shared components, pathfinding logic, and the flow/table metadata kept as TypeScript data files (data-as-code).
- `static/data/fk-map.json` - the table-relationship dataset that powers the Table Path Finder (see NOTICE.md and "Dataset provenance & regeneration" below for provenance, licensing, and how to regenerate it).
- `static/data/map-manifest.json` - provenance manifest for fk-map.json: source dataset commit SHA/content hash, generator version, counts (tables, edges, drops, composite expansions), and a deterministic fingerprint. `npm run verify:map` recomputes the fingerprint and asserts it matches the committed map.

Local development
-----------------
Prerequisites: Node.js and npm (or your preferred package manager).

Install and run locally:

```sh
npm install
npm run dev
```

Build and preview:

```sh
npm run build
npm run preview
```

Deployment
----------
The app is built as a static site (SvelteKit adapter-static) and can be deployed to any static hosting provider (Netlify, GitHub Pages, static web server, etc.).

Repository hygiene & security notes
---------------------------------
- This repository's .gitignore excludes node_modules, build outputs, and local environment files. Do not commit .env or other secret files.
- Do not commit storage-state.json, Playwright auth/state files, or any files containing tokens.
- If you need to purge sensitive data from history, use a specialized tool such as git-filter-repo or BFG (this is a destructive operation, so contact the repo owner before proceeding).

Source & Data Attribution
------------------------
This README and the project's case study content were adapted from the companion case study on the author's portfolio site (hidayattaufiqur.dev).

The table relationship dataset used by the Table Path Finder is included as `static/data/fk-map.json`. It is generated from the public Alex Meyer (ameyer505) DynamicsTableAssociations dataset (`tablefieldassociations.json`, 39,380 entries), which derives from HTML ERD files originally published by Microsoft. The shipped map is a mechanical, lossless restructure of that public source:

- Every single-field relation is emitted as-is (32,313 relations).
- Composite/multi-field specs (e.g. `"dataAreaId, TaxGroup"`, 7,042 relations) are expanded into one edge per constituent field pair (11,920 expansion edges): each pair is itself a valid join. Marker-only specs (`Pky?`/`Fky?`, 25 relations) carry no usable field pair and are dropped; 475 duplicate triples are deduped. Every drop and expansion is counted in `static/data/map-manifest.json`.
- The resulting map holds 5,588 tables and 44,202 directed edges. The parent-keyed schema is unchanged: `{parentTable: [[childTable, parentField, childField], ...]}`.

Dataset provenance & regeneration
---------------------------------
`tools/generate-map.mjs` rebuilds `static/data/fk-map.json` + `static/data/map-manifest.json` from the public dataset, deterministically (same input -> byte-identical outputs, in any environment). The manifest records the source dataset commit SHA + content hash, the generator version, generation timestamp (dataset commit date), transform counts, and a git-tagged fingerprint that `npm run verify:map` rechecks against the committed files.

```sh
npm run generate:map   # regenerate static/data/fk-map.json + map-manifest.json
npm run verify:map     # read-back verification: fingerprint + counts + dataset version
```

Set `FNO_DATASET_DIR` to point at a checkout of https://github.com/ameyer505/MicrosoftDynamicsTableAssociations when it is not at the default location. The dataset is the ONLY data source: no other metadata (including licensed D365FO standard-source material) feeds this repo. Known gaps (e.g. tables absent from the public dataset) are closed by patching the public dataset in its own repository, never by adding local metadata here.

Primary sources:

- Microsoft: ax-2012-doc-tools - source table data (HTML ERD files in the Module-Erd directory). https://github.com/Microsoft/ax-2012-doc-tools
- Alex Meyer: MicrosoftDynamicsTableAssociations - published table relationship data (tables.json, tablefieldassociations.json) derived from Microsoft's ERD information. His conversion approach and tooling served as inspiration. https://github.com/ameyer505/MicrosoftDynamicsTableAssociations

Both upstream projects are licensed under the MIT License. The data in `static/data/fk-map.json` is included in this repository under the MIT License with attribution to the upstream sources above. When redistributing or adapting the dataset, keep this attribution and the original license notices.
