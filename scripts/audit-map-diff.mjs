#!/usr/bin/env node
// Audit diff: OLD committed fk-map (pre-patch, ec6b838) vs NEW regenerated map.
// Computes table/edge deltas, tax-case walkability (revised chain), ghost check,
// and which removed dataset entries were previously SURFACED as map edges.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/home/smolpanda/Fun/Projects/fno-navigator'
const OLD_MAP = '/tmp/old-map-ec6b838/fk-map.json'
const NEW_MAP = '/tmp/map-final1/fk-map.json'
const MANIFEST = '/home/smolpanda/Fun/Projects/fno-dev-copilot-spike/data/patch-manifest.json'

const oldMap = JSON.parse(readFileSync(OLD_MAP, 'utf8'))
const newMap = JSON.parse(readFileSync(NEW_MAP, 'utf8'))
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

const edgeKey = (parent, child, pf, cf) => `${parent}\u0000${child}\u0000${pf}\u0000${cf}`

// old edge set
const oldEdges = new Set()
const oldTables = new Set()
const oldRev = {}
for (const [parent, kids] of Object.entries(oldMap)) {
  oldTables.add(parent)
  for (const [child, pf, cf] of kids) {
    oldEdges.add(edgeKey(parent, child, pf, cf))
    oldTables.add(child)
    if (!oldRev[child]) oldRev[child] = []
    oldRev[child].push([parent, pf, cf])
  }
}

// new edge set + reverse map
const newEdges = new Set()
const newTables = new Set()
const newRev = {}
for (const [parent, kids] of Object.entries(newMap)) {
  newTables.add(parent)
  for (const [child, pf, cf] of kids) {
    newEdges.add(edgeKey(parent, child, pf, cf))
    newTables.add(child)
    if (!newRev[child]) newRev[child] = []
    newRev[child].push([parent, pf, cf])
  }
}

const addedEdges = [...newEdges].filter((e) => !oldEdges.has(e))
const lostEdges = [...oldEdges].filter((e) => !newEdges.has(e))
const addedTables = [...newTables].filter((t) => !oldTables.has(t))
const lostTables = [...oldTables].filter((t) => !newTables.has(t))

console.log('=== COUNT DELTAS ===')
console.log(`tables: ${oldTables.size} -> ${newTables.size} (${addedTables.length} added, ${lostTables.length} lost)`)
console.log(`edges:  ${oldEdges.size} -> ${newEdges.size} (${addedEdges.length} added, ${lostEdges.length} removed)`)
console.log(`added tables: ${addedTables.join(', ') || '(none)'}`)
console.log(`lost tables:  ${lostTables.join(', ') || '(none)'}`)

// --- tax case (revised, architect ground truth) ---
const edgeExists = (a, b) => {
  const out = []
  for (const [child, pf, cf] of newMap[a] ?? []) if (child === b) out.push([a, pf, b, cf])
  for (const [parent, pf, cf] of newRev[a] ?? []) if (parent === b) out.push([a, cf, b, pf])
  return out
}
const chain = ['SalesLine', 'TaxItemGroupHeading', 'TaxOnItem', 'TaxTable']
console.log('\n=== TAX CASE (revised chain) ===')
for (let i = 0; i < chain.length - 1; i++) {
  const e = edgeExists(chain[i], chain[i + 1])
  console.log(`${chain[i]} -- ${chain[i + 1]}: ${e.length ? 'OK ' + JSON.stringify(e[0]) : 'MISSING'}`)
}
const walkable = chain.slice(1).every((t, i) => edgeExists(chain[i], t).length > 0)
console.log(`taxOnItemWalkable: ${walkable}`)
console.log(`taxItemGroupDataAbsent: ${!newTables.has('TaxItemGroupData')}`)

// --- suspect resolution: which removed dataset entries had been surfaced ---
console.log('\n=== SUSPECT RESOLUTION ===')
const acts = manifest.sections.suspect_verdict.actions
const removed = acts.remove
const keyOf = (e) => edgeKey(e.ParentTableName, e.ChildTableName, e.ParentFieldName, e.ChildFieldName)
// note: removed entries may be composite; the map edge key differs (expanded per-pair).
// Instead: count how many removed PARENT/CHILD pairs had at least one edge in old map.
let removedWithEdgeOld = 0
const lostParentChildren = new Set()
for (const e of lostEdges) {
  const [p, c] = e.split('\u0000')
  lostParentChildren.add(`${p}|${c}`)
}
const removedPairs = new Set(removed.map((r) => `${r.entry.ParentTableName}|${r.entry.ChildTableName}`))
for (const rp of removedPairs) if (lostParentChildren.has(rp)) removedWithEdgeOld++

const taxAdds = manifest.sections.tax_case.adds.length
const addCorrected = acts.add_corrected.length
const promoteVerified = acts.promote_verified.length
const removesTotal = removed.length
const deferred = acts.deferred_count
console.log(`tax adds applied: ${taxAdds}`)
console.log(`add_corrected applied: ${addCorrected}`)
console.log(`promote_verified applied: ${promoteVerified}`)
console.log(`removes applied: ${removesTotal} (267 noRelation, 50 phantomField)`)
console.log(`removed entries that actually had a surfaced edge in OLD map: ${removedWithEdgeOld} of ${removedPairs.size} distinct pairs`)
console.log(`deferred (recorded, out of scope): ${deferred}`)
console.log(`total patch entries: ${taxAdds + addCorrected + promoteVerified + removesTotal}`)

// --- which OLD edges were lost: sample + count by class category ---
console.log('\n=== LOST EDGES (old map, gone in new) ===')
console.log(`count: ${lostEdges.length}`)
const lostSamples = lostEdges.slice(0, 10).map((e) => {
  const [p, c, pf, cf] = e.split('\u0000')
  return `${p}.${pf} -> ${c}.${cf}`
})
for (const s of lostSamples) console.log(`  - ${s}`)

// --- new edges sample (tax + others) ---
console.log('\n=== ADDED EDGES (sample 15) ===')
const addedSamples = addedEdges.slice(0, 15).map((e) => {
  const [p, c, pf, cf] = e.split('\u0000')
  return `${p}.${pf} -> ${c}.${cf}`
})
for (const s of addedSamples) console.log(`  + ${s}`)

// JSON dump for the report
const report = {
  tablesBefore: oldTables.size,
  tablesAfter: newTables.size,
  tablesAdded: addedTables,
  tablesLost: lostTables,
  edgesBefore: oldEdges.size,
  edgesAfter: newEdges.size,
  edgesAdded: addedEdges.length,
  edgesRemoved: lostEdges.length,
  taxOnItemWalkable: walkable,
  taxItemGroupDataAbsent: !newTables.has('TaxItemGroupData'),
  taxCaseChain: chain,
  suspectsResolvedByPatch: taxAdds + addCorrected + promoteVerified + removesTotal,
  removedEntriesWithOldEdge: removedWithEdgeOld,
  deferredRecorded: deferred,
}
readFileSync // keep import used
console.log('\n' + JSON.stringify(report, null, 2))