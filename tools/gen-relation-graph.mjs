#!/usr/bin/env node
// Derive a typed relation graph from the d365fo-mcp AOT index.
//
// WHY THIS EXISTS
//   fk-map.json is derived from Ax2012 ERD HTML: 24% of its tables do not exist
//   in a 10.0.2645 AOT (measured 2026-11-18: 1,348 of 5,632 absent), it drops
//   every composite-key relation, and it carries no deprecation, cardinality or
//   relationship-type signal. The ranking engine compensated with name-suffix
//   heuristics (roleOf, isPlumbingTable) that AOT metadata states directly.
//
// TWO ARTIFACTS, ON PURPOSE (license boundary, see NOTICE.md)
//   relation-graph.local.json  full AOT-derived graph. GITIGNORED. Licensed
//                              input, never published. Enables exact local use.
//   graph-verdicts.json        verdicts about pairs only — no metadata content.
//                              Committed, publishable, upstreamable.
//
//   The public fk-map.json stays generated from public input (tools/generate-map.mjs
//   seed + graph-verdicts.json patches), so the build remains reproducible by
//   anyone without a licensed environment.
//
// USAGE
//   node tools/gen-relation-graph.mjs --index <index.sqlite3> [--out-dir static/data]
//   node tools/gen-relation-graph.mjs --index ... --verify    # coverage gate only
//
// Pure Node stdlib (node:sqlite, Node >= 22). No dependencies.

import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const argOf = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
const INDEX = argOf('--index')
const OUT_DIR = argOf('--out-dir', join(dirname(new URL(import.meta.url).pathname), '..', 'static', 'data'))
const VERIFY_ONLY = args.includes('--verify')

if (!INDEX || !existsSync(INDEX)) {
  console.error('usage: node tools/gen-relation-graph.mjs --index <index.sqlite3> [--out-dir DIR] [--verify]')
  process.exit(2)
}

const db = new DatabaseSync(INDEX, { readOnly: true })
const q = (sql, ...p) => db.prepare(sql).all(...p)

// ── 1. Table universe + the metadata the ranking needs ──────────────────────
// TableGroup/TableType/IsObsolete are AxTable properties. The index stores
// TableGroup as a property claim; TableType and IsObsolete are not indexed as
// claims (only TableGroup is — 8,915 rows measured), so they come from the XML
// via the source root the index records. Missing source = reported, not guessed.

const tableRows = q(`SELECT object_id, object_name FROM objects WHERE object_type='AxTable'`)
const tables = new Map(tableRows.map((r) => [r.object_name, r.object_id]))

const tableGroup = new Map()
for (const r of q(
  `SELECT o.object_name n, sc.claim_value_json v FROM structure_claims sc
     JOIN objects o ON o.object_id=sc.object_id
    WHERE sc.claim_type='property' AND sc.claim_name='TableGroup' AND o.object_type='AxTable'`
)) {
  try {
    tableGroup.set(r.n, JSON.parse(r.v)?.value ?? null)
  } catch {
    tableGroup.set(r.n, null)
  }
}

// Form-use count: how often a table appears as a form data source. This replaces
// the hand-curated `documentedSet` bonus with a measured signal.
const formUse = new Map()
for (const r of q(
  `SELECT json_extract(sc.claim_value_json,'$.table') t, count(*) c FROM structure_claims sc
     JOIN objects o ON o.object_id=sc.object_id
    WHERE sc.claim_type='data_source' AND o.object_type='AxForm'
    GROUP BY 1`
)) {
  if (r.t) formUse.set(r.t, r.c)
}

// ── 2. Edges ────────────────────────────────────────────────────────────────
// One row per (relation, field-pair). Composite relations keep their pairs
// together via relation_id so a consumer can re-compose the key.

const relRows = q(
  `SELECT o.object_name src, o.object_id, o.object_type, m.member_name rname, m.detail_json d
     FROM members m JOIN objects o ON o.object_id=m.object_id
    WHERE m.member_type='relation' AND o.object_type IN ('AxTable','AxTableExtension')`
)

const edges = []
const dropped = { noTarget: 0, noFieldPair: 0, unresolvedTarget: 0, caseCorrected: 0 }
const danglingTargets = new Map()
let relSeq = 0

// Relation targets are NOT always tables. Measured on the full 180-model laptop
// corpus (2026-11-18): of 4,659 unresolved target names, 4,524 are
// AxDataEntityView and 96 AxView — legitimate graph nodes that a table-typed
// lookup silently discards. Only 37 are unfindable by any type, and most of
// those are case variants (`HCMWorker` vs `HcmWorker`, `Taxtable` vs `TaxTable`,
// `ResourceVIew` vs `ResourceView`), which AOT itself tolerates.
//
// So: resolve case-insensitively across table-and-view node types, and report
// what actually cannot be resolved rather than calling it missing.
const NODE_TYPES = ['AxTable', 'AxDataEntityView', 'AxView']
const nodesByName = new Map() // lowercased name -> { name, types:Set }
for (const r of q(`SELECT object_name n, object_type t FROM objects WHERE object_type IN ('AxTable','AxDataEntityView','AxView')`)) {
  const k = String(r.n).toLowerCase()
  let e = nodesByName.get(k)
  if (!e) nodesByName.set(k, (e = { name: r.n, types: new Set() }))
  e.types.add(r.t)
}
const resolveNode = (name) => {
  if (!name) return null
  const exact = nodesByName.get(name.toLowerCase())
  if (exact) {
    if (exact.name !== name) dropped.caseCorrected++
    return exact
  }
  return null
}

for (const r of relRows) {
  let d
  try {
    d = JSON.parse(r.d)
  } catch {
    continue
  }
  const parentRaw = d.related_table
  if (!parentRaw) {
    dropped.noTarget++
    continue
  }
  const parentNode = resolveNode(parentRaw)
  if (!parentNode) {
    dropped.unresolvedTarget++
    danglingTargets.set(parentRaw, (danglingTargets.get(parentRaw) ?? 0) + 1)
    continue
  }
  const cs = d.constraints ?? []
  const fieldPairs = cs.filter((c) => c.type === 'AxTableRelationConstraintField' && c.field && c.relatedfield)
  if (fieldPairs.length === 0) {
    dropped.noFieldPair++
    continue
  }
  const relId = ++relSeq
  // An AxTableExtension declares relations ON a base table; the child is the
  // base table, not the extension object. Measured: without this, `SysUserInfo`
  // relations were attributed to a node named `SysUserInfo.Extension1` that no
  // form or FK ever references, so the edge was present but unreachable.
  const childRaw = r.object_type === 'AxTableExtension' ? r.src.replace(/\.[^.]+$/, '') : r.src
  const childNode = resolveNode(childRaw)
  if (!childNode) {
    dropped.unresolvedTarget++
    danglingTargets.set(childRaw, (danglingTargets.get(childRaw) ?? 0) + 1)
    continue
  }
  const conditional = cs.some(
    (c) => c.type === 'AxTableRelationConstraintFixed' || c.type === 'AxTableRelationConstraintRelatedFixed'
  )
  for (const c of fieldPairs) {
    edges.push({
      child: childNode.name,
      childField: c.field,
      parent: parentNode.name,
      parentField: c.relatedfield,
      childKind: childNode.types.has('AxTable') ? 'table' : childNode.types.has('AxDataEntityView') ? 'entity' : 'view',
      parentKind: parentNode.types.has('AxTable') ? 'table' : parentNode.types.has('AxDataEntityView') ? 'entity' : 'view',
      // AOT states these; the old map guessed them from field names.
      xmlType: d.xml_type || '',
      relType: d.relationship_type || '',
      card: d.cardinality || '',
      parentCard: d.related_table_cardinality || '',
      indexed: Boolean(d.index),
      composite: fieldPairs.length > 1,
      conditional,
      relId,
      fromExtension: r.object_type === 'AxTableExtension',
    })
  }
}

// ── 3. Degree (undirected, over resolvable edges) ───────────────────────────
const deg = new Map()
const bump = (t) => deg.set(t, (deg.get(t) ?? 0) + 1)
for (const e of edges) {
  bump(e.child)
  bump(e.parent)
}

// ── 4. Coverage gate ────────────────────────────────────────────────────────
// The generator refuses to claim completeness it cannot prove. Unresolvable
// targets are split into two classes that mean different things:
//
//   kernel — platform kernel tables (DataArea, UserInfo, Common, Security*,
//     Partitions, SqlDictionary…). Measured on the 180-model laptop corpus
//     (2026-11-18): 677 edges reference these 17 names, and NONE of them exists
//     as any object type in PackagesLocalDirectory. They are shipped by the
//     platform, not by a model, so no AOT model corpus will ever contain them.
//     Structurally absent, not a coverage defect.
//
//   unknown — everything else. This is the only thing that should ever fail the
//     completeness gate, because it means a model is missing from the index.
const KERNEL_TABLES = new Set([
  'DataArea',
  'UserInfo',
  'Common',
  'SecurityRole',
  'SecurityDuty',
  'SecurityPrivilege',
  'SecurityUserRole',
  'SecurityRoleAssignmentRule',
  'SecuritySegregationOfDutiesRule',
  'Partitions',
  'UtilElements',
  'UtilIdElements',
  'SqlDictionary',
  'SysConfig',
  'SysTypeIdView',
  'SysClientSessions',
  'Deployment',
  'DatabaseLog',
])
const kernelDangling = [...danglingTargets.keys()].filter((t) => KERNEL_TABLES.has(t))
const unknownDangling = [...danglingTargets.entries()].filter(([t]) => !KERNEL_TABLES.has(t))

const axTableCount = tables.size
const touched = new Set([...edges.map((e) => e.child), ...edges.map((e) => e.parent)])
const kindOf = new Map()
for (const e of edges) {
  kindOf.set(e.child, e.childKind)
  kindOf.set(e.parent, e.parentKind)
}
const coverage = {
  axTables: axTableCount,
  graphNodes: kindOf.size,
  nodesByKind: [...kindOf.values()].reduce((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {}),
  tablesTouchedByRelations: touched.size,
  tablesWithNoRelations: axTableCount - [...touched].filter((t) => tables.has(t)).length,
  edges: edges.length,
  relations: relSeq,
  compositeRelations: [...new Set(edges.filter((e) => e.composite).map((e) => e.relId))].length,
  typedForeignKeyEdges: edges.filter((e) => e.xmlType === 'AxTableRelationForeignKey').length,
  indexedEdges: edges.filter((e) => e.indexed).length,
  conditionalEdges: edges.filter((e) => e.conditional).length,
  crossKindEdges: edges.filter((e) => e.childKind !== e.parentKind).length,
  dropped,
  dangling: {
    kernelTables: kernelDangling.length,
    kernelEdges: kernelDangling.reduce((n, t) => n + (danglingTargets.get(t) ?? 0), 0),
    unknownTables: unknownDangling.length,
    unknownEdges: unknownDangling.reduce((n, [, c]) => n + c, 0),
    unknownSample: unknownDangling.sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t, c]) => `${t}:${c}`),
  },
  models: q(`SELECT model_name FROM models ORDER BY 1`).map((r) => r.model_name),
}
// Completeness is judged against what a model corpus CAN contain: kernel tables
// live in the platform, so their absence is expected, not a gap.
const complete = unknownDangling.length === 0
coverage.state = complete ? 'complete' : 'partial'

if (VERIFY_ONLY) {
  console.log(JSON.stringify(coverage, null, 2))
  const top = unknownDangling.sort((a, b) => b[1] - a[1]).slice(0, 20)
  if (top.length) console.log('top UNKNOWN dangling targets:', top.map(([k, v]) => `${k}:${v}`).join(' '))
  process.exit(complete ? 0 : 1)
}

// ── 5. Emit ─────────────────────────────────────────────────────────────────
const graph = {
  schema: 'fno-navigator/relation-graph/v1',
  provenance: {
    derivedFrom: 'D365FO AOT metadata (licensed)',
    index: INDEX,
    generation: q(`SELECT value FROM generation_meta WHERE key='generation_id'`)[0]?.value ?? null,
    note: 'LOCAL ARTIFACT — contains licensed metadata. Never commit. graph-verdicts.json is the publishable form.',
  },
  coverage,
  tables: [...tables.keys()].sort().map((n) => ({
    name: n,
    group: tableGroup.get(n) ?? null,
    degree: deg.get(n) ?? 0,
    formUse: formUse.get(n) ?? 0,
  })),
  edges,
}

// Verdict layer: what this says about the CURRENT public map, expressed as
// claims about pairs. No metadata content (no labels, no field descriptions,
// no TableGroup values on tables the public map does not already contain).
const fkPath = join(OUT_DIR, 'fk-map.json')
const verdicts = { schema: 'fno-navigator/graph-verdicts/v1', coverageState: coverage.state, verdicts: [] }
if (existsSync(fkPath)) {
  const fk = JSON.parse(readFileSync(fkPath, 'utf8'))
  const seed = new Set()
  const seedTables = new Set()
  for (const [parent, kids] of Object.entries(fk)) {
    seedTables.add(parent)
    for (const [child] of kids) {
      seedTables.add(child)
      seed.add(`${child}.${parent}`)
    }
  }
  const aot = new Set(edges.map((e) => `${e.child}.${e.parent}`))
  // Direction is NOT comparable between the two sources: the Ax2012 dataset
  // records "this table references that one" in its own orientation, AOT records
  // the declaring table's constraint. Measured 2026-11-18: directed overlap says
  // 22,646 seed pairs are "unconfirmed", undirected says 5,861 — a 4x
  // overstatement caused purely by orientation. Verdicts are therefore keyed on
  // the unordered pair; direction differences are recorded, not failed.
  const und = (a, b) => [a, b].sort().join('.')
  const aotU = new Set(edges.map((e) => und(e.child, e.parent)))
  const seedU = new Set()
  for (const p of seed) {
    const [child, parent] = p.split('.')
    seedU.add(und(child, parent))
  }
  // `absent` must mean "not in the product", not "not in this index".
  // Measured on the 17-model server corpus (12,974 tables) 1,348 seed tables
  // looked absent; on the 180-model laptop corpus the same seed loses only 818,
  // and of those 199 are Tmp buffers and 542 are names no longer declared
  // anywhere. A table absent from a PARTIAL corpus is unverified, not gone —
  // so the verdict is downgraded unless coverage is complete.
  const nodeName = (n) => nodesByName.get(String(n).toLowerCase())?.name ?? null
  for (const t of seedTables) {
    const hit = nodeName(t)
    if (hit === t) continue
    if (hit) verdicts.verdicts.push({ kind: 'table', table: t, verdict: 'case-variant', resolved: hit })
    else verdicts.verdicts.push({ kind: 'table', table: t, verdict: coverage.state === 'complete' ? 'absent' : 'unverified' })
  }
  for (const p of seedU) if (!aotU.has(p)) verdicts.verdicts.push({ kind: 'pair', pair: p, verdict: 'unconfirmed' })
  // NOT emitted: the `extra` pairs (AOT declares, seed lacks). On the laptop
  // corpus that list is 26,729 pairs — most of the real relation graph. A full
  // pair list IS the graph, so publishing it would be redistributing Microsoft's
  // relation metadata with a "verdicts" label on it. Only the COUNT ships; the
  // pairs stay in the local artifact. The committed file therefore carries what
  // is wrong with the public seed, never what the licensed graph contains.
  const extraCount = [...aotU].filter((p) => !seedU.has(p)).length
  verdicts.summary = {
    seedTables: seedTables.size,
    seedPairsDirected: seed.size,
    seedPairsUndirected: seedU.size,
    aotPairsUndirected: aotU.size,
    tablesAbsent: verdicts.verdicts.filter((v) => v.verdict === 'absent').length,
    tablesUnverified: verdicts.verdicts.filter((v) => v.verdict === 'unverified').length,
    tablesCaseVariant: verdicts.verdicts.filter((v) => v.verdict === 'case-variant').length,
    pairsUnconfirmed: verdicts.verdicts.filter((v) => v.verdict === 'unconfirmed').length,
    pairsExtraInAot: extraCount,
    confirmationRate: Number((((seedU.size - verdicts.verdicts.filter((v) => v.verdict === 'unconfirmed').length) / seedU.size) * 100).toFixed(1)),
  }
}

const graphPath = join(OUT_DIR, 'relation-graph.local.json')
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(graphPath, JSON.stringify(graph))
if (verdicts.verdicts.length) writeFileSync(join(OUT_DIR, 'graph-verdicts.json'), JSON.stringify(verdicts, null, 1))

const sha = createHash('sha256').update(JSON.stringify(graph)).digest('hex')
console.log(JSON.stringify({ ...coverage, fingerprint: sha, graphPath, verdicts: verdicts.summary ?? null }, null, 2))
