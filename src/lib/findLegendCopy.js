// Copy deck for the /find page tooltips and legend.
//
// Source of truth: find-legend-copy.md (secretary dossier, task t_a3bcdfef).
// This module mirrors that file VERBATIM — copy changes only via the dossier.
// tests/check-legend-copy.mjs asserts the two never drift.

// ── General tooltip one-liners (12 words or fewer each) ──────────────────────

export const TOOLTIP_COPY = {
  'business-flow': 'Follows a document flow with continuous document IDs.',
  curated: 'Verified by the app team, pinned from the dataset, not algorithm-ranked.',
  'cleanest-path': 'The #1 row under class, score, and hop ranking.',
  shortest: 'This path uses the fewest verified FK hops found.',
  'shortest-hops': 'Fewest verified FK hops, independent of business meaning.',
  'ranked-by-class-score': 'Class shows quality tier. Score totals weighted evidence.',
  'reason-chips': "Each chip names evidence behind this path's rank.",
  'sampled-note': 'Best paths found in a limited search sample, not exhaustive.',
  'missing-note': 'The named table is absent from the dataset.',
  'canonical-hint': 'A verified canonical path needs more hops than selected.',
  'known-canonical': 'Verified chain pinned from documented flows, not algorithm-ranked.',
}

// ── Per-reason-code tooltip one-liners (keyed by pathScoring.js codes) ───────

export const REASON_TOOLTIP_COPY = {
  'business-flow-pattern': 'Follows a document flow.',
  'document-id-continuity': 'Document IDs stay continuous across hops.',
  'named-reference-joins': 'Named reference joins, with no anonymous record ID.',
  'business-key-joins': 'Uses a business-key path.',
  'generic-lookup-intermediate': 'Passes through a generic lookup.',
  'curated-tables': 'Passes curated tables.',
  'rare-relations': 'Uses rare relation fields.',
  'common-relations': 'Uses common relation fields.',
  'weak-semantic-signal': 'Weak semantic signal.',
  'plumbing-detour': 'Contains a plumbing detour.',
  'same-table': 'Same table on both ends.',
}

// ── Legend groups (Path ranking / Path quality / Notes) ──────────────────────
// Section bodies keep the dossier's backticks; the page renders them as <code>.

export const LEGEND_GROUPS = [
  {
    heading: 'Path ranking',
    sections: [
      {
        title: 'Cleanest path and Top-ranked path',
        body: [
          'The `cleanest path` marker identifies row #1 in the current result list. The ranking compares class first, then score, then hop count, with deterministic tie-breakers after that. It does not mean the path is shortest or universally best.',
        ],
      },
      {
        title: 'Shortest: N hops',
        body: [
          '`Shortest: N hops` counts the fewest verified foreign-key hops between the selected tables. It measures distance in the relationship graph, so a shorter path can still be less useful as a business route.',
        ],
      },
      {
        title: 'Ranked by class and score',
        body: [
          'Class means path quality tier. Score totals weighted evidence used within that tier. The caption describes the ordering method, not a guarantee that the first row matches a documented business process.',
        ],
      },
    ],
  },
  {
    heading: 'Path quality',
    sections: [
      {
        title: 'Business flow',
        body: [
          '`Business flow` marks a class-3 path that follows a coherent document route, such as Master → Transaction → Origin → Document Line → Party. Document IDs remain continuous across the hops. This is the algorithm\'s highest-confidence signal that the path follows the natural business route.',
        ],
      },
      {
        title: 'Curated',
        body: [
          '`curated` marks a pinned canonical example selected by the app team. The team verified it against the dataset and documented business flows. It is editorial knowledge, not algorithm output, so a curated path can appear beside an algorithm-ranked row.',
        ],
      },
      {
        title: 'Reason chips',
        body: [
          'Each reason chip names one piece of evidence behind the path\'s class or score, with positive chips pointing to document structure, named joins, business keys, curated tables, or rare relations and caution chips flagging generic lookups, common relations, weak semantic signals, plumbing detours, or a same-table path. Paths that avoid generic references avoid that penalty. The current map expresses the generic-reference case as `passes through a generic lookup`, and the pinned canonical example is represented by the separate `curated` badge.',
        ],
        table: [
          { code: 'business-flow-pattern', chip: 'follows a document flow', meaning: 'The tables follow a recognizable business document sequence.' },
          { code: 'document-id-continuity', chip: 'document IDs stay continuous across hops', meaning: 'Each hop keeps the document identity connected.' },
          { code: 'named-reference-joins', chip: 'named reference joins (no anonymous record ID)', meaning: 'The joins use named references instead of an anonymous record ID.' },
          { code: 'business-key-joins', chip: 'business-key path', meaning: 'The path uses a meaningful business key.' },
          { code: 'generic-lookup-intermediate', chip: 'passes through a generic lookup', meaning: 'A broad lookup table sits between the selected tables.' },
          { code: 'curated-tables', chip: 'passes curated tables', meaning: 'The path crosses tables marked as useful in the dataset.' },
          { code: 'rare-relations', chip: 'uses rare relation fields', meaning: 'The path uses less common relation fields.' },
          { code: 'common-relations', chip: 'uses common relation fields', meaning: 'The path uses widely shared relation fields.' },
          { code: 'weak-semantic-signal', chip: 'weak semantic signal', meaning: 'The table names provide limited evidence of a meaningful link.' },
          { code: 'plumbing-detour', chip: 'contains a plumbing detour', meaning: 'The path takes an indirect technical route.' },
          { code: 'same-table', chip: 'same table on both ends', meaning: 'The selected source and target are the same table.' },
        ],
      },
    ],
  },
  {
    heading: 'Notes',
    sections: [
      {
        title: 'Search space sampled, showing N of M+',
        body: [
          '`Search space sampled: showing N of many more possible paths` means the search explored a limited sample of possible paths. The displayed rows are the best paths found in that sample, not an exhaustive list.',
        ],
      },
      {
        title: 'X is not in the dataset',
        body: [
          '`X is not in the dataset` means the named table was not found in the 5,587-table dataset. Check spelling and capitalization before searching again.',
        ],
      },
      {
        title: 'Canonical path exists at N hops',
        body: [
          '`A canonical path for this pair exists at N hops` means a verified canonical chain is available, but it exceeds the selected hop limit. Increase max hops to include it.',
        ],
      },
      {
        title: 'Known canonical path',
        body: [
          'A `Known canonical path` is a verified chain pinned from the fixture set for this table pair. It is shown as curated knowledge and is not ranked by the search algorithm. Semantically required legs may rank outside the top results by design when they route through shared hubs such as `TaxGroupHeading`. If an expected leg is missing from the ranked rows, check the pinned `Known canonical path` entries for the pair.',
        ],
      },
    ],
  },
]
