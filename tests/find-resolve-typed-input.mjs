// Verbatim check: resolveTypedTable in src/routes/find/+page.svelte must accept a
// typed table name only on an EXACT case-insensitive match. A prefix is the
// dropdown's job; a typo must fail loudly rather than search a different table.
//
// Stated limit: this proves the matching rule, not that handleFind/handleInputKey
// call it — those call sites are verified by hand (see docs/specs/
// pr2-find-resolve-typed-inputs.md).
//
// Usage: node tests/find-resolve-typed-input.mjs
// Exit code 0 = resolver behaves. Non-zero = list of failures.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const page = readFileSync(join(root, 'src/routes/find/+page.svelte'), 'utf8')

// Pull the function source out of the page and evaluate it against a fixed table
// sample, so this test needs no Svelte compiler and no browser.
const match = page.match(/function resolveTypedTable\(input\) \{[\s\S]*?\n  \}/)
if (!match) {
  console.error('FAIL: resolveTypedTable(input) not found in src/routes/find/+page.svelte')
  process.exit(1)
}

const allKnownTables = ['PurchTable', 'VendTable', 'CustTable', 'PurchLine', 'VendTrans']
const resolveTypedTable = new Function('allKnownTables', `${match[0]}\nreturn resolveTypedTable`)(allKnownTables)

const CASES = [
  ['PurchTable', 'PurchTable'], // exact
  ['  purchtable  ', 'PurchTable'], // padded + lowercase
  ['PurchTabl', ''], // near-miss typo must fail
  ['Purch', ''], // prefix is the dropdown's job
  ['', ''],
]

let failed = 0
for (const [input, expected] of CASES) {
  const actual = resolveTypedTable(input)
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(input).padEnd(18)} -> ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

if (failed === 0) {
  console.log('\nRESOLVE: exact case-insensitive match only; typos and prefixes return empty')
  process.exit(0)
}
console.log(`\nFAIL: ${failed} violation(s)`)
process.exit(1)
