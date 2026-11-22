// Guards against the duplicate-derivation bug that shipped two different table counts
// (sidebar 213, /tables 215). The population lives once, in flows.ts; every UI count
// must read it rather than re-deriving from a subset.
//
//   node tests/table-count-single-source.mjs
//
// Stated limit: these are text assertions over source, not retrieval proof. They fail
// when a count gets re-derived, not when the rendered number is wrong — the rendered
// number is verified by hand (sidebar, /tables heading, home stat all read the same).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const flows = read('src/lib/data/flows.ts')
const layout = read('src/routes/+layout.svelte')
const home = read('src/routes/+page.svelte')
const tables = read('src/routes/tables/+page.svelte')

const failures = []
const fail = (msg) => failures.push(msg)
const has = (src, needle) => src.includes(needle)

// 1. the population is exported exactly once, from the data module
if (!/export const allTableNames\b/.test(flows)) {
  fail('flows.ts must export allTableNames')
}

// 2. frozen — a consumer that sorts shared state must throw, not silently reorder
if (!/Object\.freeze\(/.test(flows.slice(flows.indexOf('export const allTableNames')))) {
  fail('allTableNames must be wrapped in Object.freeze so consumers cannot mutate it in place')
}

// 3. no route may re-derive the count from tableDefs alone
for (const [name, src] of [
  ['+layout.svelte', layout],
  ['+page.svelte', home],
]) {
  if (has(src, 'Object.keys(tableDefs).length')) {
    fail(`${name} re-derives the table count from tableDefs; use allTableNames.length`)
  }
  if (!has(src, 'allTableNames.length')) {
    fail(`${name} does not read allTableNames.length`)
  }
}

// 4. /tables must consume the export, not rebuild the union locally
if (has(tables, 'new Set([...Object.keys(tableUsageIndex)')) {
  fail('tables/+page.svelte rebuilds the table union locally; import allTableNames instead')
}
if (!has(tables, 'allTableNames')) {
  fail('tables/+page.svelte does not import allTableNames')
}

if (failures.length) {
  console.error('FAIL table count has more than one source of truth:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log('OK table count derives from allTableNames only')
