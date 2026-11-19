// Copy deck for the /find page tooltips and legend.
//
// Source of truth: find-legend-copy.md (secretary dossier, card t_3c4c2d69).
// This module mirrors that file VERBATIM — copy changes only via the dossier.
// tests/check-legend-copy.mjs asserts the two never drift.
//
// Rewritten 2026-11-19 for the decluttered page (commit d375d03): the four-button
// tier filter and the per-hop A/B/C/D chips are gone, replaced by one join tag on
// non-joinable rows (scan / conditional / convention), plus the derived
// header→line relation class. 'weakest-hop' was deleted with the badge it named.

// ── General tooltip one-liners (12 words or fewer each) ──────────────────────

export const TOOLTIP_COPY = {
  'canonical': 'Arbitrated chain for this pair — verified by a D365FO domain owner.',
  'inferred': 'Algorithm-ranked fallback: no arbitrated canonical chain for this pair.',
  'header-line': "TableGroup says header and line, joined on the header's own key.",
  'tag-scan': 'Declared FK, no index: a query may scan this table.',
  'tag-conditional': 'Join also constrains a discriminator field, so no Copy X++.',
  'tag-convention': 'No FK declared: convention only, so no Copy X++.',
  'bridge-cartesian': 'Both neighbours join the same field, so rows pair up freely.',
  'bridge-setup': 'Broad setup table used as a bridge; rows may multiply.',
  'copy-xpp': 'Copies this chain as a select-join; every hop is an indexed FK.',
  'rank-story': 'Ranks by documented stage order from the six core flows.',
  'rank-evidence': 'Ranks on AOT metadata alone: join tier, table group, deprecation.',
  'shortest-hops': 'Fewest hops in the relation graph, regardless of business meaning.',
  'truncated-note': 'More ranked paths exist; these are the highest-ranked ones.',
  'missing-note': 'The named table is not in the loaded graph.',
  'canonical-hint': 'A pinned chain for this pair needs more hops than selected.',
  'known-canonical': 'Chain pinned from the validated fixture set for this pair.',
}

// ── Legend groups (Path ranking / Join quality / Notes) ──────────────────────
// Section bodies keep the dossier's backticks; the page renders them as <code>.

export const LEGEND_GROUPS = [
  {
    heading: 'Path ranking',
    sections: [
      {
        title: 'Story vs Evidence',
        body: [
          '`Story` is the default and ranks on documented stage progression: the ordered stages of the six core flows in `flows.ts`, so a chain that advances through one process outranks one that walks backwards or jumps between flows. `Evidence` drops that signal and ranks on AOT metadata alone. Both profiles begin with the same two hard rules — a header→line single hop first, then any declared one-hop relation — and only then diverge into stage progression versus tier. Both read the same exhaustive enumeration, so switching profiles reorders the list without changing which paths are in it.',
        ],
      },
      {
        title: 'Shortest: N hops',
        body: [
          '`Shortest: N hops` in the results header is the fewest hops any returned chain uses between the two tables, counted in the relation graph rather than in foreign keys alone, so tier C and tier D hops count. It measures distance, not usefulness: the shortest chain can still be the wrong business route.',
        ],
      },
      {
        title: 'Canonical and inferred',
        body: [
          'A row marked `canonical` is the chain arbitrated by a D365FO domain owner for this table pair, pinned from `canonical-fixtures.json` and moved to the top of the list whatever the algorithm rank says. Its tooltip is that chain\'s `why` note, which states the posting or document step the hop sequence follows. Every other row is marked `inferred` unless its single hop is a header→line relation, in which case it shows that pill instead: a row carries one badge, and the order is canonical, then header→line, then inferred.',
          'Pins are bidirectional. All 37 arbitrated pairs are stored in both directions, 74 entries in all, so `SalesLine → SalesTable` returns the same spine as `SalesTable → SalesLine`; a relation is the same fact whichever way you trace it. A pin also survives the tier gate: the chain is rebuilt straight from the graph when the search filter would have excluded it, because the pin is an arbitrated answer and the filter only scores evidence. `Known canonical path` is the same knowledge outside the ranking. That block holds the must-surface chains of the validated fixtures for this pair, shown whether or not the ranking reaches them, because an asserted chain can rank below the top N and still be the right answer. Rows already in the list are not repeated there; they carry the `canonical` pill instead. If a chain is longer than the current hop limit the page says so and names the hop count: raise max hops and it can be enumerated and pinned.',
        ],
      },
    ],
  },
  {
    heading: 'Join quality',
    sections: [
      {
        title: 'Join tags',
        body: [
          'Rows no longer carry a tier chip per hop. A hop\'s tier still gates the search — the default is B, declared foreign keys, because A-only hid real relations and D brought back the cartesian bridges — but the only tier fact that changes what you do with a row is whether the join is paste-safe, and that is one tag on the row. A tag means the row has no `Copy X++` button; no tag means it does.',
          '`scan` — foreign key declared, no index: a real relation, a query may need to scan the table',
          '`conditional` — the join also constrains a discriminator field, so an unqualified join can match the wrong rows',
          '`convention` — no foreign key declared for this relation: the names agree, nothing enforces them',
        ],
      },
      {
        title: 'Relation classes',
        body: [
          '`header→line` is a relation class, not a grade, and it outranks every tier signal in both ranking profiles. It fires on a single hop when Microsoft\'s `TableGroup` says one table is the document header (`WorksheetHeader`, `TransactionHeader`) and the other its line (`WorksheetLine`, `TransactionLine`) and the join uses the header\'s own key: the same field on both sides, `RecId`, or a `*RecId` surrogate. On the shipped artifact it fires on 719 of the 58,310 hops, 1.2%, and 54% of those are tier C or D — which is exactly why tier cannot be trusted to surface them. It is derived from metadata with no curation, so it is a statement about what the tables are, not about which chain is the business answer.',
        ],
      },
      {
        title: 'Bridge warnings',
        body: [
          'A `⚠ table` flag means the path enters that table in a way that can multiply rows. The cartesian case is both neighbours joining the table on the same field, as `SalesTable > Currency > CustTrans` does on `CurrencyCode`: every sales order then pairs with every customer transaction sharing a currency. The quieter setup-bridge case is a broad Group, Reference or Parameter table used as a bridge. Read either flag as an instruction to check the where conditions, not as a rejected path.',
        ],
      },
      {
        title: 'Copy X++',
        body: [
          '`Copy X++` appears only on all-tier-A chains, where every hop is an indexed foreign key and the database enforces the join. The snippet is a `select` with one `join` per hop, oriented in traversal direction, and it is paste-safe as written. A chain with any B, C or D hop gets a single join tag instead — `scan`, `conditional` or `convention` — because the generated join would not be equivalent to the path shown.',
        ],
      },
    ],
  },
  {
    heading: 'Notes',
    sections: [
      {
        title: 'Top N shown',
        body: [
          '`Top N shown` is a display fact, not a warning. Within the scoped subgraph the search enumerates every simple path up to the hop limit and returns the first 50 of that ranking, so the list is a slice of a complete ordering rather than a sample. Lower the hop limit to shorten it. Both endpoints are always allowed, so a table outside the scoped flows still resolves as a destination.',
        ],
      },
      {
        title: 'Table not in the graph',
        body: [
          '`X is not in the graph` means the name was not found in the graph this build loaded. On the AOT artifact that graph has 27,582 nodes, so a missing name is usually a typo or a table newer than the artifact. Check spelling and capitalization first: table names are case-sensitive.',
        ],
      },
      {
        title: 'Which graph is in use',
        body: [
          'Every claim above is about the AOT artifact, and whether this build loaded it is the page\'s `graphAvailable` flag. With the artifact present, each hop is a declared D365FO relation graded A–D, ranking is verified for the six core flows — sales, procurement, production, inventory, project, finance — and the tier gate, join tags, relation class and bridge detection all apply. Tables outside those flows still resolve, but the order is best-effort. Without the artifact, as in a public clone with no licensed environment, the page runs on the public seed graph and says so: relations may be stale, and tiers, join tags, the header→line class and bridge detection do not apply.',
        ],
      },
    ],
  },
]
