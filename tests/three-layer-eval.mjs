#!/usr/bin/env node
/**
 * 3-layer evaluation: relation class → canonical pin → inferred.
 *
 * Gates (agreed 2026-11-19):
 *   G1  every canonical chain renders #1 in BOTH directions
 *   G2  a declared direct relation is never outranked by a multi-hop detour
 *   G3  a header→line relation ranks #1 even when it is tier C/D
 *   G4  no canonical chain is missing from its own result set
 *
 * Run: node --max-old-space-size=4096 tests/three-layer-eval.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => JSON.parse(readFileSync(join(ROOT, 'static/data/graph-compact.json'), 'utf8')),
})
const m = await import(join(ROOT, 'src/lib/pathEngine.js'))

// ── scope + stages, mirroring the page ────────────────────────────────────
const src = readFileSync(join(ROOT, 'src/lib/data/flows.ts'), 'utf8')
const FLAGSHIP = ['otc', 'p2p', 'ptp', 'inv', 'proj', 'rtr']
const marks = [...src.matchAll(/^    id: '([^']+)',$/gm)].map((x) => ({ id: x[1], at: x.index }))
const SCOPE = new Set()
const COH = new Map()
const STG = new Map()
for (let i = 0; i < marks.length; i++) {
  if (!FLAGSHIP.includes(marks[i].id)) continue
  const end = marks[i + 1] ? marks[i + 1].at : src.length
  let st = 0
  for (const t of src.slice(marks[i].at, end).matchAll(/tables:\s*\[([^\]]+)\]/g)) {
    const stage = st++
    for (const r of t[1].split(',')) {
      const n = r.trim().replace(/^['"]|['"]$/g, '')
      if (!n) continue
      SCOPE.add(n)
      if (!COH.has(n)) COH.set(n, stage)
      if (!STG.has(n)) STG.set(n, { flow: marks[i].id, stage })
    }
  }
}
await m.loadGraph()
m.setFlowCohorts(COH)
m.setFlowStages(STG)

const pairs = JSON.parse(readFileSync(join(ROOT, 'static/data/canonical-fixtures.json'), 'utf8')).pairs
const chainFor = (a, b) => {
  const p = pairs.find((x) => x.source === a && x.target === b)
  return p ? [p.canonical] : null
}

let fail = 0
const gate = (name, ok, detail = '') => {
  if (!ok) {
    fail++
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
  return ok
}

// ── G1: canonical chain is #1 in both directions ──────────────────────────
let g1 = 0
const g1bad = []
for (const p of pairs) {
  const key = p.canonical.join('>')
  for (const rankBy of ['canonical', 'evidence']) {
    const r = m.findPaths(p.source, p.target, {
      scope: SCOPE,
      maxHops: 4,
      maxResults: 50,
      minTier: 'A',
      rankBy,
      canonicalChains: chainFor(p.source, p.target),
    })
    const at = r.results.findIndex((x) => x.key === key)
    if (at === 0) g1++
    else g1bad.push(`${p.source}->${p.target} [${rankBy}] at ${at < 0 ? 'ABSENT' : '#' + (at + 1)}`)
  }
}
gate('G1 canonical chain ranks #1 both directions', g1bad.length === 0, g1bad.slice(0, 5).join(' | '))
console.log(`G1  ${g1}/${pairs.length * 2} (74 pairs x 2 rankers) canonical-first`)

// ── G2: declared direct relation never outranked by a detour ──────────────
let g2checked = 0
const g2bad = []
for (const p of pairs) {
  const r = m.findPaths(p.source, p.target, { scope: SCOPE, maxHops: 4, maxResults: 50, minTier: 'A', rankBy: 'evidence' })
  const direct = r.results.filter((x) => x.hops === 1)
  if (!direct.length) continue
  g2checked++
  if (r.results[0].hops !== 1) g2bad.push(`${p.source}->${p.target} top is ${r.results[0].hops} hops`)
}
gate('G2 direct relation outranks detours', g2bad.length === 0, g2bad.slice(0, 5).join(' | '))
console.log(`G2  ${g2checked} pairs with a direct relation, ${g2checked - g2bad.length} correct`)

// ── G3: header→line ranks #1 even when tier C/D ───────────────────────────
const HL = [
  ['SalesLine', 'SalesTable'],
  ['SalesTable', 'SalesLine'],
  ['PurchLine', 'PurchTable'],
  ['PurchTable', 'PurchLine'],
  ['ProdTable', 'ProdRoute'],
  ['ProdRoute', 'ProdTable'],
  ['LedgerJournalTrans', 'LedgerJournalTable'],
  ['LedgerJournalTable', 'LedgerJournalTrans'],
]
let g3 = 0
const g3bad = []
for (const [a, b] of HL) {
  const r = m.findPaths(a, b, { scope: SCOPE, maxHops: 4, maxResults: 50, minTier: 'A', rankBy: 'evidence' })
  const top = r.results[0]
  if (!top) { g3bad.push(`${a}->${b} no results`); continue }
  if (top.hops === 1 && top.relationClass === 'header-line') g3++
  else g3bad.push(`${a}->${b} top=${top.key} hops=${top.hops} class=${top.relationClass ?? 'none'}`)
}
gate('G3 header/line relation ranks #1 regardless of tier', g3bad.length === 0, g3bad.join(' | '))
console.log(`G3  ${g3}/${HL.length} header/line pairs correct`)

// ── G4: canonical chain present in its own result set ─────────────────────
let g4bad = []
for (const p of pairs) {
  const key = p.canonical.join('>')
  const r = m.findPaths(p.source, p.target, {
    scope: SCOPE,
    maxHops: 4,
    maxResults: 50,
    minTier: 'A',
    rankBy: 'canonical',
    canonicalChains: chainFor(p.source, p.target),
  })
  if (!r.results.some((x) => x.key === key)) g4bad.push(`${p.source}->${p.target}`)
}
gate('G4 canonical chain always present', g4bad.length === 0, g4bad.slice(0, 5).join(' | '))
console.log(`G4  ${pairs.length - g4bad.length}/${pairs.length} present`)

// ── coverage by relation class ────────────────────────────────────────────
let viaClass = 0
let viaPin = 0
let viaInferred = 0
for (const p of pairs) {
  const r = m.findPaths(p.source, p.target, {
    scope: SCOPE,
    maxHops: 4,
    maxResults: 50,
    minTier: 'A',
    rankBy: 'canonical',
    canonicalChains: chainFor(p.source, p.target),
  })
  const top = r.results[0]
  if (!top) continue
  if (top.relationClass === 'header-line') viaClass++
  else if (top.canonical) viaPin++
  else viaInferred++
}
console.log(`\nlayer distribution of top-1: relation-class ${viaClass} · canonical-pin ${viaPin} · inferred ${viaInferred}`)

console.log(fail === 0 ? '\nALL GATES PASSED' : `\n${fail} gate(s) failed`)
process.exit(fail === 0 ? 0 : 1)
