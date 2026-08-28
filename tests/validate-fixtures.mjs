// Validate every fixture path against the real dataset (Q9: "EVERY fixture
// path must be existence-validated against fk-map.json at authoring time").
// Fails loudly when the dataset changes and a hand-written story path rots.
//
//   node tests/validate-fixtures.mjs
//
// Exit code 0 = all paths exist as undirected edges in static/data/fk-map.json
// AND the map matches its provenance manifest (map-manifest.json).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const FIXTURES = JSON.parse(readFileSync(join(ROOT, 'static/data/path-fixtures.json'), 'utf8'))
const fwd = JSON.parse(readFileSync(join(ROOT, 'static/data/fk-map.json'), 'utf8'))

// Reverse map (child -> [[parent, parentField, childField], ...]) like the app.
const rev = {}
for (const [parent, children] of Object.entries(fwd)) {
  for (const [child, parentField, childField] of children) {
    if (!rev[child]) rev[child] = []
    rev[child].push([parent, parentField, childField])
  }
}
const allTables = new Set([...Object.keys(fwd), ...Object.keys(rev)])

// --- dataset discipline gates (map manifest from t_8c94da06) -----------------
// The map may only change via tools/generate-map.mjs, which rewrites
// fk-map.json + map-manifest.json together and logs provenance (dataset
// commit, counts, fingerprint). A hand-edited map (e.g. a silent edge
// deletion — the "shrink without a manifest-logged reason" case) breaks the
// fingerprint/count contract below and fails this gate. The recompute mirrors
// the generator's own --verify exactly.
let manifest
try {
  manifest = JSON.parse(readFileSync(join(ROOT, 'static/data/map-manifest.json'), 'utf8'))
} catch {
  console.error('FAIL map-manifest.json missing or unparseable. Regenerate both files: node tools/generate-map.mjs')
  process.exit(1)
}
const mapRaw = readFileSync(join(ROOT, 'static/data/fk-map.json'), 'utf8')

let edgeCount = 0
for (const kids of Object.values(fwd)) edgeCount += kids.length

const gateProblems = []
const gate = (ok, msg) => {
  if (!ok) gateProblems.push(msg)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`)
}
gate(
  Object.keys(fwd).length === manifest.counts.tables,
  `table count ${Object.keys(fwd).length} == manifest ${manifest.counts.tables}`
)
gate(edgeCount === manifest.counts.edges, `edge count ${edgeCount} == manifest ${manifest.counts.edges}`)
const core = { ...manifest }
delete core.fingerprint
const fp = createHash('sha256').update(mapRaw + '\n' + JSON.stringify(core)).digest('hex')
gate(
  fp === manifest.fingerprint,
  `map fingerprint recompute == manifest (${manifest.fingerprint.slice(0, 12)}...)`
)
if (gateProblems.length) {
  console.error(
    `\n${gateProblems.length} manifest gate check(s) FAILED: fk-map.json was changed without regenerating the manifest.\n` +
    `Regenerate and commit a manifest-logged reason: node tools/generate-map.mjs`
  )
  process.exit(1)
}

// Ghost-table guard: hallucinated table names must never enter the dataset.
for (const ghost of ['TaxItemGroupData']) {
  if (allTables.has(ghost)) {
    console.error(
      `FAIL ghost table ${ghost} present in fk-map.json — hallucinated name (real line table: TaxOnItem). ` +
      `Remove it from the dataset and regenerate the manifest.`
    )
    process.exit(1)
  }
}

/** Undirected edge exists between a and b? Returns the join field pairs. */
function edgeExists(a, b) {
  const out = []
  for (const [child, pf, cf] of fwd[a] ?? []) if (child === b) out.push([a, pf, b, cf])
  for (const [parent, pf, cf] of rev[a] ?? []) if (parent === b) out.push([a, cf, b, pf])
  return out
}

let failures = 0
const pairCount = FIXTURES.pairs.length
let pathCount = 0

for (const f of FIXTURES.pairs) {
  const problems = []
  for (const t of [f.source, f.target]) {
    if (!allTables.has(t)) problems.push(`table not in dataset: ${t}`)
  }
  for (const must of f.mustSurface ?? []) {
    pathCount++
    if (must.length < 2) {
      problems.push(`degenerate mustSurface path: ${JSON.stringify(must)}`)
      continue
    }
    for (let i = 0; i < must.length - 1; i++) {
      if (!edgeExists(must[i], must[i + 1]).length) {
        problems.push(`edge missing in fk-map.json: ${must[i]} -- ${must[i + 1]}`)
      }
    }
  }
  if (problems.length) {
    failures++
    console.log(`FAIL ${f.id} (${f.source}->${f.target}):`)
    for (const p of problems) console.log(`   ${p}`)
  } else {
    console.log(`ok   ${f.id} (${f.source}->${f.target}, ${(f.mustSurface ?? []).length} mustSurface paths)`)
  }
}

console.log(`\n${FIXTURES.pairs.length} fixtures, ${pathCount} mustSurface paths checked.`)
if (failures) {
  console.log(`${failures} fixture(s) FAILED existence validation.`)
  process.exit(1)
}
console.log('All fixture paths exist in the dataset.')
