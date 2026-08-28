// Assert the fixture suite against the live pathfinder (Q9/Q14: CI-asserted
// top-K surfacing). Every mustSurface path must appear within `bar`
// (default top-10) of the given mode; every mustNotSurface path must NOT
// appear within it; classExpect asserts qualityClass bounds (min/max) on
// surfaced paths. Named asserts implement the extra quality gates
// (single-subtree, sane top, payment noise).
//
//   node tests/assert-fixtures.mjs
//
// Exit code 0 = all assertions pass. Any failure prints the actual rank and
// the top-10 for that pair.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findPaths } from './harness.mjs'

const ROOT = join(import.meta.dirname, '..')
const FIXTURES = JSON.parse(readFileSync(join(ROOT, 'static/data/path-fixtures.json'), 'utf8'))

// Undirected existence check (for bar='existence' fixtures): every mustSurface
// path must be a valid chain in the dataset — the surfacing contract is that
// the fixture file powers the UI's canonical-path hints, so the path must
// exist for the hint to be truthful.
const fwd = JSON.parse(readFileSync(join(ROOT, 'static/data/fk-map.json'), 'utf8'))
const rev = {}
for (const [parent, children] of Object.entries(fwd)) {
  for (const [child, parentField, childField] of children) {
    if (!rev[child]) rev[child] = []
    rev[child].push([parent, parentField, childField])
  }
}
function edgeExists(a, b) {
  const out = []
  for (const [child, pf, cf] of fwd[a] ?? []) if (child === b) out.push([a, pf, b, cf])
  for (const [parent, pf, cf] of rev[a] ?? []) if (parent === b) out.push([a, cf, b, pf])
  return out
}

// --- named asserts -----------------------------------------------------------

/** Currency->CompanyInfo top-10 must not all route through one subtree. */
function assertTop10NotSingleSubtree(results) {
  const top10 = results.slice(0, 10)
  if (top10.length < 2) return { ok: true } // nothing to diversify
  const firstHops = new Set(top10.map((r) => r.steps[1]?.table))
  return firstHops.size >= 2
    ? { ok: true }
    : { ok: false, detail: `all top-10 share first hop ${[...firstHops].join(', ')} (single subtree)` }
}

const PLUMBING_PATTERN = /Tmp|Dimension|Statistics|Totaling|Snapshot|BIAnalysis|Printout|Buffer|WorkTable|Parm|ForProcessing/

// Top-10 must contain no Tmp-star / Dimension-star plumbing intermediates
// and the top score must be positive.
function assertTop10Sane(results) {
  const top10 = results.slice(0, 10)
  const problems = []
  if (top10[0]?.score <= 0) problems.push(`top score ${top10[0]?.score} is not positive`)
  for (const [i, r] of top10.entries()) {
    const inter = r.steps.slice(1, -1).map((s) => s.table)
    const dirty = inter.filter((t) => PLUMBING_PATTERN.test(t))
    if (dirty.length) problems.push(`rank ${i + 1} has plumbing intermediate(s): ${dirty.join(', ')}`)
  }
  return problems.length ? { ok: false, detail: problems.join('; ') } : { ok: true }
}

/** Top-10 must not be dominated by payment-posting noise tables. */
const PAYMENT_NOISE = new Set([
  'CustTrans', 'VendTrans', 'LedgerTrans', 'TaxTrans', 'SpecTrans',
  'CustSettlement', 'VendSettlement', 'LedgerJournalTrans',
  'GeneralJournalEntry', 'GeneralJournalAccountEntry',
])
function assertTop10NoPaymentNoise(results) {
  const top10 = results.slice(0, 10)
  const hits = []
  for (const [i, r] of top10.entries()) {
    const noise = r.steps.filter((s) => PAYMENT_NOISE.has(s.table))
    if (noise.length) hits.push(`rank ${i + 1} contains ${noise.map((s) => s.table).join(',')}`)
  }
  if (hits.length >= 3) return { ok: false, detail: `payment noise in ${hits.length}/10 of top-10: ${hits.slice(0, 3).join('; ')}` }
  return { ok: true }
}

const ASSERT_IMPL = {
  'top10-not-single-subtree': assertTop10NotSingleSubtree,
  'top10-sane': assertTop10Sane,
  'top10-no-payment-noise': assertTop10NoPaymentNoise,
}

/** Ghost-table guard: TaxItemGroupData must never appear in fk-map.json. */
function assertNoGhostTaxItemGroupData() {
  const ghost = 'TaxItemGroupData'
  const where = []
  if (ghost in fwd) where.push('forward-map key (parent)')
  if (rev[ghost]) where.push('child-table entry')
  return where.length
    ? { ok: false, detail: `ghost table ${ghost} present in fk-map.json as ${where.join(' and ')} — hallucinated name; the real line table is TaxOnItem` }
    : { ok: true }
}

/**
 * Posted-tax invariant: top-5 must contain a path SalesLine >
 * SourceDocumentLine > TaxTrans > [any leaf] > TaxTable. The leaf table is
 * expected to vary across map regenerations (TaxJurisdiction ranked 1 on the
 * old map; TaxTransExtensionTH is the current best), so only the TaxTrans
 * prefix + TaxTable suffix are pinned.
 */
function assertTop5TaxPostedPath(results) {
  const top5 = results.slice(0, 5)
  for (const r of top5) {
    const steps = r.steps.map((s) => s.table)
    if (
      steps.length >= 4 &&
      steps[0] === 'SalesLine' &&
      steps[1] === 'SourceDocumentLine' &&
      steps[2] === 'TaxTrans' &&
      steps[steps.length - 1] === 'TaxTable'
    ) {
      return { ok: true }
    }
  }
  return {
    ok: false,
    detail: `no top-5 path matches SalesLine>SourceDocumentLine>TaxTrans>*>TaxTable; got: ${top5.map((r) => r.steps.map((s) => s.table).join('>')).join(' | ')}`,
  }
}

ASSERT_IMPL['no-ghost-taxitemgroupdata'] = assertNoGhostTaxItemGroupData
ASSERT_IMPL['top5-taxposted-path'] = assertTop5TaxPostedPath

// --- run ---------------------------------------------------------------------

let failures = 0
for (const f of FIXTURES.pairs) {
  const res = findPaths(f.source, f.target, f.maxHops, { sort: f.mode ?? 'unique' })
  const barRaw = String(f.bar ?? 'top-10')
  const bar = barRaw === 'existence' ? null : (barRaw === 'top-10' ? 10 : Number.parseInt(barRaw.replace('top-', ''), 10) || 10)
  const top = bar === null ? [] : res.results.slice(0, bar)
  const problems = []

  for (const must of f.mustSurface ?? []) {
    const seq = must.join('>')
    if (bar === null) {
      // Existence + surfacing contract: the path must be a valid chain in the
      // dataset (the UI renders it from this fixture file as a canonical-path
      // hint / pinned row). No top-N rank is required.
      for (let i = 0; i < must.length - 1; i++) {
        if (!edgeExists(must[i], must[i + 1]).length) {
          problems.push(`mustSurface ${seq}: edge missing in dataset (${must[i]} -- ${must[i + 1]})`)
        }
      }
      continue
    }
    const rank = top.findIndex((r) => r.steps.map((s) => s.table).join('>') === seq)
    if (rank === -1) {
      problems.push(`mustSurface ${seq} NOT in top-${bar} (shortest=${res.shortest}, truncated=${res.truncated} ${JSON.stringify(res.truncation)})`)
    }
  }
  // Negative surfacing (Q14): mustNotSurface paths must NOT appear in top-N.
  for (const mustNot of f.mustNotSurface ?? []) {
    const seq = mustNot.join('>')
    const rank = top.findIndex((r) => r.steps.map((s) => s.table).join('>') === seq)
    if (rank !== -1) {
      problems.push(`mustNotSurface ${seq} IS in top-${bar} at rank ${rank + 1} (class ${top[rank].qualityClass})`)
    }
  }
  // qualityClass bounds (Q1/Q5): asserted on surfaced result rows.
  for (const ce of f.classExpect ?? []) {
    const seq = ce.path.join('>')
    const idx = top.findIndex((r) => r.steps.map((s) => s.table).join('>') === seq)
    if (idx === -1) continue // rank assertions above already flag absence
    const cls = top[idx].qualityClass
    if (ce.min !== undefined && cls < ce.min) {
      problems.push(`classExpect ${seq}: class ${cls} < min ${ce.min}`)
    }
    if (ce.max !== undefined && cls > ce.max) {
      problems.push(`classExpect ${seq}: class ${cls} > max ${ce.max}`)
    }
  }
  for (const a of f.asserts ?? []) {
    const impl = ASSERT_IMPL[a]
    if (!impl) {
      problems.push(`unknown assert: ${a}`)
      continue
    }
    const verdict = impl(res.results)
    if (!verdict.ok) problems.push(`assert ${a}: ${verdict.detail}`)
  }

  if (problems.length) {
    failures++
    console.log(`FAIL ${f.id} (${f.source}->${f.target}, ${f.mode ?? 'unique'}, maxHops=${f.maxHops}):`)
    for (const p of problems) console.log(`   - ${p}`)
    console.log('   top results:')
    for (const [i, r] of res.results.slice(0, bar).entries()) {
      console.log(`     ${i + 1}. ${r.score.toFixed(3)}  ${r.steps.map((s) => s.table).join('>')}`)
    }
  } else {
    console.log(`ok   ${f.id}`)
  }
}

console.log(`\n${FIXTURES.pairs.length} fixtures asserted.`)
if (failures) {
  console.log(`${failures} fixture(s) FAILED.`)
  process.exit(1)
}
console.log('All fixtures pass.')
