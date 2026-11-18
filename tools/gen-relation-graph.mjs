#!/usr/bin/env node
// Derive a TYPED relation graph from the d365fo-mcp AOT index.
//
// WHY THIS EXISTS
//   fk-map.json derives from Ax2012 ERD HTML. Measured 2026-11-18 against a
//   180-model D365FO 10.0.2645 AOT: 805 of its 5,632 tables no longer exist,
//   2,759 of its 17,599 pairs are gone, and it carries no relationship type,
//   cardinality or index signal — so the ranking engine compensated with
//   name-suffix heuristics (roleOf, isPlumbingTable) that AOT states directly.
//
// WHAT THIS ADDS OVER v1
//   edge.tier  A|B|C|D — how strong the join actually is, per edge:
//                A  AxTableRelationForeignKey + declared index  (DB-enforced)
//                B  AxTableRelationForeignKey, no index         (real, may scan)
//                C  any relation with a Fixed/RelatedFixed constraint
//                   (join needs a discriminator predicate)
//                D  plain relation, no FK                        (convention)
//              A path's confidence is the MINIMUM tier among its hops.
//   node.type  TableType (TempDB/InMemory) — real plumbing signal
//   node.obs   table-level IsObsolete — real deprecation signal
//   node.custom  declared in the custom-main source root
//
// TWO ARTIFACTS (license boundary, see NOTICE.md)
//   relation-graph.local.json  full graph. GITIGNORED. Licensed input.
//   graph-verdicts.json        verdicts about the public seed only. Committed.
//
// USAGE
//   node tools/gen-relation-graph.mjs --index <index.sqlite3> [--out-dir DIR]
//   node tools/gen-relation-graph.mjs --index ... --verify
//
// Pure Node stdlib (node:sqlite, Node >= 22).

import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const argOf = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
const argAll = (name) => args.reduce((out, a, i) => (a === name ? [...out, args[i + 1]] : out), [])
const INDEX = argOf('--index')
const OUT_DIR = argOf('--out-dir', join(dirname(new URL(import.meta.url).pathname), '..', 'static', 'data'))
const VERIFY_ONLY = args.includes('--verify')

// Source roots let us classify custom vs standard and read TableType/IsObsolete
// from XML (the index records TableGroup as a claim but not these two).
const ROOTS = argAll('--source-root').map((s) => {
  const eq = s.indexOf('=')
  return eq > 0 ? { id: s.slice(0, eq), path: s.slice(eq + 1) } : { id: 'standard-main', path: s }
})

if (!INDEX || !existsSync(INDEX)) {
  console.error('usage: node tools/gen-relation-graph.mjs --index <index.sqlite3> [--out-dir DIR] [--verify] [--source-root id=path]')
  process.exit(2)
}

const db = new DatabaseSync(INDEX, { readOnly: true })
const q = (sql, ...p) => db.prepare(sql).all(...p)

// ── 1. Nodes ────────────────────────────────────────────────────────────────
// Relations target tables AND data entities AND views. Measured on the full
// laptop corpus: of 4,659 unresolved target names, 4,524 were AxDataEntityView
// and 96 AxView — a table-typed lookup silently discards a fifth of the graph.
const NODE_TYPES = ['AxTable', 'AxDataEntityView', 'AxView']
const nodeRows = q(
  `SELECT object_name n, object_type t, model_id FROM objects WHERE object_type IN (${NODE_TYPES.map(() => '?').join(',')})`,
  ...NODE_TYPES
)
const nodesByName = new Map() // lowercased name -> { name, types:Set, modelIDs:Set }
for (const r of nodeRows) {
  const k = String(r.n).toLowerCase()
  let e = nodesByName.get(k)
  if (!e) nodesByName.set(k, (e = { name: r.n, types: new Set(), modelIDs: new Set() }))
  e.types.add(r.t)
  e.modelIDs.add(r.model_id)
}
const kindOfNode = (e) =>
  e.types.has('AxTable') ? 'table' : e.types.has('AxDataEntityView') ? 'entity' : 'view'

// Custom vs standard: a node declared in a non-standard source root.
const modelRoot = new Map()
for (const r of q(`SELECT model_id, source_root_id FROM models`)) modelRoot.set(r.model_id, r.source_root_id)
const isCustom = (e) => [...e.modelIDs].some((m) => (modelRoot.get(m) ?? 'standard-main') !== 'standard-main')

// TableGroup (indexed) and form-use counts (indexed).
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
const formUse = new Map()
for (const r of q(
  `SELECT json_extract(sc.claim_value_json,'$.table') t, count(*) c FROM structure_claims sc
     JOIN objects o ON o.object_id=sc.object_id
    WHERE sc.claim_type='data_source' AND o.object_type='AxForm'
    GROUP BY 1`
)) {
  if (r.t) formUse.set(r.t, r.c)
}

// ── 2. TableType / IsObsolete from source XML ───────────────────────────────
// Neither is an indexed claim. Read them from the AOT file the index points at.
// Missing file = unknown (null), never guessed.
const tableType = new Map()
const obsolete = new Map()
function loadXmlFacts() {
  if (ROOTS.length === 0) return { scanned: 0, note: 'no --source-root given; TableType/IsObsolete unknown' }
  const files = q(
    `SELECT o.object_name n, f.relpath p, m.model_id FROM objects o
       JOIN files f ON f.file_id=o.file_id
       JOIN models m ON m.model_id=o.model_id
      WHERE o.object_type='AxTable'`
  )
  let scanned = 0
  for (const f of files) {
    const rootId = modelRoot.get(f.model_id) ?? 'standard-main'
    const root = ROOTS.find((r) => r.id === rootId) ?? ROOTS[0]
    const path = join(root.path, f.p)
    let xml
    try {
      xml = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    scanned++
    // Direct AxTable children only: everything before <Fields> is the table's
    // own property block, so a field's IsObsolete cannot leak in. Verified on
    // SalesTable, which has three field-level IsObsolete=Yes and a clean table.
    const head = xml.split('<Fields>')[0]
    const tt = head.match(/<TableType>([^<]*)<\/TableType>/)
    if (tt) tableType.set(f.n, tt[1])
    if (/<IsObsolete>\s*Yes\s*<\/IsObsolete>/.test(head)) obsolete.set(f.n, true)
  }
  return { scanned, note: null }
}
const xmlFacts = VERIFY_ONLY ? { scanned: 0, note: 'skipped (--verify)' } : loadXmlFacts()

// ── 3. Edges ────────────────────────────────────────────────────────────────
const relRows = q(
  `SELECT o.object_name src, o.object_type ot, m.detail_json d
     FROM members m JOIN objects o ON o.object_id=m.object_id
    WHERE m.member_type='relation' AND o.object_type IN ('AxTable','AxTableExtension')`
)

const edges = []
const dropped = { noTarget: 0, noFieldPair: 0, unresolvedTarget: 0, caseCorrected: 0 }
const danglingTargets = new Map()
let relSeq = 0

const resolveNode = (name) => {
  if (!name) return null
  const e = nodesByName.get(String(name).toLowerCase())
  if (e) {
    if (e.name !== name) dropped.caseCorrected++
    return e
  }
  // Relation targets may be extension-qualified (`LanguageTxt.Extension`,
  // `ContactPerson.ApplicationSuiteExtension`). The object they mean is the base
  // table, so retry with dotted suffixes stripped, longest first. Measured on
  // the laptop corpus: 369 unresolved targets / 869 edges are this shape.
  let base = String(name)
  while (base.includes('.')) {
    base = base.slice(0, base.lastIndexOf('.'))
    const b = nodesByName.get(base.toLowerCase())
    if (b) {
      dropped.extensionQualified = (dropped.extensionQualified ?? 0) + 1
      return b
    }
  }
  return null
}

// Tier: how strong is this hop, on evidence AOT states directly.
//   A = FK declared AND indexed  — DB-enforced join, safe to paste into X++
//   B = FK declared, not indexed — real relation, may scan
//   C = conditional (Fixed/RelatedFixed constraint) — join needs a predicate
//   D = plain relation, no FK    — metadata convention only
function tierOf(xmlType, indexed, conditional) {
  const isFk = xmlType === 'AxTableRelationForeignKey'
  if (conditional) return 'C'
  if (isFk && indexed) return 'A'
  if (isFk) return 'B'
  return 'D'
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
  // An AxTableExtension declares relations ON a base table; the child is the base
  // table, not `SysUserInfo.Extension1` — which nothing references, so the edge
  // would be present but unreachable.
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
  const tier = tierOf(d.xml_type || '', Boolean(d.index), conditional)
  for (const c of fieldPairs) {
    edges.push({
      child: childNode.name,
      childField: c.field,
      parent: parentNode.name,
      parentField: c.relatedfield,
      childKind: kindOfNode(childNode),
      parentKind: kindOfNode(parentNode),
      tier,
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

// ── 4. Degree ───────────────────────────────────────────────────────────────
const deg = new Map()
for (const e of edges) {
  deg.set(e.child, (deg.get(e.child) ?? 0) + 1)
  deg.set(e.parent, (deg.get(e.parent) ?? 0) + 1)
}

// ── 5. Coverage gate ────────────────────────────────────────────────────────
// Kernel tables ship with the platform, never with a model corpus, so their
// absence is structural, not a gap. Measured: 18 names / 676 edges.
const KERNEL_TABLES = new Set([
  'DataArea', 'UserInfo', 'Common', 'SecurityRole', 'SecurityDuty', 'SecurityPrivilege',
  'SecurityUserRole', 'SecurityRoleAssignmentRule', 'SecuritySegregationOfDutiesRule',
  'Partitions', 'UtilElements', 'UtilIdElements', 'SqlDictionary', 'SysConfig',
  'SysTypeIdView', 'SysClientSessions', 'Deployment', 'DatabaseLog',
])
const kernelDangling = [...danglingTargets.keys()].filter((t) => KERNEL_TABLES.has(t))
const unknownDangling = [...danglingTargets.entries()].filter(([t]) => !KERNEL_TABLES.has(t))

const nodeList = [...nodesByName.values()]
const touched = new Set([...edges.map((e) => e.child), ...edges.map((e) => e.parent)])
const kinds = new Map()
for (const e of edges) {
  kinds.set(e.child, e.childKind)
  kinds.set(e.parent, e.parentKind)
}
const tierCount = { A: 0, B: 0, C: 0, D: 0 }
for (const e of edges) tierCount[e.tier]++

const coverage = {
  axTables: nodeList.filter((n) => n.types.has('AxTable')).length,
  graphNodes: kinds.size,
  nodesByKind: [...kinds.values()].reduce((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {}),
  customNodes: nodeList.filter(isCustom).length,
  edges: edges.length,
  relations: relSeq,
  tierCounts: tierCount,
  compositeRelations: [...new Set(edges.filter((e) => e.composite).map((e) => e.relId))].length,
  conditionalEdges: edges.filter((e) => e.conditional).length,
  crossKindEdges: edges.filter((e) => e.childKind !== e.parentKind).length,
  xmlFacts,
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
const complete = unknownDangling.length === 0
coverage.state = complete ? 'complete' : 'partial'

if (VERIFY_ONLY) {
  console.log(JSON.stringify(coverage, null, 2))
  const top = unknownDangling.sort((a, b) => b[1] - a[1]).slice(0, 20)
  if (top.length) console.log('top UNKNOWN dangling targets:', top.map(([k, v]) => `${k}:${v}`).join(' '))
  process.exit(complete ? 0 : 1)
}

// ── 6. Emit ─────────────────────────────────────────────────────────────────
const graph = {
  schema: 'fno-navigator/relation-graph/v2',
  provenance: {
    derivedFrom: 'D365FO AOT metadata (licensed)',
    index: INDEX,
    generation: q(`SELECT value FROM generation_meta WHERE key='generation_id'`)[0]?.value ?? null,
    note: 'LOCAL ARTIFACT — contains licensed metadata. Never commit. graph-verdicts.json is the publishable form.',
  },
  coverage,
  // Nodes carry the ontology AOT states, so ranking never guesses from names.
  tables: nodeList
    .map((n) => ({
      name: n.name,
      kind: kindOfNode(n),
      group: tableGroup.get(n.name) ?? null,
      type: tableType.get(n.name) ?? null,
      obs: obsolete.get(n.name) ?? false,
      custom: isCustom(n),
      degree: deg.get(n.name) ?? 0,
      formUse: formUse.get(n.name) ?? 0,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1)),
  edges,
}

// Verdict layer: what this says about the PUBLIC SEED. Never what the licensed
// graph contains — a full pair list IS the graph, so `extra` pairs stay local.
const fkPath = join(OUT_DIR, 'fk-map.json')
const verdicts = { schema: 'fno-navigator/graph-verdicts/v1', coverageState: coverage.state, verdicts: [] }
if (existsSync(fkPath)) {
  const fk = JSON.parse(readFileSync(fkPath, 'utf8'))
  const seedU = new Set()
  const seedTables = new Set()
  for (const [parent, kids] of Object.entries(fk)) {
    seedTables.add(parent)
    for (const [child] of kids) {
      seedTables.add(child)
      seedU.add([child, parent].sort().join('.'))
    }
  }
  // Direction is not comparable: the Ax2012 dataset and AOT record opposite
  // orientations. Directed compare overstated the gap 4x (22,646 vs 5,861).
  const und = (a, b) => [a, b].sort().join('.')
  const aotU = new Set(edges.map((e) => und(e.child, e.parent)))
  const nodeName = (n) => nodesByName.get(String(n).toLowerCase())?.name ?? null
  for (const t of seedTables) {
    const hit = nodeName(t)
    if (hit === t) continue
    if (hit) verdicts.verdicts.push({ kind: 'table', table: t, verdict: 'case-variant', resolved: hit })
    else
      verdicts.verdicts.push({
        kind: 'table',
        table: t,
        verdict: coverage.state === 'complete' ? 'absent' : 'unverified',
      })
  }
  for (const p of seedU) if (!aotU.has(p)) verdicts.verdicts.push({ kind: 'pair', pair: p, verdict: 'unconfirmed' })
  verdicts.summary = {
    seedTables: seedTables.size,
    seedPairsUndirected: seedU.size,
    aotPairsUndirected: aotU.size,
    tablesAbsent: verdicts.verdicts.filter((v) => v.verdict === 'absent').length,
    tablesUnverified: verdicts.verdicts.filter((v) => v.verdict === 'unverified').length,
    tablesCaseVariant: verdicts.verdicts.filter((v) => v.verdict === 'case-variant').length,
    pairsUnconfirmed: verdicts.verdicts.filter((v) => v.verdict === 'unconfirmed').length,
    pairsExtraInAot: [...aotU].filter((p) => !seedU.has(p)).length,
    confirmationRate: Number(
      (((seedU.size - verdicts.verdicts.filter((v) => v.verdict === 'unconfirmed').length) / seedU.size) * 100).toFixed(1)
    ),
  }
}

// The verbose graph is the working artifact for local tooling, NOT a web asset.
// It must not live under static/: adapter-static copies static/ verbatim into
// build/, so anything here is publicly served. Measured: a build with the
// verbose graph in static/data shipped an extra 16 MB of redundant licensed
// metadata to the web root. It goes to a sibling dir instead.
const LOCAL_DIR = process.env.FNO_LOCAL_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.local-graph')
const graphPath = join(LOCAL_DIR, 'relation-graph.local.json')
mkdirSync(LOCAL_DIR, { recursive: true })
writeFileSync(graphPath, JSON.stringify(graph))
mkdirSync(OUT_DIR, { recursive: true })

// ── 7. Compact site artifact ────────────────────────────────────────────────
// The site needs every node and edge, so it must ship. Measured: the verbose
// form is 21 MB, a positional-array form is 5.9 MB, gzipped 0.6 MB. Arrays
// instead of objects is the whole win — column order is the schema, declared
// here and versioned, so a field can never silently shift.
//
//   nodes[i] = [name, kind, group, type, obs, custom, degree, formUse]
//   edges[i] = [child, childField, parent, parentField, tier, extra]
//                extra bit 1 = composite, bit 2 = conditional
const KIND_CODE = { table: 0, entity: 1, view: 2 }
const compact = {
  schema: 'fno-navigator/relation-graph-compact/v1',
  generatedFrom: graph.provenance.generation,
  coverage: {
    state: coverage.state,
    edges: coverage.edges,
    nodes: coverage.graphNodes,
    tierCounts: coverage.tierCounts,
  },
  nodeSchema: ['name', 'kind', 'group', 'type', 'obs', 'custom', 'degree', 'formUse'],
  edgeSchema: ['child', 'childField', 'parent', 'parentField', 'tier', 'flags'],
  nodes: graph.tables.map((t) => [
    t.name,
    KIND_CODE[t.kind] ?? 0,
    t.group,
    t.type,
    t.obs ? 1 : 0,
    t.custom ? 1 : 0,
    t.degree,
    t.formUse,
  ]),
  edges: graph.edges.map((e) => [
    e.child,
    e.childField,
    e.parent,
    e.parentField,
    e.tier,
    (e.composite ? 1 : 0) | (e.conditional ? 2 : 0),
  ]),
}
const compactPath = join(OUT_DIR, 'graph-compact.json')
// Guard against replacing a full-corpus artifact with a partial one. Measured
// failure: running the generator against the 17-model server corpus silently
// overwrote the 180-model laptop artifact, dropping 8,872 nodes and 19,810
// edges — and the site would have served the smaller graph without complaint.
if (existsSync(compactPath)) {
  try {
    const prev = JSON.parse(readFileSync(compactPath, 'utf8'))
    const prevNodes = prev.nodes?.length ?? 0
    const prevEdges = prev.edges?.length ?? 0
    if (compact.nodes.length < prevNodes || compact.edges.length < prevEdges) {
      const msg = `REFUSING to shrink artifact: on disk ${prevNodes} nodes / ${prevEdges} edges, would write ${compact.nodes.length} / ${compact.edges.length}. Pass --force to override.`
      if (!args.includes('--force')) {
        console.error(msg)
        process.exit(3)
      }
      console.error(`WARNING ${msg}`)
    }
  } catch {
    // Unreadable previous artifact is not a reason to refuse.
  }
}
writeFileSync(compactPath, JSON.stringify(compact))
if (verdicts.verdicts.length) writeFileSync(join(OUT_DIR, 'graph-verdicts.json'), JSON.stringify(verdicts, null, 1))

const sha = createHash('sha256').update(JSON.stringify(graph)).digest('hex')
console.log(JSON.stringify({ ...coverage, fingerprint: sha, graphPath, verdicts: verdicts.summary ?? null }, null, 2))
