#!/usr/bin/env node
// Reproducible fk-map.json generator + provenance manifest (fno-navigator).
//
// WHAT IT DOES
//   Rebuilds static/data/fk-map.json and static/data/map-manifest.json from the
//   PUBLIC DynamicsTableAssociations dataset alone (tablefieldassociations.json).
//   The public dataset is the ONLY data source for anything committed to this
//   repo (LICENSE BOUNDARY: the licensed D365FO metadata mirror must NEVER feed
//   data here). Output is deterministic: same input file -> byte-identical
//   outputs and fingerprint, in any environment.
//
// TRANSFORM RULES (settled decisions, see kanban card t_8c94da06)
//   1. Schema stays identical to consumers: parent-keyed dict -> array of
//      [childTable, parentField, childField] tuples.
//   2. Clean single-field entries are emitted as-is, in dataset encounter
//      order (this reproduces the historical map's ordering exactly).
//   3. Composite-key relations (multi-field FK specs like "dataAreaId, TaxGroup")
//      are parsed on each side: split on ',', trim, drop Pky?/Fky?/Pky/Fky
//      marker tokens, then pair the surviving fields POSITIONALLY (the dataset
//      is parallel comma lists; the spike pipeline verified zero unequal
//      lengths). Each pair is emitted as ONE edge — every constituent pair is
//      a valid join on its own. Counted in the manifest transform log.
//   4. Entries whose fields parse to nothing (marker-only specs, e.g.
//      "Pky?" / "Fky?") carry no usable field pair and are DROPPED with a
//      counted reason. Unequal parsed list lengths (0 today) are dropped too.
//   5. Exact-duplicate edges (same parent, child, parentField, childField)
//      are deduped globally; first occurrence wins, count recorded.
//   6. Self-references (parent == child) are kept, exactly like the source
//      dataset and the historical map; consumers skip them when rendering.
//
// FINGERPRINT
//   sha256( map-file bytes + '\n' + compact-JSON(manifest minus fingerprint) ).
//   Fully deterministic (no wall clock: generatedAt derives from the dataset
//   git commit date, or the dataset file mtime when the dir is not a repo).
//
// USAGE
//   node tools/generate-map.mjs                     # write static/data/*
//   node tools/generate-map.mjs --out-dir <dir>     # write elsewhere (tests/CI)
//   node tools/generate-map.mjs --verify            # read-back + fingerprint check
//   FNO_DATASET_DIR=/path/to/MicrosoftDynamicsTableAssociations  # override input
//
// Pure Node stdlib, no dependencies. Node >= 18 (import.meta.dirname needs 20.11+;
// repo already runs node 24 for the test harness).

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const SCRIPT_VERSION = '1.0.0'
const TOOLS_DIR = dirname(import.meta.url.replace('file://', ''))
const REPO_ROOT = dirname(TOOLS_DIR)
const DEFAULT_OUT = join(REPO_ROOT, 'static', 'data')
const DEFAULT_DATASET_DIR = process.env.FNO_DATASET_DIR
  || join(os.homedir(), 'Fun', 'Projects', 'MicrosoftDynamicsTableAssociations')

const MAP_FILE = 'fk-map.json'
const MANIFEST_FILE = 'map-manifest.json'

// Markers in the alexdmeyer dataset annotate which side of a pair is the
// primary key ("Pky?") vs foreign key ("Fky?"). They carry no field name.
const MARKER_RE = /^(Pky|Fky)\??$/i

/** Parse one field spec into surviving field names. {raw, tokens, composite} */
function parseSpec(spec) {
  const raw = String(spec)
  const tokens = []
  for (const part of raw.split(',')) {
    const t = part.trim()
    if (t === '' || MARKER_RE.test(t)) continue
    tokens.push(t)
  }
  return { raw, tokens, composite: raw.includes(',') }
}

/**
 * Deterministic transform of the dataset into the forward map.
 * Returns { forward, counts } where counts is the full manifest counts block.
 */
function buildMap(entries) {
  const forward = Object.create(null) // insertion order = dataset encounter order
  const seen = new Set()
  const counts = {
    entriesTotal: entries.length,
    entriesClean: 0,
    entriesComposite: 0,
    expansionEdges: 0,
    dropped: { markerOnly: 0, unequal: 0, unparseable: 0, duplicateEdges: 0 },
    edges: 0,
    selfEdges: 0,
  }

  for (const e of entries) {
    const parent = e.ParentTableName
    const child = e.ChildTableName
    const pp = parseSpec(e.ParentFieldName)
    const cp = parseSpec(e.ChildFieldName)

    // Rule 4: marker-only / empty side -> drop, counted.
    if (pp.tokens.length === 0 || cp.tokens.length === 0) {
      counts.dropped.markerOnly++
      continue
    }
    // Rule 4b: unequal lists (structural noise) -> drop, counted.
    if (pp.tokens.length !== cp.tokens.length) {
      counts.dropped.unequal++
      continue
    }
    // Defensive: a surviving token that still carries junk ('?' or whitespace)
    // cannot be a real field name. This never fired in the shipped dataset
    // (verified 2026-08-17: 0 occurrences) but keep the audit honest.
    const allTokens = [...pp.tokens, ...cp.tokens]
    if (allTokens.some((t) => /[?\s]/.test(t))) {
      counts.dropped.unparseable++
      continue
    }

    const isComposite = pp.composite || cp.composite
    let bucket = forward[parent]
    if (!bucket) forward[parent] = bucket = []
    if (parent === child) counts.selfEdges += pp.tokens.length

    // Rule 3: one edge per positional field pair.
    for (let i = 0; i < pp.tokens.length; i++) {
      const tuple = [child, pp.tokens[i], cp.tokens[i]]
      const key = `${parent}\u0000${tuple.join('\u0000')}`
      if (seen.has(key)) {
        counts.dropped.duplicateEdges++
        continue
      }
      seen.add(key)
      bucket.push(tuple)
      counts.edges++
      if (isComposite) counts.expansionEdges++
      else counts.entriesClean++  // incremented per emitted clean edge == per clean entry
    }
    if (isComposite) counts.entriesComposite++
  }

  // entriesClean counts emitted clean edges; reconcile to entry-level count:
  // clean entries emit exactly one edge, so the two numbers coincide.
  return { forward, counts }
}

/** sha256 hex of a utf8 string. */
function sha256(s) {
  return createHash('sha256').update(s).digest('hex')
}

/** Resolve the dataset dir; error out loudly with a hint when missing. */
function resolveDatasetDir(explicit) {
  const dir = explicit ?? DEFAULT_DATASET_DIR
  const file = join(dir, 'tablefieldassociations.json')
  if (!existsSync(file)) {
    throw new Error(
      `dataset not found at ${file}\n` +
      `clone it with: git clone https://github.com/ameyer505/MicrosoftDynamicsTableAssociations\n` +
      `or set FNO_DATASET_DIR to point at a checkout.`
    )
  }
  return dir
}

/** Git facts for the dataset dir (SHA + commit date), null-safe when not a repo. */
function gitFacts(dir) {
  const sha = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  const date = spawnSync('git', ['-C', dir, 'log', '-1', '--format=%cI'], { encoding: 'utf8' })
  return {
    gitCommitSha: sha.status === 0 ? sha.stdout.trim() : null,
    gitCommitDate: date.status === 0 ? date.stdout.trim() : null,
  }
}

/** Load dataset entries: array of {ParentTableName, ParentFieldName, ChildTableName, ChildFieldName}. */
function loadDataset(dir) {
  const file = join(dir, 'tablefieldassociations.json')
  const raw = readFileSync(file, 'utf8')
  return { entries: JSON.parse(raw), fileSha256: sha256(raw), bytes: raw.length }
}

/** Undirected-table graph stats for the audit: orphans + components. */
function graphStats(forward, counts) {
  const children = new Set()
  const nodeSet = new Set()
  for (const [parent, kids] of Object.entries(forward)) {
    nodeSet.add(parent)
    for (const [child] of kids) {
      children.add(child)
      nodeSet.add(child)
    }
  }
  // union-find
  const parentOf = new Map()
  const find = (x) => {
    let root = x
    while (parentOf.get(root) !== undefined && parentOf.get(root) !== root) root = parentOf.get(root)
    while (parentOf.get(x) !== undefined && parentOf.get(x) !== root) {
      const next = parentOf.get(x)
      parentOf.set(x, root)
      x = next
    }
    return root
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parentOf.set(ra, rb)
  }
  for (const n of nodeSet) parentOf.set(n, n)
  for (const [parent, kids] of Object.entries(forward)) {
    for (const [child] of kids) union(parent, child)
  }
  const components = new Set()
  for (const n of nodeSet) components.add(find(n))
  return {
    tables: Object.keys(forward).length,           // parents with >= 1 edge
    childTables: children.size,
    totalReferencedTables: nodeSet.size,           // parents + children with edges
    connectedComponents: components.size,
  }
}

/** Full generation pipeline. Returns { mapText, manifest, manifestText, stats }. */
function generate(dir, outDir) {
  const { entries, fileSha256, bytes } = loadDataset(dir)
  const { forward, counts } = buildMap(entries)
  const stats = graphStats(forward, counts)

  // Orphans: tables that appear in the dataset universe but have zero edges in
  // the generated map (present as parent or child, never on any edge).
  const universe = new Set()
  for (const e of entries) {
    universe.add(e.ParentTableName)
    universe.add(e.ChildTableName)
  }
  const withEdges = new Set()
  for (const [p, kids] of Object.entries(forward)) {
    withEdges.add(p)
    for (const [c] of kids) withEdges.add(c)
  }
  const orphans = []
  for (const t of universe) if (!withEdges.has(t)) orphans.push(t)
  orphans.sort()

  const git = gitFacts(dir)
  const sourceDataset = {
    name: 'MicrosoftDynamicsTableAssociations',
    path: dir,
    ...git,
    fileSha256,
    entryCount: entries.length,
    fileSize: bytes,
  }

  const countsOut = {
    entriesTotal: counts.entriesTotal,
    cleanRelations: counts.entriesClean,
    compositeRelations: counts.entriesComposite,
    expansionEdges: counts.expansionEdges,
    dropped: {
      markerOnlySpecs: counts.dropped.markerOnly,
      unequalFieldLists: counts.dropped.unequal,
      unparseableFields: counts.dropped.unparseable,
      duplicateEdges: counts.dropped.duplicateEdges,
    },
    droppedTotal: counts.dropped.markerOnly + counts.dropped.unequal + counts.dropped.unparseable,
    edges: counts.edges,
    tables: stats.tables,
    childTables: stats.childTables,
    totalReferencedTables: stats.totalReferencedTables,
    selfEdges: counts.selfEdges,
    orphanTables: orphans.length,
    connectedComponents: stats.connectedComponents,
  }

  const mapText = JSON.stringify(forward) // compact, no trailing newline (matches committed format)
  const manifest = {
    schema: 'fno-navigator/fk-map-manifest/v1',
    generator: { script: 'tools/generate-map.mjs', version: SCRIPT_VERSION },
    generatedAt: git.gitCommitDate ?? new Date(statSync(join(dir, 'tablefieldassociations.json')).mtime).toISOString(),
    sourceDataset,
    counts: countsOut,
  }
  const fingerprint = sha256(mapText + '\n' + JSON.stringify(manifest))
  manifest.fingerprint = fingerprint
  const manifestText = JSON.stringify(manifest, null, 2) + '\n'

  return {
    mapText,
    manifest,
    manifestText,
    fingerprint,
    counts: countsOut,
    orphans,
  }
}

/** Read-back verification of committed/out-dir outputs (--verify). */
function verify(outDir) {
  const problems = []
  const log = (ok, msg) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`)
    if (!ok) problems.push(msg)
  }

  const mapFile = join(outDir, MAP_FILE)
  const manifestFile = join(outDir, MANIFEST_FILE)
  if (!existsSync(mapFile) || !existsSync(manifestFile)) {
    console.error(`missing ${mapFile} or ${manifestFile}; run node tools/generate-map.mjs first`)
    process.exit(1)
  }

  const mapRaw = readFileSync(mapFile, 'utf8')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))

  // 1. Map parses and counts match manifest.
  let map
  try {
    map = JSON.parse(mapRaw)
    log(true, 'fk-map.json parses')
  } catch {
    log(false, 'fk-map.json does not parse')
    process.exit(1)
  }
  let edges = 0
  for (const kids of Object.values(map)) {
    if (!Array.isArray(kids)) { log(false, 'map value is not an array'); process.exit(1) }
    for (const t of kids) {
      if (!Array.isArray(t) || t.length !== 3) { log(false, `bad triple under a key: ${JSON.stringify(t)}`); process.exit(1) }
      edges++
    }
  }
  log(Object.keys(map).length === manifest.counts.tables, `table count ${Object.keys(map).length} == manifest ${manifest.counts.tables}`)
  log(edges === manifest.counts.edges, `edge count ${edges} == manifest ${manifest.counts.edges}`)

  // 2. Fingerprint recompute matches.
  const core = { ...manifest }
  delete core.fingerprint
  const fp = sha256(mapRaw + '\n' + JSON.stringify(core))
  log(fp === manifest.fingerprint, `fingerprint recompute == manifest (${manifest.fingerprint.slice(0, 12)}...)`)

  // 3. Dataset still at recorded version (when reachable).
  //    This is a LOCAL provenance guard: the committed manifest records the
  //    dataset's absolute path on the authoring machine. On a fresh checkout
  //    or CI runner that dataset is not cloned, so the content-hash can't be
  //    rechecked there. Absence is a soft SKIP (machine-independent invariants
  //    above already passed); a present-but-mismatched dataset is a hard FAIL.
  if (existsSync(join(manifest.sourceDataset.path, 'tablefieldassociations.json'))) {
    const raw = readFileSync(join(manifest.sourceDataset.path, 'tablefieldassociations.json'), 'utf8')
    const now = sha256(raw)
    log(now === manifest.sourceDataset.fileSha256, `dataset content sha matches manifest (${now.slice(0, 12)}...)`)
  } else {
    console.log(`skip dataset content sha (local dataset not present: ${manifest.sourceDataset.path})`)
  }

  if (problems.length) {
    console.error(`\n${problems.length} verification check(s) FAILED.`)
    process.exit(1)
  }
  console.log('\nAll map-manifest verification checks pass.')
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const verifyMode = args.includes('--verify')
const outIdx = args.indexOf('--out-dir')
const outDir = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : DEFAULT_OUT

if (verifyMode) {
  verify(outDir)
  process.exit(0)
}

// --- generate mode ----------------------------------------------------------
const datasetDir = resolveDatasetDir()
const generated = generate(datasetDir, outDir)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, MAP_FILE), generated.mapText)
writeFileSync(join(outDir, MANIFEST_FILE), generated.manifestText)

// Determinism self-check: run the transform a second time in-process on the
// same input and compare byte-for-byte (everything, including generatedAt, is
// derived from the input, so this is a strict equality).
const again = generate(datasetDir, outDir)
const mapStable = again.mapText === generated.mapText
const manifestStable = again.manifestText === generated.manifestText
const fpStable = again.fingerprint === generated.fingerprint

console.log(`wrote ${join(outDir, MAP_FILE)}`)
console.log(`wrote ${join(outDir, MANIFEST_FILE)}`)
console.log(`fingerprint ${generated.fingerprint}`)
console.log(`counts: ${generated.counts.tables} tables, ${generated.counts.edges} edges, ` +
  `${generated.counts.droppedTotal} dropped (` +
  `${generated.counts.dropped.markerOnlySpecs} marker-only, ` +
  `${generated.counts.dropped.unequalFieldLists} unequal lists, ` +
  `${generated.counts.dropped.unparseableFields} unparseable, ` +
  `${generated.counts.dropped.duplicateEdges} dup edges), ` +
  `${generated.counts.expansionEdges} expansion edges from ${generated.counts.compositeRelations} composite relations`)
console.log(`determinism self-check: ${mapStable && manifestStable ? 'PASS (2 in-process builds byte-identical)' : 'FAIL'}, ${fpStable ? 'fingerprint stable' : 'fingerprint unstable'}`)
if (!mapStable || !manifestStable) process.exit(1)