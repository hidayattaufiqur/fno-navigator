/**
 * v2 semantic scoring for the Table Path Finder ("most unique" ranking).
 *
 * Self-contained on purpose: this module has NO imports and depends only on
 * its arguments, so the identical weights and curated lists can be ported
 * verbatim to the FnO MCP server (fno-dev-copilot-spike, `trace_relation_path`)
 * or any other consumer. If you change a weight, a list, or a rule here, port
 * the same change there.
 *
 * Model (user-approved 2026-08-17, grill t_3bf36e2e Q1-Q15; v1 2026-08-14):
 * a path's ranking is decided by a STAGED lexicographic comparator (Q3):
 *   1. qualityClass desc   (0-3, see qualityClass below)
 *   2. semantic score rounded to 2 decimals desc (display keeps 6dp)
 *   3. -hops (fewer hops first)
 *   4. diversity desc      (post-ranking tiebreak only, never in the score)
 *   5. stable path key asc (table sequence)
 * The semantic score itself is the sum of per-edge weights (v1 terms, with
 * the documented bonus ONCE per path) plus a per-edge specificity term
 * (bucketed edge-use counts, Q7-Q9). All weights and buckets are integers,
 * so scores are exact integers in both JS and Python — no float parity risk.
 *
 * qualityClass (Q1+Q2) — the primary separator:
 *   class 3: "coherent business flow": the role sequence of the path's tables
 *     (Master/Transaction/Origin/DocumentLine/Party from name stems, plus a
 *     role ladder) is a non-decreasing document-flow with at least one core
 *     document table, document-identifier continuity (InventTransId/SalesId/
 *     PurchId/Voucher/CustAccount families) across >= 2 consecutive edges,
 *     and zero plumbing or generic intermediates.
 *   class 2: at least one business-key or named-RecId join, no plumbing.
 *   class 1: valid but weak. Any generic intermediate caps the class at 1.
 *   class 0: any plumbing edge (system-key join without Rule 1 waiver) or any
 *     Tmp-star / Dimension-star / derived intermediate.
 *   Acceptance (locked): the flagship story path
 *     InventTable>InventTrans>InventTransOrigin>SalesLine>CustTable is class
 *     3, and the current noise path
 *     InventTable>VendPackingSlipTrans>VendPackingSlipJour>VendTable>CustTable
 *     is class <= 2.
 *
 * Source of truth for fields: the `via` triples in static/data/fk-map.json
 * ([child, parentField, childField]) and the forward/reverse maps in
 * src/lib/stores/fkMap.js.
 *
 * Each directed edge is { from, fromField, to, toField } in traversal
 * direction: `from` is the table the path is leaving, `to` is the table being
 * stepped into, and the join is `from.fromField = to.toField`.
 *
 * Per-edge weights (v1, unchanged):
 *   -3  plumbing: either join field is a system field (RecId, DataAreaId,
 *       Partition, TableId, RefTableId, DefaultDimension, LedgerDimension,
 *       Worker, LegalEntity, Party, or any *RecId ref) OR either endpoint is
 *       a pure plumbing table (Tmp* buffers, Dimension* ledger-dimension
 *       infrastructure). Rule 1 waiver: a join is NOT plumbing when exactly
 *       one side is a system key (RecId/DataAreaId/Partition) and the other
 *       field NAME equals (or clearly names) the target table — a named
 *       RecId reference such as InventTrans.InventTransOrigin →
 *       InventTransOrigin.RecId. Anonymous joins (both sides system keys)
 *       and Tmp tables stay −3.
 *   -1  generic reference: the stepped-into table is a generic lookup
 *       (currency, payment terms, units, address/country, tax setup, number
 *       sequences, language, data area). Curated from degree signal + D365FO
 *       knowledge; see GENERIC_TABLES below.
 *   -2  hub: stepped-into table has > 300 distinct FK neighbours.
 *   -1  hub: stepped-into table has > 100 distinct FK neighbours. Rule 2
 *       waiver (Q4): the hub penalty is skipped when the edge carries a
 *       business key (a business-meaningful join through a hub, e.g.
 *       SalesLine.CustAccount → CustTable.AccountNum, is not punished for
 *       the hub's size).
 *   +1  documented: stepped-into table has a curated tableDef entry
 *       (inverts the old tableQuality documented bonus). Applied at most
 *       ONCE per path (Q8: documented bonus once per path, not per edge).
 *   +2  business key: the join field on the NON-hub side (the endpoint with
 *       the lower degree; both sides on a tie) is a real business key:
 *       field name ends in Id / Num / Code (excluding RecId / DataAreaId /
 *       Partition / TableId system fields and the generic `Code` lookup
 *       field), or matches BUSINESS_KEY_FIELDS. Rule 1 extension: a named
 *       reference field (one that NAMES the entity it joins to, e.g.
 *       InventTrans.InventTransOrigin → InventTransOrigin.RecId) is a
 *       business key of that reference and earns the same +2.
 *
 * Specificity (Q7-Q9, secondary term): every edge adds its bucket
 *   uses >1000 → 0, 101-1000 → 1, 11-100 → 2, ≤10 → 3 (absent = 3, rare)
 * where uses = edge-use count of the (childField, parentTable) pair from
 * static/data/fk-map.json. The SHIPPED artifact is INVERTED: common
 * overrides only (count > 10), generated by tests/gen-edge-specificity.mjs,
 * loaded by both JS and Python from the same JSON file. Absent keys are
 * bucket 3.
 */

/** System / plumbing join fields (compared case-insensitively). */
export const PLUMBING_FIELDS = new Set([
  'recid',
  'dataareaid',
  'partition',
  'tableid',
  'reftableid',
  'defaultdimension',
  'ledgerdimension',
  'worker',
  'legalentity',
  'party',
])

/**
 * Rule 1 (Q3, user-approved 2026-08-15): a join is NOT plumbing when exactly
 * one side is a system key (RecId/DataAreaId/Partition) and the other field
 * NAME equals (or clearly names) the target table — a "named RecId reference"
 * (e.g. InventTrans.InventTransOrigin → InventTransOrigin.RecId). Anonymous
 * joins (both sides system keys) and Tmp tables stay −3.
 */

/** System keys that can anchor a named reference (Rule 1 scope). */
const SYSTEM_KEYS = new Set(['recid', 'dataareaid', 'partition'])

/** Suffixes a reference field may carry after the target table name. */
const NAMED_REF_SUFFIXES = ['recid', 'refrecid', 'id', 'dataareaid']

/**
 * Localization / derived-table extensions a table name may carry after the
 * field name (compound allowed, e.g. TaxWithholdComponentGroup →
 * TaxWithholdComponentGroupTable_IN).
 */
const NAMED_TABLE_EXTENSIONS = ['_in', '_br', '_cn', '_ru', '_lt', '_psn', 'table']

/** @param {string} field */
export function isSystemKeyField(field) {
  return SYSTEM_KEYS.has(field.toLowerCase())
}

/**
 * Does `field` name `table`? True on exact match, when the field is the
 * table's key reference (table + RecId/RefRecId/Id/DataAreaId), or when the
 * table is a localized/derived variant of the field name (field + _IN/_BR/
 * _CN/_RU/_LT/_PSN/Table, compound extensions allowed).
 * @param {string} field
 * @param {string} table
 * @returns {boolean}
 */
export function fieldNamesTable(field, table) {
  const f = field.toLowerCase()
  let t = table.toLowerCase()
  if (f === t) return true
  for (const s of NAMED_REF_SUFFIXES) {
    if (f === t + s) return true
  }
  let changed = true
  while (changed) {
    changed = false
    for (const s of NAMED_TABLE_EXTENSIONS) {
      if (t.length > s.length && t.endsWith(s)) {
        t = t.slice(0, -s.length)
        changed = true
        break
      }
    }
  }
  return f === t
}

/**
 * Rule 1 (Q3): named RecId/DataAreaId/Partition reference. True when exactly
 * one join field is a system key and the other field's name equals (or
 * clearly names) the system-key side's table.
 * @param {{ from: string; fromField: string; to: string; toField: string }} edge
 * @returns {boolean}
 */
export function isNamedSystemKeyReference(edge) {
  const fromSys = isSystemKeyField(edge.fromField)
  const toSys = isSystemKeyField(edge.toField)
  if (fromSys === toSys) return false // both or neither — anonymous
  if (fromSys) return fieldNamesTable(edge.toField, edge.from)
  return fieldNamesTable(edge.fromField, edge.to)
}

/**
 * Pure plumbing tables: Tmp* temp/print/analysis buffers (D365FO names them
 * Tmp*, *Tmp, or *Tmp* — every 'Tmp' occurrence in the dataset is a transient
 * buffer, so a substring match is safe), Dimension* ledger-dimension
 * infrastructure (DimensionAttributeValue, DimensionAttributeValueCombination,
 * DimensionAttributeValueSet, ...), and derived/aggregation data tables
 * (statistics buffers, OLAP/BI tables, snapshots — non-master tables that
 * exist to serve reporting, not business flows).
 */
export const PLUMBING_TABLE_PREFIXES = ['Dimension']

const DERIVED_TABLE_PATTERN = /Statistics|Totaling|Snapshot|BIAnalysis|Printout|Buffer|WorkTable|Parm|ForProcessing/

/**
 * @param {string} table
 *
 * Guarded because this is reached from the legacy DFS with a table name that can
 * be undefined: on browser back-navigation into /find the restored edge state has
 * a step whose table is missing, `roleOf`/`isPlumbingTable` throw on `.toLowerCase`
 * / `.startsWith`, the Svelte component dies mid-render and the page comes back
 * blank. A missing name is not plumbing; it is unscoreable, so return false and
 * let the caller skip it.
 */
export function isPlumbingTable(table) {
  if (!table) return false
  if (table.startsWith('Tmp') || table.includes('Tmp')) return true
  if (DERIVED_TABLE_PATTERN.test(table)) return true
  return PLUMBING_TABLE_PREFIXES.some((prefix) => table.startsWith(prefix))
}

/**
 * Generic reference tables (curated from the degree signal + D365FO
 * knowledge). These are cross-module lookup masters: joining through them
 * says nothing about the business relationship being traced.
 */
export const GENERIC_TABLES = new Set([
  'Currency',
  'PaymTerm',
  'PaymDay',
  'PaymCalendar',
  'PaymCalendarCriteriaRule',
  'CustPaymModeTable',
  'CashDisc',
  'MarkupGroup',
  'MarkupTable',
  'UnitOfMeasure',
  'UnitOfMeasureTranslation',
  'LogisticsAddressCountryRegion',
  'LogisticsAddressState',
  'LogisticsAddressCounty',
  'LogisticsAddressZipCode',
  'LogisticsPostalAddress',
  'LogisticsLocation',
  'LanguageTable',
  'TaxTable',
  'TaxGroupHeading',
  'TaxItemGroupHeading',
  'NumberSequenceTable',
  'NumberSequenceReference',
  'NumberSequenceScope',
  'DataArea',
])

/**
 * Business-key fields that do not match the Id/Num/Code suffix heuristic but
 * are real account/transaction keys in D365FO.
 */
export const BUSINESS_KEY_FIELDS = new Set([
  'CustAccount',
  'VendAccount',
  'InvoiceAccount',
  'Voucher',
])

/** Degree thresholds for the hub penalty (strictly greater). */
export const HUB_HEAVY_DEGREE = 300
export const HUB_LIGHT_DEGREE = 100

export const WEIGHTS = {
  plumbing: -3,
  generic: -1,
  hubHeavy: -2,
  hubLight: -1,
  documented: 1,
  businessKey: 2,
}

// ── v2: qualityClass (Q1+Q2) ────────────────────────────────────────────────

/**
 * Party tables: a document flow terminates at an account party. Master tables
 * (InventTable, SalesTable, ...) are covered by the 'Table' stem rule.
 */
export const PARTY_TABLES = new Set(['CustTable', 'VendTable', 'DirPartyTable', 'DirPerson'])

/**
 * Document-identifier field families (Q1): continuity across consecutive
 * edges of a business flow is measured on these. Startswith/suffix matches
 * are allowed (e.g. InventTransId, SubledgerVoucher, InvoicedSalesId).
 */
const DOC_ID_STEMS = ['inventtransid', 'salesid', 'purchid', 'voucher', 'custaccount']

/**
 * Role ladder for document flows: the path's table roles must be
 * non-decreasing on this ladder to count as a flow (Master → Transaction →
 * Origin → DocumentLine → Party, skipping allowed). Unknown roles break the
 * pattern. `hint` values add 1 so unassignable tables sort below masters.
 */
export const ROLE_ORDER = { master: 0, trans: 1, origin: 2, line: 3, party: 4 }

/**
 * Role of a table name stem in a document flow (Q1). Returns one of
 * 'master' | 'trans' | 'origin' | 'line' | 'party', or null when the name
 * carries no role signal (journal headers, lookup tables, Tmp buffers...).
 * @param {string} table
 * @returns {'master'|'trans'|'origin'|'line'|'party'|null}
 */
export function roleOf(table) {
  // undefined guard: see isPlumbingTable. A nameless table has no role.
  if (!table) return null
  if (PARTY_TABLES.has(table)) return 'party'
  const t = table.toLowerCase()
  if (t.endsWith('origin')) return 'origin'
  if (t.endsWith('line')) return 'line'
  if (t.endsWith('trans')) return 'trans'
  if (t.endsWith('table')) return 'master'
  return null
}

/**
 * Class-aware DFS hint (Q12b): how likely a branch through this table is on a
 * coherent document flow, used as the tiebreak (after the edge score) in
 * nexts ordering. Flows START at document cores (Transaction/DocumentLine),
 * then step Origin → Line → Party, so trans/line rank highest, then origin,
 * party, then master, then unassignable tables. Edge score stays the primary
 * key — the hint only breaks score ties, preserving the v1 reach profile
 * that keeps the story branch inside the sweep budgets.
 * @param {string} table
 * @returns {number}
 */
export function classHintFor(table) {
  const role = roleOf(table)
  if (role === 'trans' || role === 'line') return 5
  if (role === 'origin') return 4
  if (role === 'party') return 3
  if (role === 'master') return 1
  return 0
}

/**
 * Does the edge carry a document identifier on either join field?
 * @param {{ fromField: string; toField: string }} edge
 * @returns {boolean}
 */
export function edgeHasDocId(edge) {
  const f = edge.fromField.toLowerCase()
  const t = edge.toField.toLowerCase()
  return DOC_ID_STEMS.some((s) => f === s || f.endsWith(s) || t === s || t.endsWith(s))
}

/**
 * Longest run of consecutive edges that carry a document identifier (Q1:
 * continuity across >= 2 consecutive edges).
 * @param {{ from: string; fromField: string; to: string; toField: string }[]} edges
 * @returns {number}
 */
export function docIdRun(edges) {
  let best = 0
  let cur = 0
  for (const edge of edges) {
    cur = edgeHasDocId(edge) ? cur + 1 : 0
    if (cur > best) best = cur
  }
  return best
}

/**
 * Document-flow role pattern (Q1): every table has a role, the role ladder
 * is non-decreasing (skips allowed: Master → Trans → Line → Party is a flow),
 * and at least one core document table (Transaction/Origin/DocumentLine) is
 * present — a plain chain of masters is not a flow.
 * @param {(string|null)[]} roles
 * @returns {boolean}
 */
function isDocumentFlow(roles) {
  if (roles.some((r) => r === null)) return false
  const ranks = roles.map((r) => ROLE_ORDER[r])
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] < ranks[i - 1]) return false
  }
  return roles.some((r) => r === 'trans' || r === 'origin' || r === 'line')
}

/**
 * qualityClass (Q1+Q2): 0 = plumbing, 1 = weak, 2 = business-key path,
 * 3 = coherent business-flow path. Any generic intermediate caps at 1; any
 * plumbing edge or Tmp/Dimension/derived intermediate forces 0.
 * @param {{ from: string; fromField: string; to: string; toField: string }[]} edges
 * @param {(table: string) => number} getDegree
 * @param {Set<string>} documented
 * @returns {0|1|2|3}
 */
export function qualityClass(edges, getDegree, documented) {
  if (edges.length === 0) return 0
  const tables = [edges[0].from, ...edges.map((e) => e.to)]
  const intermediates = tables.slice(1, -1)
  const scored = edges.map((edge) => scoreEdge(edge, getDegree, documented))
  if (scored.some((s) => s.plumbing)) return 0
  if (intermediates.some(isPlumbingTable)) return 0
  const genericIntermediate = intermediates.some(isGenericTable)
  if (!genericIntermediate) {
    if (docIdRun(edges) >= 2 && isDocumentFlow(tables.map(roleOf))) return 3
  }
  if (scored.some((s) => s.businessKey) && !genericIntermediate) return 2
  return 1
}

// ── v2: specificity (Q7-Q9) ─────────────────────────────────────────────────

/**
 * Bucket for a raw edge-use count (Q7: >1000 → 0, 101-1000 → 1, 11-100 → 2,
 * ≤10 → 3). Integers only — deterministic across languages.
 * @param {number} count
 * @returns {0|1|2|3}
 */
export function bucketFromCount(count) {
  if (count > 1000) return 0
  if (count > 100) return 1
  if (count > 10) return 2
  return 3
}

/**
 * Specificity bucket of one traversal edge under the INVERTED artifact
 * (static/data/edge-specificity.json, absent = bucket 3). The map is ~98%
 * mirrored, so both candidate anchors (`fromField@to` and `toField@from`)
 * encode the same join; the more common reading (smaller bucket) wins.
 * @param {{ from: string; fromField: string; to: string; toField: string }} edge
 * @param {Record<string, number>} specMap  key `${childField}@${parent}` → bucket
 * @returns {0|1|2|3}
 */
export function specificityBucketForEdge(edge, specMap) {
  const a = specMap[`${edge.fromField}@${edge.to}`]
  const b = specMap[`${edge.toField}@${edge.from}`]
  if (a === undefined && b === undefined) return 3
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

/** @param {string} field */
export function isPlumbingField(field) {
  if (PLUMBING_FIELDS.has(field.toLowerCase())) return true
  // Any RecId-style surrogate reference (RefRecId, SourceRecId, LegalEntityRecId, ...)
  return /recid$/i.test(field) || /dataareaid$/i.test(field)
}

/** @param {string} table */
export function isGenericTable(table) {
  return GENERIC_TABLES.has(table)
}

/**
 * @param {string} field
 * @returns {boolean} true if the field looks like a real business key
 */
export function isBusinessKeyField(field) {
  if (isPlumbingField(field)) return false
  if (field.toLowerCase() === 'code') return false // generic code lookup
  if (BUSINESS_KEY_FIELDS.has(field)) return true
  return /(Id|Num|Code)$/.test(field)
}

/**
 * Hub penalty for a single table's degree.
 * @param {number} degree
 * @returns {number} negative penalty (0 when not a hub)
 */
export function hubPenalty(degree) {
  if (degree > HUB_HEAVY_DEGREE) return WEIGHTS.hubHeavy
  if (degree > HUB_LIGHT_DEGREE) return WEIGHTS.hubLight
  return 0
}

/**
 * Score one directed edge. Higher = more meaningful.
 *
 * @param {{ from: string; fromField: string; to: string; toField: string }} edge
 * @param {(table: string) => number} getDegree  FK-neighbour count per table
 * @param {Set<string>} documented  table names with a curated tableDef entry
 * @returns {{ score: number; plumbing: boolean; generic: boolean; businessKey: boolean; documented: boolean; namedRef: boolean }}
 */
export function scoreEdge(edge, getDegree, documented) {
  let score = 0

  // Plumbing: system join fields or pure plumbing tables on either side.
  // Rule 1 (Q3): a join is NOT plumbing when exactly one side is a system key
  // (RecId/DataAreaId/Partition) and the other field names the target table
  // (named RecId reference, e.g. InventTrans.InventTransOrigin →
  // InventTransOrigin.RecId). Anonymous joins (both sides system keys) and
  // Tmp/plumbing tables stay −3.
  const tablePlumbing = isPlumbingTable(edge.from) || isPlumbingTable(edge.to)
  const fieldPlumbing = isPlumbingField(edge.fromField) || isPlumbingField(edge.toField)
  const namedRef = isNamedSystemKeyReference(edge)
  const plumbing = tablePlumbing || (fieldPlumbing && !namedRef)
  if (plumbing) score += WEIGHTS.plumbing

  // Generic reference: the stepped-into table is a cross-module lookup.
  const generic = isGenericTable(edge.to)
  if (generic) score += WEIGHTS.generic

  // Business key on the NON-hub side: the endpoint with the lower degree
  // (both endpoints are candidates on a tie). Never awarded when either
  // endpoint is a generic reference table — a lookup's own key (CashDiscCode,
  // PaymTermId, CurrencyCode) is not a business-flow key, so plumbing/generic
  // links through lookups can never outscore a real business key. Rule 1
  // extension: a named reference field (one that NAMES the entity it joins
  // to, e.g. InventTrans.InventTransOrigin → InventTransOrigin.RecId) is a
  // business key of that reference — it identifies a business entity by name,
  // exactly like an Id/Num/Code field, so it earns the same +2.
  const degFrom = getDegree(edge.from)
  const degTo = getDegree(edge.to)
  let businessKey = false
  if (!isGenericTable(edge.from) && !isGenericTable(edge.to)) {
    const fields =
      degFrom === degTo
        ? [edge.fromField, edge.toField]
        : degFrom < degTo
          ? [edge.fromField]
          : [edge.toField]
    businessKey = fields.some((f) => isBusinessKeyField(f))
  }
  if (!plumbing && namedRef) businessKey = true
  if (businessKey) score += WEIGHTS.businessKey

  // Hub penalty on the stepped-into table only (the source's hub-ness is a
  // constant across all paths of one query, and intermediates are not
  // double-counted the way a both-ends rule would). Rule 2 (Q4): waived when
  // the edge carries a business key — a business-meaningful join through a
  // hub (e.g. SalesLine.CustAccount → CustTable.AccountNum) should not be
  // punished for the hub's size.
  if (!businessKey) score += hubPenalty(degTo)

  // Documented tables are curated and business-meaningful.
  const isDoc = documented.has(edge.to)
  if (isDoc) score += WEIGHTS.documented

  return { score, plumbing, generic, businessKey, documented: isDoc, namedRef }
}

// ── v2: reason codes (Q5, deterministic strings) ────────────────────────────

const REASON_CLASS = ['plumbing-detour', 'weak-semantic-signal', 'business-key-joins', 'business-flow-pattern']

/**
 * Deterministic reason codes for a path (Q5). Fixed vocabulary, emitted in a
 * canonical order so the strings are stable across languages and runs:
 * class reason, then detail reasons (document-id continuity, named-RecId
 * joins, generic intermediate, curated tables, specificity tier).
 * @param {{ from: string; fromField: string; to: string; toField: string }[]} edges
 * @param {(table: string) => number} getDegree
 * @param {Set<string>} documented
 * @param {Record<string, number> | null} specMap
 * @param {0|1|2|3} cls
 * @returns {string[]}
 */
export function reasonCodes(edges, getDegree, documented, specMap, cls) {
  const reasons = [REASON_CLASS[cls]]
  if (cls === 3) reasons.push('document-id-continuity')
  if (edges.some((e) => isNamedSystemKeyReference(e))) reasons.push('named-reference-joins')
  if (cls === 1) {
    const tables = [edges[0].from, ...edges.map((e) => e.to)]
    if (tables.slice(1, -1).some(isGenericTable)) reasons.push('generic-lookup-intermediate')
  }
  if (edges.some((e) => documented.has(e.to))) reasons.push('curated-tables')
  const n = edges.length
  if (n > 0) {
    let sum = 0
    for (const edge of edges) {
      sum += specMap === null ? 3 : specificityBucketForEdge(edge, specMap)
    }
    if (4 * sum >= 9 * n) reasons.push('rare-relations')
    else if (4 * sum <= 7 * n) reasons.push('common-relations')
  }
  return reasons
}

// ── v2: staged comparator (Q3) ──────────────────────────────────────────────

/**
 * Round a score to 2 decimals for ranking (display keeps 6dp). Scores are
 * integers by construction (all weights and buckets are integers, diversity
 * is never folded in), so this is exact in both languages.
 * @param {number} x
 * @returns {number}
 */
export function round2(x) {
  return Math.round(x * 100) / 100
}

/**
 * The v2 lexicographic comparator (Q3):
 *   qualityClass desc → score(2dp) desc → hops asc → diversity desc → key asc.
 * `useDiversity` is false while the candidate pool is being built (diversity
 * is only known on the final sliced set) — the stable key then breaks ties.
 * @param {{ qualityClass: number; score: number; hops: number; diversity?: number; key: string }} a
 * @param {{ qualityClass: number; score: number; hops: number; diversity?: number; key: string }} b
 * @param {boolean} useDiversity
 * @returns {number} negative if a < b, positive if a > b, 0 if equal
 */
export function compareV2(a, b, useDiversity = true) {
  if (a.qualityClass !== b.qualityClass) return b.qualityClass - a.qualityClass
  const sa = round2(a.score)
  const sb = round2(b.score)
  if (sa !== sb) return sb - sa
  if (a.hops !== b.hops) return a.hops - b.hops
  if (useDiversity && a.diversity !== undefined && b.diversity !== undefined && a.diversity !== b.diversity) {
    return b.diversity - a.diversity
  }
  if (a.key < b.key) return -1
  if (a.key > b.key) return 1
  return 0
}

/**
 * Score a full path (list of edges) and produce its breakdown.
 *
 * Semantic score (Q8) = v1 per-edge terms (documented bonus applied at most
 * ONCE per path) + per-edge specificity buckets. Every term is an integer,
 * so the score is an exact integer. Also returns the path's qualityClass and
 * deterministic reason codes (Q5) for the parity contract.
 *
 * @param {{ from: string; fromField: string; to: string; toField: string }[]} edges
 * @param {(table: string) => number} getDegree
 * @param {Set<string>} documented
 * @param {Record<string, number> | null} [specMap]  specificity artifact (null → all edges bucket 3)
 * @returns {{ score: number; breakdown: { plumbing: number; generic: number }; qualityClass: 0|1|2|3; reasonCodes: string[] }}
 */
export function scorePath(edges, getDegree, documented, specMap = null) {
  let score = 0
  const breakdown = { plumbing: 0, generic: 0 }
  let docEdges = 0
  for (const edge of edges) {
    const { score: s, plumbing, generic, documented: isDoc } = scoreEdge(edge, getDegree, documented)
    score += s
    if (plumbing) breakdown.plumbing += 1
    if (generic) breakdown.generic += 1
    if (isDoc) docEdges += 1
  }
  // Documented bonus ONCE per path (Q8): the per-edge +1 above must count
  // once total, so cancel all but the first documented edge's bonus.
  if (docEdges > 1) score -= WEIGHTS.documented * (docEdges - 1)
  // Specificity (Q7-Q9): secondary per-edge term, absent map = bucket 3.
  if (specMap === null) {
    score += 3 * edges.length
  } else {
    for (const edge of edges) score += specificityBucketForEdge(edge, specMap)
  }
  const cls = qualityClass(edges, getDegree, documented)
  const reasons = reasonCodes(edges, getDegree, documented, specMap, cls)
  return { score, breakdown, qualityClass: cls, reasonCodes: reasons }
}
