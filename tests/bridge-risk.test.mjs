#!/usr/bin/env node
/**
 * Gate for the bridge-risk rule: it must warn on the real hazard and stay
 * silent on the legitimate bridge.
 *
 *   WARN : SalesTable > Currency > CustTrans      (same-field cartesian)
 *   SILENT : SalesLine > InventTransOrigin > InventTrans  (RecId in, InventTransId out)
 *
 * Run: node tests/bridge-risk.test.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const ROOT = join(import.meta.dirname, '..')
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => JSON.parse(readFileSync(join(ROOT, 'static/data/graph-compact.json'), 'utf8')),
})

const { loadGraph, findPaths, setFlowCohorts, setFlowStages } = await import(join(ROOT, 'src/lib/pathEngine.js'))

// scope + stages, same as the app
const src = readFileSync(join(ROOT, 'src/lib/data/flows.ts'), 'utf8')
const FLAGSHIP = ['otc', 'p2p', 'ptp', 'inv', 'proj', 'rtr']
const marks = [...src.matchAll(/^    id: '([^']+)',$/gm)].map((m) => ({ id: m[1], at: m.index }))
const SCOPE = new Set()
const COHORTS = new Map()
const STAGES = new Map()
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
      if (!COHORTS.has(n)) COHORTS.set(n, stage)
      if (!STAGES.has(n)) STAGES.set(n, { flow: marks[i].id, stage })
    }
  }
}
await loadGraph()
setFlowCohorts(COHORTS)
setFlowStages(STAGES)

let pass = 0
const check = (name, fn) => {
  try {
    fn()
    pass++
    console.log(`ok   ${name}`)
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`)
    process.exitCode = 1
  }
}

check('SalesTable>Currency>CustTrans warns same-field-cartesian', () => {
  const r = findPaths('SalesTable', 'CustTrans', { maxHops: 2, scope: SCOPE, rankBy: 'evidence' })
  const hit = r.results.find((x) => x.key === 'SalesTable>Currency>CustTrans')
  assert.ok(hit, 'the currency-bridge path must be in the result set')
  const br = hit.bridges?.find((b) => b.table === 'Currency')
  assert.ok(br, 'Currency hop must be flagged')
  assert.equal(br.reason, 'same-field-cartesian')
  assert.match(String(br.field).toLowerCase(), /currency/)
})

check('SalesLine>InventTransOrigin>InventTrans stays silent', () => {
  const r = findPaths('SalesLine', 'InventTrans', { maxHops: 3, scope: SCOPE, rankBy: 'evidence' })
  const hit = r.results.find((x) => x.key === 'SalesLine>InventTransOrigin>InventTrans')
  assert.ok(hit, 'the arbitrated path must be in the result set')
  const br = hit.bridges?.find((b) => b.table === 'InventTransOrigin')
  assert.ok(!br, `InventTransOrigin must NOT be flagged, got ${JSON.stringify(br)}`)
})

check('CashDisc bridge (same code field) warns', () => {
  const r = findPaths('SalesTable', 'CustTrans', { maxHops: 2, scope: SCOPE, rankBy: 'evidence' })
  const hit = r.results.find((x) => x.key === 'SalesTable>CashDisc>CustTrans')
  if (!hit) return // not reachable in this scope; nothing to assert
  const br = hit.bridges?.find((b) => b.table === 'CashDisc')
  assert.ok(br, 'CashDisc hop must be flagged')
})

check('canonical pinned rows are exempt from noise: pin row renders without mandatory bridge flag', () => {
  // The canonical chain for this pair is CustInvoiceJour — must not warn.
  const r = findPaths('SalesTable', 'CustTrans', { maxHops: 2, scope: SCOPE, rankBy: 'evidence' })
  const hit = r.results.find((x) => x.key === 'SalesTable>CustInvoiceJour>CustTrans')
  assert.ok(hit)
  assert.ok(!hit.bridges?.length, `canonical chain must not warn, got ${JSON.stringify(hit.bridges)}`)
})


check('canonical chain survives minTier=A even when it contains a C/D hop', () => {
  // Measured 2026-11-19: 10 of 37 arbitrated chains contain a C or D hop, so a
  // strict minTier deleted the canonical answer for those pairs and left only
  // inferred rows. minTier filters EVIDENCE; an arbitrated chain is pinned for a
  // different reason and must not be filtered out of existence.
  const chain = ['SalesTable', 'CustInvoiceJour', 'CustTrans'] // tiers D,A
  const r = findPaths('SalesTable', 'CustTrans', {
    scope: SCOPE,
    maxHops: 4,
    maxResults: 50,
    minTier: 'A',
    rankBy: 'canonical',
    canonicalChains: [chain],
  })
  const hit = r.results.find((x) => x.key === chain.join('>'))
  assert.ok(hit, 'canonical chain must still be present under minTier=A')
  assert.equal(hit.canonical, true)
  assert.equal(r.results[0].key, chain.join('>'), 'and still pinned first')
})

check('a chain with an undeclared hop is rejected, not partially rendered', () => {
  const bogus = ['SalesTable', 'CustTrans', 'InventTable'] // CustTrans->InventTable not declared
  const r = findPaths('SalesTable', 'InventTable', {
    scope: SCOPE,
    maxHops: 4,
    maxResults: 10,
    minTier: 'D',
    rankBy: 'evidence',
    canonicalChains: [bogus],
  })
  assert.ok(
    !r.results.some((x) => x.key === bogus.join('>')),
    'an invalid canonical chain must never be rendered'
  )
})


check('a declared direct relation is never hidden by minTier', () => {
  // Measured defect 2026-11-19: SalesLine->SalesTable is a declared relation
  // (tier C on InventRefId, tier D on SalesId). With minTier:'A' the one-hop
  // answer vanished and the engine returned six 2-hop detours, two of them
  // cartesian. A direct relation IS the answer; the tier filter must not delete
  // it, and it must rank first.
  for (const minTier of ['A', 'B', 'C', 'D']) {
    const r = findPaths('SalesLine', 'SalesTable', { scope: SCOPE, maxHops: 2, maxResults: 10, minTier, rankBy: 'canonical' })
    const direct = r.results.find((x) => x.hops === 1)
    assert.ok(direct, `minTier=${minTier} must still return the direct relation`)
    assert.equal(r.results[0].key, direct.key, `minTier=${minTier} must rank the direct relation first`)
    assert.equal(r.shortest, 1, `minTier=${minTier} shortest must be 1`)
  }
})

check('minTier still gates hops inside a multi-hop route', () => {
  // The exemption is only for a DIRECT hop to the target; a weak hop in the
  // middle of a longer chain must still be excluded.
  const strict = findPaths('SalesTable', 'CustTrans', { scope: SCOPE, maxHops: 3, maxResults: 50, minTier: 'A', rankBy: 'evidence' })
  for (const r of strict.results) {
    if (r.hops === 1) continue
    for (const s of r.steps) if (s.tier) assert.equal(s.tier, 'A', `tier ${s.tier} survived minTier=A inside a ${r.hops}-hop route`)
  }
})

check('every result carries a bridges array (shape contract)', () => {
  const r = findPaths('SalesTable', 'CustTrans', { maxHops: 4, maxResults: 25, scope: SCOPE, rankBy: 'evidence' })
  for (const x of r.results) assert.ok(Array.isArray(x.bridges), 'bridges must always be an array')
})

console.log(`\nbridge-risk gate: ${pass} passed`)
process.exit(process.exitCode ?? 0)
