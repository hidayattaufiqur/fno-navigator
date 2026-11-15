import { writable } from 'svelte/store'

/** @typedef {[string, string, string]} FkEdge  [childTable, parentField, childField] */
/** @typedef {Record<string, FkEdge[]>} FkForwardMap */

// ── Module-level cache (survives navigation) ───────────────────────────────

/** @type {FkForwardMap | null} */
let forwardMap = null

/** @type {Record<string, [string, string, string][]>}  child → [[parentTable, parentField, childField], ...] */
let reverseMap = {}

// ── Reactive load state ────────────────────────────────────────────────────

export const fkLoadState = writable(/** @type {'idle'|'loading'|'ready'|'error'} */ ('idle'))
export const fkLoadError = writable('')

// ── Loader ─────────────────────────────────────────────────────────────────

export async function loadFkMap() {
  if (forwardMap) {
    fkLoadState.set('ready')
    return
  }
  fkLoadState.set('loading')
  try {
    const res = await fetch('/data/fk-map.json')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    forwardMap = await res.json()
    buildReverseMap()
    fkLoadState.set('ready')
  } catch (err) {
    fkLoadError.set(err instanceof Error ? err.message : String(err))
    fkLoadState.set('error')
  }
}

function buildReverseMap() {
  reverseMap = {}
  fieldsByChild.clear()
  for (const [parentTable, children] of Object.entries(forwardMap)) {
    for (const [childTable, parentField, childField] of children) {
      if (!reverseMap[childTable]) reverseMap[childTable] = []
      reverseMap[childTable].push([parentTable, parentField, childField])
      let fs = fieldsByChild.get(childTable)
      if (!fs) fieldsByChild.set(childTable, (fs = new Set()))
      fs.add(childField)
    }
  }
}

// ── Data accessors (only valid after load) ─────────────────────────────────

/**
 * Returns the raw forward map (for BFS pathfinding in /find).
 * @returns {FkForwardMap | null}
 */
export function getForwardMap() { return forwardMap }

/**
 * Returns the raw reverse map (for BFS pathfinding in /find).
 * @returns {Record<string, [string, string, string][]>}
 */
export function getReverseMap() { return reverseMap }
export function getAllFkTableNames() {
  if (!forwardMap) return []
  const names = new Set(Object.keys(forwardMap))
  for (const table of Object.keys(reverseMap)) names.add(table)
  return [...names].sort()
}

// ── Conditional / polymorphic FK discrimination (D4) ───────────────────────
// A join field is only conditional when the SAME table also carries its
// discriminator. Bare field names are not enough: RefRecId is a real typed FK
// on 152 tables and only polymorphic on the 217 that also have RefTableId;
// TransRecId is typed on 42 and polymorphic on 30. Badging by name alone
// would mislabel legitimate joins.
//
// Discriminator presence is read from the FK map itself — a field only
// appears there when it is an FK — so this never invents a discriminator.
// A discriminator with no FK of its own is a false negative (no badge), which
// is the safe direction.
const DISCRIMINATORS = {
  AccountRelation: {
    field: 'AccountCode',
    badge: 'conditional FK — AccountRelation is only customer-specific when AccountCode = Table; Group/All rows match other parties',
  },
  TransRecId: {
    field: 'TransTableId',
    badge: 'polymorphic — TransRecId is only unique together with TransTableId',
  },
  TransTableId: {
    field: 'TransRecId',
    badge: 'conditional FK — TransTableId names the table TransRecId points into',
  },
  SpecRecId: {
    field: 'SpecTableId',
    badge: 'polymorphic — SpecRecId is only unique with SpecTableId and SpecCompany',
  },
  SpecTableId: {
    field: 'SpecRecId',
    badge: 'polymorphic — SpecTableId names the table SpecRecId points into',
  },
  RefRecId: {
    field: 'RefTableId',
    badge: 'polymorphic — RefRecId is only unique with RefTableId and company',
  },
  RefTableId: {
    field: 'RefRecId',
    badge: 'polymorphic — RefTableId names the table RefRecId points into',
  },
  dataAreaId: {
    field: null,
    badge: 'legal-entity cross-reference (company), not a record FK',
  },
}

/** child table -> FK field names it carries, per the map */
const fieldsByChild = new Map()

function fieldsOf(table) {
  return fieldsByChild.get(table) ?? new Set()
}

/**
 * Badge for a schema edge whose join needs a discriminator, else null.
 * @param {string} childTable  the table that carries the FK field
 * @param {string} childField
 * @returns {string | null}
 */
export function conditionalFkBadge(childTable, childField) {
  const rule = DISCRIMINATORS[childField]
  if (!rule) return null
  if (rule.field && !fieldsOf(childTable).has(rule.field)) return null
  return rule.badge
}

/**
 * Returns schema FK edges for `tableName`, optionally filtered to a
 * set of known tables (to avoid overwhelming graphs with 400+ neighbors).
 *
 * Each edge matches the RelationGraph / Stage.relations shape:
 *   { from, to, fields: ["ChildTable.childField → ParentTable.parentField"], source: 'schema' }
 *
 * @param {string} tableName
 * @param {Set<string>} [knownTables]  If provided, only include neighbors in this set
 * @param {number} [limit]             Max edges to return (default 24)
 * @returns {{ from: string; to: string; fields: string[]; source: 'schema' }[]}
 */
export function getSchemaEdgesForTable(tableName, knownTables, limit = 24) {
  if (!forwardMap) return []

  /** @type {{ from: string; to: string; fields: string[]; source: 'schema' }[]} */
  const edges = []

  // Outgoing: tableName is the child → it has FK fields pointing to parents
  for (const [parentTable, parentField, childField] of reverseMap[tableName] ?? []) {
    if (parentTable === tableName) continue // skip self-references
    if (knownTables && !knownTables.has(parentTable)) continue
    edges.push({
      from: tableName,
      to: parentTable,
      fields: [`${tableName}.${childField} → ${parentTable}.${parentField}`],
      source: 'schema',
      badge: conditionalFkBadge(tableName, childField),
    })
    if (edges.length >= limit) return edges
  }

  // Incoming: tableName is the parent → other tables have FK fields pointing to it
  for (const [childTable, parentField, childField] of forwardMap[tableName] ?? []) {
    if (childTable === tableName) continue // skip self-references
    if (knownTables && !knownTables.has(childTable)) continue
    edges.push({
      from: childTable,
      to: tableName,
      fields: [`${childTable}.${childField} → ${tableName}.${parentField}`],
      source: 'schema',
      badge: conditionalFkBadge(childTable, childField),
    })
    if (edges.length >= limit) return edges
  }

  return edges
}

/**
 * Returns all FK connections between any two tables in `tableSet`
 * (for auto-enriching a stage that lists multiple tables).
 *
 * @param {string[]} tables
 * @returns {{ from: string; to: string; fields: string[]; source: 'schema' }[]}
 */
export function getFkEdgesBetween(tables) {
  if (!forwardMap) return []
  const tableSet = new Set(tables)
  /** @type {{ from: string; to: string; fields: string[]; source: 'schema' }[]} */
  const edges = []
  for (const tableName of tables) {
    for (const [parentTable, parentField, childField] of reverseMap[tableName] ?? []) {
      if (parentTable === tableName) continue // skip self-references
      if (tableSet.has(parentTable)) {
        edges.push({
          from: tableName,
          to: parentTable,
          fields: [`${tableName}.${childField} → ${parentTable}.${parentField}`],
          source: 'schema',
          badge: conditionalFkBadge(tableName, childField),
        })
      }
    }
  }
  return edges
}
