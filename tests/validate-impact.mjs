// Validates the optional per-stage `impact` block (posting impact card).
//
//   node tests/validate-impact.mjs
//
// Rules, from docs/specs/pr3-stage-impact.md:
//   1. impact absent  -> skip (un-authored is valid)
//   2. creates[]      -> must exist in that stage's tables[] (you cannot post a table the
//                        stage does not carry)
//   3. doesNot[]      -> must exist in the known-table population, but NOT required in
//                        stage.tables. Deliberate: the canonical case is
//                        p2p/receipt -> doesNot: ['VendTrans'], and VendTrans is rightly
//                        absent from receipt's tables. Requiring membership would ban the
//                        field's primary use case.
//   4. a name may not appear in both arrays (contradiction)
//   5. impact may not be {} (renders nothing, so it is noise)
//
// Stated limit: this proves internal consistency, NOT that the posting claim is true about
// D365FO. Truth is a reviewer's job. Same split the repo already uses for relation fields[].
//
// allTableNames is not on this branch (it ships with the routing/count PR), so the union is
// derived here. Keep the two definitions in sync; if allTableNames lands, import it instead.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const src = readFileSync(join(ROOT, 'src/lib/data/flows.ts'), 'utf8')

// Load the data module without a TS toolchain: strip the type annotations the file uses at
// the top level, then evaluate. The module is plain object/array literals below the types.
const { flows, tableDefs } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      src
        .replace(/^export type [\s\S]*?\n}\n/gm, '')
        .replace(/^export (const (roles|modules|flows): [^=]+=)/gm, 'export $1')
        .replace(/: (Flow|Stage|TableDef|TableField)\[\]/g, '')
        .replace(/: Record<string, TableDef>/g, '')
        .replace(/: (string|number|boolean)(\[\])?(?=\s*[,)=])/g, ''),
      'utf8'
    ).toString('base64')
)

const allTableNames = new Set([
  ...flows.flatMap((flow) => flow.stages.flatMap((stage) => stage.tables)),
  ...Object.keys(tableDefs),
])

const failures = []
const fail = (msg) => failures.push(msg)

let authored = 0
for (const flow of flows) {
  for (const stage of flow.stages) {
    const impact = stage.impact
    if (!impact) continue
    authored++
    const where = `${flow.id}/${stage.id}`

    const creates = impact.creates ?? []
    const doesNot = impact.doesNot ?? []

    if (creates.length === 0 && doesNot.length === 0) {
      fail(`${where}: impact is empty — it renders nothing, so delete it or fill it`)
    }

    const stageTables = new Set(stage.tables)
    for (const name of creates) {
      if (!stageTables.has(name)) {
        fail(`${where}: creates '${name}' is not in stage.tables — add it to the stage or drop the claim`)
      }
    }
    for (const name of doesNot) {
      if (!allTableNames.has(name)) {
        fail(`${where}: doesNot '${name}' is not a known table — probable typo`)
      }
    }
    for (const name of creates) {
      if (doesNot.includes(name)) {
        fail(`${where}: '${name}' is in both creates and doesNot`)
      }
    }
  }
}

if (failures.length) {
  console.error(`FAIL impact validation (${failures.length} problem(s), ${authored} authored stage(s)):`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(`OK impact blocks valid — ${authored} authored stage(s), ${flows.reduce((n, f) => n + f.stages.length, 0)} total`)
