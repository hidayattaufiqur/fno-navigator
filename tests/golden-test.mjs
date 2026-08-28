// JS golden test (Q5/Q11 parity): runs the golden pairs and compares the
// top-50 table sequences, scores (6 decimals), qualityClass and reason codes
// against tests/golden-results.json, which is the cross-language contract —
// the Python suite (fno-dev-copilot-spike/server/tests/golden_test.py)
// asserts the same file against the Python implementation, so JS ≡ Python
// transitively.
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

if (UPDATE) {
  writeFileSync(GOLDEN, JSON.stringify(generated, null, 2) + '\n')
  console.log(`wrote ${GOLDEN}`)
  process.exit(0)
}

let golden
try {
  golden = JSON.parse(readFileSync(GOLDEN, 'utf8'))
} catch {
  console.error('golden-results.json missing. Run: node tests/golden-test.mjs --update')
  process.exit(1)
}

let failures = 0
for (const gp of generated.pairs) {
  const exp = golden.pairs.find(
    (g) => g.source === gp.source && g.target === gp.target && g.maxHops === gp.maxHops && g.maxResults === gp.maxResults
  )
  if (!exp) {
    failures++
    console.log(`FAIL no golden entry for ${gp.source}->${gp.target}@${gp.maxHops}`)
    continue
  }
  const got = gp.results
  const want = exp.results
  let pairFail = false
  if (got.length !== want.length) {
    pairFail = true
    console.log(`FAIL ${gp.source}->${gp.target}: result count ${got.length} != golden ${want.length}`)
  }
  const n = Math.min(got.length, want.length)
  for (let i = 0; i < n; i++) {
    const g = got[i]
    const w = want[i]
    const seqOk = g.tables.join('>') === w.tables.join('>')
    const scoreOk = Math.abs(g.score - w.score) < 0.5e-6
    const classOk = g.qualityClass === w.qualityClass
    const reasonsOk = JSON.stringify(g.reasonCodes) === JSON.stringify(w.reasonCodes)
    if (!seqOk || !scoreOk || !classOk || !reasonsOk) {
      pairFail = true
      console.log(`FAIL ${gp.source}->${gp.target} rank ${i + 1}: got ${g.tables.join('>')} ${g.score} c${g.qualityClass} [${g.reasonCodes.join(',')}] want ${w.tables.join('>')} ${w.score} c${w.qualityClass} [${w.reasonCodes.join(',')}]`)
      if (failures++ > 5) break
    }
  }
  if (!pairFail) console.log(`ok   ${gp.source}->${gp.target} (top-${got.length} identical)`)
}

if (failures) {
  console.log(`\n${failures} golden mismatch(es).`)
  process.exit(1)
}
console.log('\nGolden test passes: JS output matches committed golden-results.json.')
