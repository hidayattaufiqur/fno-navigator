#!/usr/bin/env node
// Apply patch-manifest.json to the PUBLIC dataset (tablefieldassociations.json).
//
// Two phases (architect t_03c43002 recommendation, see card t_5f9e4f6a):
//   --phase 1: tax_case.adds (append) + add_corrected (in-place replace of
//              `replaces`) + promote_verified (in-place replace of `removes`)
//   --phase 2: suspect_verdict.actions.remove (delete entries by exact key)
//
// Ghost-path rule: every `replaces`/`removes`/remove target MUST exist in the
// dataset or the script exits non-zero without writing anything.
//
// Serialization byte-matches the dataset's custom pretty format; the script
// round-trips the UNPATCHED dataset through its own serializer first and aborts
// if the bytes differ (format drift guard). Consequence: the git diff stays
// minimal (only touched lines differ).
//
// Usage: node scripts/apply-patch-manifest.mjs --phase 1|2 [--only <section>]  (run from repo root)
//   --only <section>: apply only that manifest section's actions (e.g. mirror_sync).
//                     Sections not selected are skipped entirely.

import { readFileSync, writeFileSync } from 'node:fs'

const MANIFEST = '/home/smolpanda/Fun/Projects/fno-dev-copilot-spike/data/patch-manifest.json'
const DATASET = '/home/smolpanda/Fun/Projects/MicrosoftDynamicsTableAssociations/tablefieldassociations.json'

const phaseArg = process.argv.indexOf('--phase')
const PHASE = phaseArg >= 0 ? Number(process.argv[phaseArg + 1]) : NaN
if (![1, 2].includes(PHASE)) {
  console.error('usage: node scripts/apply-patch-manifest.mjs --phase 1|2 [--only <section>]')
  process.exit(2)
}

// --only <section>: restrict application to one manifest section
const onlyArg = process.argv.indexOf('--only')
const ONLY = onlyArg >= 0 ? process.argv[onlyArg + 1] : null
const sectionSelected = (name) => !ONLY || ONLY === name

const raw = readFileSync(DATASET, 'utf8')
const entries = JSON.parse(raw)
const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))

const q = JSON.stringify
const key = (e) => `${e.ParentTableName}\u0000${e.ParentFieldName}\u0000${e.ChildTableName}\u0000${e.ChildFieldName}`

// byte-exact serializer for the dataset's custom pretty format
function serialize(arr) {
  const parts = ['[{']
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i]
    parts.push(
      `        "ParentTableName": ${q(e.ParentTableName)},`,
      `        "ParentFieldName": ${q(e.ParentFieldName)},`,
      `        "ChildTableName": ${q(e.ChildTableName)},`,
      `        "ChildFieldName": ${q(e.ChildFieldName)}`
    )
    parts.push(i === arr.length - 1 ? '    }' : '    }, {')
  }
  parts.push(']')
  return parts.join('\n') + '\n'
}

// --- format drift guard: serialize(parse(original)) must equal original bytes
const roundTrip = serialize(JSON.parse(raw))
if (roundTrip !== raw) {
  // locate first divergence for diagnostics
  let i = 0
  while (i < Math.min(roundTrip.length, raw.length) && roundTrip[i] === raw[i]) i++
  console.error('FORMAT DRIFT: serializer does not byte-match the dataset file.')
  console.error(`first divergence at byte ${i}`)
  console.error('raw:       ' + JSON.stringify(raw.slice(Math.max(0, i - 60), i + 60)))
  console.error('serialized:' + JSON.stringify(roundTrip.slice(Math.max(0, i - 60), i + 60)))
  process.exit(3)
}
console.log('format guard: serializer byte-matches original file OK')

// --- build index: key -> index (all keys unique, verified pre-flight)
const index = new Map()
entries.forEach((e, i) => {
  if (index.has(key(e))) {
    console.error(`duplicate key in dataset at ${i}: ${key(e)}`)
    process.exit(3)
  }
  index.set(key(e), i)
})

if (PHASE === 1) {
  // 1a. tax_case.adds: pure new entries, appended at the end
  const taxAdds = sectionSelected('tax_case') ? m.sections.tax_case.adds : []
  const taxAdded = []
  for (const a of taxAdds) {
    if (!a.entry?.ParentTableName) { console.error('tax_case.adds entry missing .entry'); process.exit(3) }
    if (index.has(key(a.entry))) {
      console.error(`tax add ALREADY EXISTS (should be in already_present): ${key(a.entry)}`)
      process.exit(3)
    }
    entries.push(a.entry)
    index.set(key(a.entry), entries.length - 1)
    taxAdded.push(a.entry)
  }

  // 1b. add_corrected: swap `replaces` (dataset) -> corrected `entry`, in place
  const acts = sectionSelected('suspect_verdict')
    ? m.sections.suspect_verdict.actions
    : { add_corrected: [], promote_verified: [], remove: [] }
  const replaced = []
  for (const a of acts.add_corrected) {
    const k = key(a.replaces)
    const i = index.get(k)
    if (i === undefined) {
      console.error(`add_corrected.replaces NOT FOUND in dataset (ghost): ${k}`)
      process.exit(3)
    }
    if (index.has(key(a.entry))) {
      console.error(`add_corrected.entry ALREADY EXISTS: ${key(a.entry)}`)
      process.exit(3)
    }
    const old = entries[i]
    entries[i] = a.entry
    index.delete(k)
    index.set(key(a.entry), i)
    replaced.push({ at: i, old: old.ParentTableName + '.' + old.ParentFieldName, new: a.entry.ParentTableName + '.' + a.entry.ParentFieldName })
  }

  // 1c. promote_verified: swap `removes` (dataset) -> corrected `entry`, in place
  const promoted = []
  for (const a of acts.promote_verified) {
    const k = key(a.removes)
    const i = index.get(k)
    if (i === undefined) {
      console.error(`promote_verified.removes NOT FOUND in dataset (ghost): ${k}`)
      process.exit(3)
    }
    if (index.has(key(a.entry))) {
      console.error(`promote_verified.entry ALREADY EXISTS: ${key(a.entry)}`)
      process.exit(3)
    }
    const old = entries[i]
    entries[i] = a.entry
    index.delete(k)
    index.set(key(a.entry), i)
    promoted.push({ at: i, old: old.ParentTableName + '.' + old.ParentFieldName, new: a.entry.ParentTableName + '.' + a.entry.ParentFieldName })
  }

  // 1d. non_tax_gaps.adds: pure new entries, appended at the end
  const nonTaxAdds = sectionSelected('non_tax_gaps') ? (m.sections.non_tax_gaps?.adds ?? []) : []
  const nonTaxAdded = []
  for (const a of nonTaxAdds) {
    if (!a.entry?.ParentTableName) { console.error('non_tax_gaps.adds entry missing .entry'); process.exit(3) }
    if (index.has(key(a.entry))) {
      console.error(`non_tax add ALREADY EXISTS: ${key(a.entry)}`)
      process.exit(3)
    }
    entries.push(a.entry)
    index.set(key(a.entry), entries.length - 1)
    nonTaxAdded.push(a.entry)
  }

  // 1e. mirror_sync.actions.add_corrected: in-place replace (declaring-side corrections)
  const msCorrects = sectionSelected('mirror_sync') ? (m.sections.mirror_sync?.actions?.add_corrected ?? []) : []
  const msReplaced = []
  for (const a of msCorrects) {
    const k = key(a.replaces)
    const i = index.get(k)
    if (i === undefined) {
      console.error(`mirror_sync add_corrected.replaces NOT FOUND in dataset (ghost): ${k}`)
      process.exit(3)
    }
    if (index.has(key(a.entry))) {
      console.error(`mirror_sync add_corrected.entry ALREADY EXISTS: ${key(a.entry)}`)
      process.exit(3)
    }
    const old = entries[i]
    entries[i] = a.entry
    index.delete(k)
    index.set(key(a.entry), i)
    msReplaced.push({ at: i, old: old.ParentTableName + '.' + old.ParentFieldName, new: a.entry.ParentTableName + '.' + a.entry.ParentFieldName })
  }

  // 1f. mirror_sync_2.adds: pure new entries (re-adds confirmed by partial batch), appended
  const ms2Adds = sectionSelected('mirror_sync_2') ? (m.sections.mirror_sync_2?.adds ?? []) : []
  const ms2Added = []
  for (const a of ms2Adds) {
    if (!a.entry?.ParentTableName) { console.error('mirror_sync_2.adds entry missing .entry'); process.exit(3) }
    if (index.has(key(a.entry))) {
      console.error(`mirror_sync_2 add ALREADY EXISTS: ${key(a.entry)}`)
      process.exit(3)
    }
    entries.push(a.entry)
    index.set(key(a.entry), entries.length - 1)
    ms2Added.push(a.entry)
  }

  console.log(`phase 1 applied: ${taxAdded.length} tax adds appended, ` +
    `${replaced.length} add_corrected replaced in place, ${promoted.length} promote_verified replaced in place, ` +
    `${nonTaxAdded.length} non_tax_gaps adds appended, ${msReplaced.length} mirror_sync corrections replaced in place, ` +
    `${ms2Added.length} mirror_sync_2 re-adds appended` +
    (ONLY ? ` [only=${ONLY}]` : ''))
  console.log(`entries: ${entries.length} (was ${JSON.parse(raw).length})`)
  writeFileSync(DATASET, serialize(entries))
  console.log(`wrote ${DATASET}`)
}

if (PHASE === 2) {
  const acts = m.sections.suspect_verdict.actions
  const removed = []
  const byClass = {}
  for (const a of acts.remove) {
    const k = key(a.entry)
    const i = index.get(k)
    if (i === undefined) {
      console.error(`remove target NOT FOUND in dataset (ghost): ${k}`)
      process.exit(3)
    }
    entries.splice(i, 1)
    index.delete(k)
    // re-index everything after i (splice shifts indices)
    for (let j = i; j < entries.length; j++) index.set(key(entries[j]), j)
    removed.push({ entry: a.entry, cls: a.class })
    byClass[a.class] = (byClass[a.class] ?? 0) + 1
  }
  console.log(`phase 2 applied: ${removed.length} entries removed`)
  console.log(`removed by class: ${JSON.stringify(byClass)}`)
  console.log(`entries: ${entries.length} (was ${JSON.parse(raw).length})`)
  writeFileSync(DATASET, serialize(entries))
  console.log(`wrote ${DATASET}`)
}