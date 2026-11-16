// JS golden test (Q5/Q11 parity): runs the golden pairs and compares the
// top-50 table sequences, scores (6 decimals), qualityClass and reason codes
// against tests/golden-results.json, which is the cross-language contract —
// the Python suite (fno-dev-copilot-spike/server/tests/golden_test.py)
// asserts the same file against the Python implementation, so JS ≡ Python
// transitively.
//
// Three failure classes, deliberately distinct:
//
//   ok               set + order + scores/classes/reasons identical
//   REORDER          same set of paths, order and/or scores differ (benign)
//   POOL SET CHANGE  the pool composition changed: a path is gone and another
//                    took its slot. This is NOT a reorder and must never be
//                    read as one. The candidate pool is a budget-limited DFS
//                    sample, so adding a tableDef can change the sweep order
//                    and evict a better path before the comparator ever sees
//                    it — a class-2/score-16 business-key path can vanish
//                    while a class-0/score-9 plumbing detour is admitted
//                    without anything being outranked. Verify intent before
//                    re-baselining. (Card t_8d874230.)
//
//   node tests/golden-test.mjs          # verify
//   node tests/golden-test.mjs --update # regenerate golden-results.json
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findPaths } from './harness.mjs'

const ROOT = join(import.meta.dirname, '..')
const PAIRS = JSON.parse(readFileSync(join(ROOT, 'tests/golden-pairs.json'), 'utf8'))
const GOLDEN = join(ROOT, 'tests/golden-results.json')
const UPDATE = process.argv.includes('--update')

const round6 = (x) => Math.round(x * 1e6) / 1e6
const key = (r) => r.tables.join('>')
const fmt = (r) => `${key(r)} score=${r.score} c${r.qualityClass} [${r.reasonCodes.join(',')}]`

const generated = { version: 2, generatedBy: 'tests/golden-test.mjs', pairs: [] }
for (const p of PAIRS.pairs) {
  const res = findPaths(p.source, p.target, p.maxHops, {
    sort: p.sort ?? 'unique',
    maxResults: p.maxResults ?? 50,
  })
  generated.pairs.push({
    ...p,
    results: res.results.map((r) => ({
      tables: r.steps.map((s) => s.table),
      score: round6(r.score),
      qualityClass: r.qualityClass,
      reasonCodes: r.reasonCodes,
    })),
  })
}

let golden = null
try {
  golden = JSON.parse(readFileSync(GOLDEN, 'utf8'))
} catch {
  golden = null
}

const findPair = (p) =>
  golden?.pairs.find(
    (g) => g.source === p.source && g.target === p.target && g.maxHops === p.maxHops && g.maxResults === p.maxResults
  )
const label = (p) => `${p.source}->${p.target}`

// Set difference keyed on the full table sequence, not individual tables.
const setDelta = (got, want) => {
  const gotKeys = new Set(got.map(key))
  const wantKeys = new Set(want.map(key))
  return {
    dropped: want.map((r, i) => ({ r, rank: i + 1 })).filter(({ r }) => !gotKeys.has(key(r))),
    added: got.map((r, i) => ({ r, rank: i + 1 })).filter(({ r }) => !wantKeys.has(key(r))),
  }
}

const printDelta = (p, d, updating) => {
  console.log(`POOL SET CHANGE ${label(p)}: ${d.dropped.length} dropped, ${d.added.length} added`)
  for (const { r, rank } of d.dropped) console.log(`  dropped: ${fmt(r)}   (was rank ${rank})`)
  for (const { r, rank } of d.added) console.log(`  added:   ${fmt(r)}   (now rank ${rank})`)
  if (updating) {
    console.log('  Accepting this composition change into the new baseline — the above paths are')
    console.log('  what --update is discarding/admitting, not a reorder.')
  } else {
    console.log('  A path can leave the top-N without being outranked: the pool is a budget-limited')
    console.log('  DFS sample, so a tableDef can change sweep order and evict a better path before')
    console.log('  the comparator sees it. Verify this is intended before running --update.')
  }
}

if (UPDATE) {
  for (const gp of generated.pairs) {
    const exp = findPair(gp)
    if (!exp) {
      console.log(`new pair ${label(gp)} (no previous baseline)`)
      continue
    }
    const d = setDelta(gp.results, exp.results)
    if (d.dropped.length || d.added.length) printDelta(gp, d, true)
  }
  writeFileSync(GOLDEN, JSON.stringify(generated, null, 2) + '\n')
  console.log(`wrote ${GOLDEN}`)
  process.exit(0)
}

if (!golden) {
  console.error('golden-results.json missing. Run: node tests/golden-test.mjs --update')
  process.exit(1)
}

let failures = 0
let poolChanges = 0
for (const gp of generated.pairs) {
  const exp = findPair(gp)
  if (!exp) {
    failures++
    console.log(`FAIL no golden entry for ${label(gp)}@${gp.maxHops}`)
    continue
  }
  const got = gp.results
  const want = exp.results
  const d = setDelta(got, want)

  if (d.dropped.length || d.added.length) {
    failures++
    poolChanges++
    printDelta(gp, d, false)
    continue
  }

  // Same set: report position moves and any score/class/reason drift on paths
  // present in both, so a real regression is never masked by the set logic.
  const gotRank = new Map(got.map((r, i) => [key(r), i + 1]))
  const moved = want
    .map((r, i) => ({ k: key(r), from: i + 1, to: gotRank.get(key(r)) }))
    .filter((m) => m.from !== m.to)
  const drifted = want
    .map((r, i) => ({ r, rank: i + 1 }))
    .filter(({ r }) => {
      const g = got.find((x) => key(x) === key(r))
      return (
        Math.abs(g.score - r.score) >= 0.5e-6 ||
        g.qualityClass !== r.qualityClass ||
        JSON.stringify(g.reasonCodes) !== JSON.stringify(r.reasonCodes)
      )
    })

  if (moved.length || drifted.length) {
    failures++
    console.log(`REORDER ${label(gp)}: set identical, ${moved.length} position(s) moved`)
    for (const m of moved) console.log(`  rank ${m.from} -> ${m.to}  ${m.k}`)
    for (const { r, rank } of drifted) {
      const g = got.find((x) => key(x) === key(r))
      console.log(`  score/class/reasons changed at rank ${rank}: got ${fmt(g)} want ${fmt(r)}`)
    }
    continue
  }

  console.log(`ok   ${label(gp)} (top-${got.length} identical)`)
}

if (failures) {
  const note = poolChanges
    ? `, ${poolChanges} of them POOL SET CHANGE — pool composition moved, not just ordering`
    : ''
  console.log(`\n${failures} golden mismatch(es)${note}.`)
  process.exit(1)
}
console.log('\nGolden test passes: JS output matches committed golden-results.json.')
