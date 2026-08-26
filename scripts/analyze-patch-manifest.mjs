#!/usr/bin/env node
// Dry-run analysis of patch-manifest.json against the public dataset.
// Verifies the ghost-path rule: every target that the manifest expects to
// exist in the dataset (replaces, removes, and remove entries) must be found.
// Also checks add entries for pre-existing duplicates (already_present).
//
// Usage: node scripts/analyze-patch-manifest.mjs [--only <section>]  (run from repo root)
// --only <section>: scope checks to one section (for incremental cards whose
// earlier sections were already applied to the dataset).

import { readFileSync } from 'node:fs'

const MANIFEST = '/home/smolpanda/Fun/Projects/fno-dev-copilot-spike/data/patch-manifest.json'
const DATASET = '/home/smolpanda/Fun/Projects/MicrosoftDynamicsTableAssociations/tablefieldassociations.json'

const onlyArg = process.argv.indexOf('--only')
const ONLY = onlyArg >= 0 ? process.argv[onlyArg + 1] : null

const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const dataset = JSON.parse(readFileSync(DATASET, 'utf8'))

const key = (e) => `${e.ParentTableName}\u0000${e.ParentFieldName}\u0000${e.ChildTableName}\u0000${e.ChildFieldName}`

// Index dataset: exact-key -> list of indices (dup entries possible)
const idx = new Map()
dataset.forEach((e, i) => {
  const k = key(e)
  if (!idx.has(k)) idx.set(k, [])
  idx.get(k).push(i)
})

const missing = []
const dupAdds = []
const matchedCount = { add: 0, replace: 0, remove: 0 }

const checkTarget = (label, target) => {
  const hits = idx.get(key(target)) ?? []
  if (hits.length === 0) missing.push({ label, target })
  return hits
}

// --- tax_case.adds: pure new entries, must NOT already exist (they'd be dup adds)
const taxAdds = ONLY && ONLY !== 'tax_case' ? [] : m.sections.tax_case.adds
for (const a of taxAdds) {
  const hits = idx.get(key(a.entry)) ?? []
  if (hits.length > 0) dupAdds.push({ label: 'tax_case.adds', entry: a.entry, existing: hits.map((i) => dataset[i]) })
}

// --- non_tax_gaps.adds: pure new entries, must NOT already exist (dup-add check)
const nonTaxAdds = ONLY && ONLY !== 'non_tax_gaps' ? [] : (m.sections.non_tax_gaps?.adds ?? [])
for (const a of nonTaxAdds) {
  if (!a.entry?.ParentTableName) { missing.push({ label: 'non_tax_gaps.adds.missingEntry', a }); continue }
  const hits = idx.get(key(a.entry)) ?? []
  if (hits.length > 0) dupAdds.push({ label: 'non_tax_gaps.adds', entry: a.entry, existing: hits.map((i) => dataset[i]) })
}

// --- suspect_verdict.actions
const acts = ONLY && ONLY !== 'suspect_verdict'
  ? { add_corrected: [], promote_verified: [], remove: [] }
  : m.sections.suspect_verdict.actions

// add_corrected: carries `replaces` (the dataset entry it fixes). The corrected
// entry itself must NOT already exist (otherwise it's a no-op, not a fix).
for (const a of acts.add_corrected) {
  if (!a.entry) { missing.push({ label: 'add_corrected.missingEntry', a }); continue }
  const rep = checkTarget('add_corrected.replaces', a.replaces)
  if (rep.length > 0) matchedCount.add++
  const selfHits = idx.get(key(a.entry)) ?? []
  if (selfHits.length > 0) dupAdds.push({ label: 'add_corrected.self', entry: a.entry, existing: selfHits.map((i) => dataset[i]) })
}

// promote_verified: carries `removes` (the dataset entry it supersedes) and a
// corrected `entry` that must NOT already be present.
for (const a of acts.promote_verified) {
  const rem = checkTarget('promote_verified.removes', a.removes)
  if (rem.length > 0) matchedCount.replace++
  const selfHits = idx.get(key(a.entry)) ?? []
  if (selfHits.length > 0) dupAdds.push({ label: 'promote_verified.self', entry: a.entry, existing: selfHits.map((i) => dataset[i]) })
}

// remove: bare dataset entries that must exist to be removed.
for (const a of acts.remove) {
  const hits = checkTarget('remove.entry', a.entry)
  if (hits.length > 0) matchedCount.remove++
}

console.log('=== MATCH SUMMARY ===')
console.log(`add_corrected replaces matched:     ${matchedCount.add}`)
console.log(`promote_verified removes matched:   ${matchedCount.replace}`)
console.log(`remove entries matched:             ${matchedCount.remove}`)

console.log('\n=== MISSING TARGETS (ghost-path check) ===')
console.log(`missing: ${missing.length}`)
for (const x of missing.slice(0, 20)) console.log(`  ${x.label}: ${JSON.stringify(x.target)}`)

console.log('\n=== POTENTIAL DUP ADDS (corrected entry already exists) ===')
console.log(`dupAdds: ${dupAdds.length}`)
for (const x of dupAdds.slice(0, 10)) console.log(`  ${x.label}: ${JSON.stringify(x.entry)}`)

// Class distribution of removes, for the audit log
const classCount = {}
for (const a of acts.remove) classCount[a.class] = (classCount[a.class] ?? 0) + 1
console.log('\n=== REMOVE CLASS DISTRIBUTION ===')
console.log(JSON.stringify(classCount, null, 1))

// Grounds distribution
const groundsCount = {}
for (const a of acts.remove) {
  const g = String(a.grounds ?? '?').slice(0, 40)
  groundsCount[g] = (groundsCount[g] ?? 0) + 1
}
console.log('\n=== REMOVE GROUNDS (truncated) ===')
for (const [g, n] of Object.entries(groundsCount).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${g}`)

process.exit(missing.length === 0 ? 0 : 2)