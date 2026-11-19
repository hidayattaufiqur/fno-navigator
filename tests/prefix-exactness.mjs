#!/usr/bin/env node
/**
 * THE GATE. `maxResults: 50` must be an ordered prefix of `maxResults: 200`.
 *
 * This is the property that decides whether the engine's top-k is trustworthy.
 * If a smaller k returns paths a larger k does not, then which paths exist
 * depends on how many were asked for — the defect that shipped once already and
 * that the whole scoped-exhaustive rewrite exists to make structurally impossible.
 *
 * It must stay green. Any future optimisation (prune, heuristic, budget, early
 * exit) has to pass this before it can land, because every one of those
 * constructs failed it before.
 *
 * Run: node --max-old-space-size=4096 tests/prefix-exactness.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => JSON.parse(readFileSync(join(ROOT, 'static/data/graph-compact.json'), 'utf8')),
})
const { loadGraph, findPaths, setFlowCohorts, setFlowStages } = await import(join(ROOT, 'src/lib/pathEngine.js'))

// ── flagship scope + stage map, mirroring what the page builds ─────────────
const src = readFileSync(join(ROOT, 'src/lib/data/flows.ts'), 'utf8')
const FLAGSHIP = ['otc', 'p2p', 'ptp', 'inv', 'proj', 'rtr']
const marks = [...src.matchAll(/^    id: '([^']+)',$/gm)].map((m) => ({ id: m[1], at: m.index }))
const cohorts = new Map()
const stages = new Map()
const scope = new Set()
for (let i = 0; i < marks.length; i++) {
  const flow = marks[i].id
  if (!FLAGSHIP.includes(flow)) continue
  const end = marks[i + 1] ? marks[i + 1].at : src.length
  let stage = 0
  for (const t of src.slice(marks[i].at, end).matchAll(/tables:\s*\[([^\]]+)\]/g)) {
    const st = stage++
    for (const r of t[1].split(',')) {
      const n = r.trim().replace(/^['"]|['"]$/g, '')
      if (!n) continue
      scope.add(n)
      if (!cohorts.has(n)) cohorts.set(n, st)
      if (!stages.has(n)) stages.set(n, { flow, stage: st })
    }
  }
}

await loadGraph()
setFlowCohorts(cohorts)
setFlowStages(stages)

const canonical = JSON.parse(readFileSync(join(HERE, 'canonical-fixtures.json'), 'utf8')).pairs
const chainsFor = (a, b) => canonical.filter((p) => p.source === a && p.target === b).map((p) => p.canonical)

const PAIRS = [
  ['SalesTable', 'CustTrans'],
  ['CustTrans', 'LedgerJournalTrans'],
  ['InventTable', 'CustTable'],
  ['SalesLine', 'TaxTable'],
  ['PurchLine', 'SalesLine'],
  ['SalesTable', 'SalesLine'],
  ['InventTable', 'InventDim'],
  ['MainAccount', 'LedgerJournalTrans'],
]
const SMALL = 50
const BIG = 200

let fail = 0
for (const rankBy of ['canonical', 'evidence']) {
  for (const [a, b] of PAIRS) {
    const opts = { maxHops: 4, rankBy, scope, canonicalChains: chainsFor(a, b) }
    const big = findPaths(a, b, { ...opts, maxResults: BIG })
    const small = findPaths(a, b, { ...opts, maxResults: SMALL })
    let diffs = 0
    let first = ''
    for (let i = 0; i < small.results.length; i++) {
      const x = big.results[i]
      const y = small.results[i]
      if (!x || x.key !== y.key || x.cost !== y.cost) {
        diffs++
        if (!first) first = `@${i} big=${x ? `${x.key}@${x.cost}` : 'none'} small=${y.key}@${y.cost}`
      }
    }
    if (diffs) fail++
    console.log(
      `${diffs ? 'DIFF' : 'ok  '} ${rankBy.padEnd(9)} ${(a + '->' + b).padEnd(32)} k50=${String(small.results.length).padStart(3)} k200=${String(big.results.length).padStart(3)} enum=${String(big.enumerated).padStart(6)} ${first}`
    )
  }
}

// Determinism: same query twice must be byte-identical.
const once = findPaths('SalesTable', 'CustTrans', { maxHops: 4, rankBy: 'canonical', scope }).results.map((r) => r.key)
const twice = findPaths('SalesTable', 'CustTrans', { maxHops: 4, rankBy: 'canonical', scope }).results.map((r) => r.key)
const deterministic = once.length === twice.length && once.every((k, i) => k === twice[i])
console.log(`\ndeterminism: ${deterministic ? 'ok  ' : 'FAIL'} identical output across two calls`)
if (!deterministic) fail++

if (fail === 0) {
  console.log('\nEXACT: k=50 is an ordered prefix of k=200 on every pair, both rankers')
  process.exit(0)
}
console.log(`\nFAIL: ${fail} violation(s)`)
process.exit(1)
