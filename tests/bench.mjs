// Perf benchmark (Q10): unique-mode p95 must stay <= 300ms on the fixture
// pairs, using the cached-map harness (module-level forward/reverse maps —
// never an uncached stub; see the F2 warning). The nexts cache in the
// pathfinder is per-call; the degree/documentation caches are module-level
// and warm up on the first query.
//
//   node tests/bench.mjs
//
// Exit code 0 = p95 within budget.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { findPaths } from './harness.mjs'

const ROOT = join(import.meta.dirname, '..')
const FIXTURES = JSON.parse(readFileSync(join(ROOT, 'static/data/path-fixtures.json'), 'utf8'))

const BUDGET_MS = 300
const RUNS = 7

// Warm up the module-level caches (degrees, documented set) before timing.
findPaths('InventTable', 'CustTable', 4, { sort: 'unique' })

const samples = [] // {id, ms}
for (const f of FIXTURES.pairs) {
  if ((f.mode ?? 'unique') !== 'unique') continue
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now()
    findPaths(f.source, f.target, f.maxHops, { sort: 'unique' })
    const ms = performance.now() - t0
    samples.push({ id: f.id, ms })
  }
}

samples.sort((a, b) => a.ms - b.ms)
const p95 = samples[Math.min(samples.length - 1, Math.ceil(0.95 * samples.length) - 1)].ms
const worst = samples[samples.length - 1]

// per-pair worst for the report
const byPair = new Map()
for (const s of samples) {
  if (!byPair.has(s.id) || s.ms > byPair.get(s.id)) byPair.set(s.id, s.ms)
}

console.log(`bench: ${FIXTURES.pairs.filter((f) => (f.mode ?? 'unique') === 'unique').length} unique-mode fixtures x ${RUNS} runs = ${samples.length} samples`)
console.log(`p95: ${p95.toFixed(1)}ms   worst: ${worst.ms.toFixed(1)}ms (${worst.id})   budget: ${BUDGET_MS}ms`)
console.log('per-pair worst:')
for (const [id, ms] of [...byPair.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${ms.toFixed(1).padStart(7)}ms  ${id}`)
}

if (p95 > BUDGET_MS) {
  console.log(`\nFAIL: p95 ${p95.toFixed(1)}ms exceeds budget ${BUDGET_MS}ms.`)
  process.exit(1)
}
console.log(`\nPASS: p95 ${p95.toFixed(1)}ms within ${BUDGET_MS}ms budget.`)
