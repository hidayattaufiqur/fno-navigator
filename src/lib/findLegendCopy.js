// Copy deck for the /find page tooltips and legend.
//
// Source of truth: find-legend-copy.md (secretary dossier, card t_96e72178).
// This module mirrors that file VERBATIM — copy changes only via the dossier.
// tests/check-legend-copy.mjs asserts the two never drift.
//
// Rewritten 2026-11-19 for the tiered engine: the previous deck documented
// pathScoring.js (qualityClass, weighted score, reason chips), which no longer
// runs. REASON_TOOLTIP_COPY was deleted with it — no reason chips exist.

// ── General tooltip one-liners (12 words or fewer each) ──────────────────────

export const TOOLTIP_COPY = {
  'canonical': 'Arbitrated chain for this pair — verified by a D365FO domain owner.',
  'inferred': 'Algorithm-ranked fallback: no arbitrated canonical chain for this pair.',
  'bridge-cartesian': 'Both neighbours join the same field, so rows pair up freely.',
  'bridge-setup': 'Broad setup table used as a bridge; rows may multiply.',
  'weakest-hop': 'Weakest tier in this chain; not safe to paste as a join.',
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
          '`Story` ranks by documented stage progression: the ordered stages of the six core flows in `flows.ts`, so a chain that advances through one process outranks one that walks backwards or jumps between flows. `Evidence` drops that signal and ranks on AOT metadata alone. Both sort on the chain\'s weakest tier, then `cost`, then hop count; `Story` just puts stage progression ahead of all three. Both read the same enumeration, so switching profiles reorders the list without changing which paths are in it.',
        ],
      },
      {
        title: 'Shortest: N hops',
        body: [
          '`Shortest: N hops` is the fewest hops any returned chain uses between the two tables, counted in the relation graph rather than in foreign keys alone, so tier C and tier D hops count. It measures distance, not usefulness: the shortest chain can still be the wrong business route.',
        ],
      },
      {
        title: 'Canonical and inferred',
        body: [
          'A row marked `canonical` is the chain arbitrated by a D365FO domain owner for this table pair, pinned from `canonical-fixtures.json` and moved to the top of the list whatever the algorithm rank says. Its tooltip is that chain\'s `why` note, which states the posting or document step the hop sequence follows. Every other row is marked `inferred`: the ranking produced it and no arbitrated chain exists for the pair. Ranking signals cannot recover business intent on their own, which is why a pinned answer outranks them.',
          '`Known canonical path` is the same knowledge outside the ranking. That block holds the must-surface chains of the validated fixtures for this pair, shown whether or not the ranking reaches them, because an asserted chain can rank below the top N and still be the right answer. Rows already in the list are not repeated there; they carry the `canonical` pill instead. If a chain is longer than the current hop limit the page says so and names the hop count: raise max hops and it can be enumerated and pinned.',
        ],
      },
    ],
  },
  {
    heading: 'Join quality',
    sections: [
      {
        title: 'Tier chips A–D',
        body: [
          'Every hop carries a tier chip graded from the declared AOT relation. The chip tooltip, the Minimum join filter and the chain\'s own verdict all use the same wording, and the lowest tier in the chain decides whether the row gets `Copy X++` or `weakest hop X`.',
          'A — foreign key with an index: enforced by the database, safe to paste into X++',
          'B — foreign key declared, no index: a real relation, a query may need to scan',
          'C — conditional relation: the join also constrains a discriminator field',
          'D — convention only: no foreign key declared for this relation',
        ],
      },
      {
        title: 'Weakest hop',
        body: [
          '`weakest hop X` names the lowest tier in a chain that is not fully joinable, and it is the reason that row has no `Copy X++` button. One hop weaker than an indexed foreign key means a pasted join may scan the table, or in the conditional case may omit the discriminator and match the wrong rows.',
        ],
      },
      {
        title: 'Bridge warnings',
        body: [
          'A `⚠ table` flag means the path enters that table in a way that can multiply rows. The cartesian case is both neighbours joining the table on the same field, as `SalesTable > Currency > CustTrans` does on `CurrencyCode`: every sales order then pairs with every customer transaction sharing a currency. The quieter `setup-bridge` case is a broad Group, Reference or Parameter table used as a bridge. Read either flag as an instruction to check the where conditions, not as a rejected path.',
        ],
      },
      {
        title: 'Copy X++',
        body: [
          '`Copy X++` appears only on all-tier-A chains, where every hop is an indexed foreign key and the database enforces the join. The snippet is a `select` with one `join` per hop, oriented in traversal direction, and it is paste-safe as written. A chain with any B, C or D hop gets `weakest hop X` instead, because the generated join would not be equivalent to the path shown.',
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
          '`Top N shown` is a display fact, not a warning. Within the scoped subgraph the search enumerates every simple path up to the hop limit and returns the first N of that ranking, so the list is a slice of a complete ordering rather than a sample. Lower the hop limit or raise the minimum join to shorten it. Both endpoints are always allowed, so a table outside the scoped flows still resolves as a destination.',
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
          'Every claim above is about the AOT artifact, and whether this build loaded it is the page\'s `graphAvailable` flag. With the artifact present, each hop is a declared D365FO relation graded A–D, and ranking is verified for the six core flows — sales, procurement, production, inventory, project, finance. Tables outside them still resolve, but the order is best-effort. Without the artifact, as in a public clone with no licensed environment, the page runs on the public seed graph and says so: relations may be stale, tiers and bridge detection do not apply, and an older scorer answers instead.',
        ],
      },
    ],
  },
]
