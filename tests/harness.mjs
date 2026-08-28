// Test harness for the Table Path Finder.
//
// Loads the REAL src/lib/pathfinder.js and src/lib/pathScoring.js with only
// the Svelte $lib imports rewritten to local stubs, and the REAL dataset
// (static/data/fk-map.json) embedded as module-level constants.
//
// Cache discipline (F2): the forward/reverse maps are embedded once into the
// stub module body, so V8 materializes them once per module load. NEVER stub
// getForwardMap with an inline literal re-materialized per call — that
// measures GC, not the algorithm. The app itself caches the parsed map at
// module level (src/lib/stores/fkMap.js) and this mirrors that.
//
// Usage (ESM, node >= 18):
//   import { findPaths, scoreEdge, scorePath, getMaps } from './harness.mjs'

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SCRATCH = join(__dirname, '.scratch')

/** Rebuild the stubbed module files from the current working-tree source. */
function build() {
  rmSync(SCRATCH, { recursive: true, force: true })
  mkdirSync(SCRATCH, { recursive: true })

  // pathScoring.js is self-contained (no imports) — copy verbatim.
  writeFileSync(
    join(SCRATCH, 'pathScoring.mjs'),
    readFileSync(join(ROOT, 'src/lib/pathScoring.js'), 'utf8')
  )

  // pathfinder.js imports four $lib modules — rewrite to local stubs.
  let pfSrc = readFileSync(join(ROOT, 'src/lib/pathfinder.js'), 'utf8')
  pfSrc = pfSrc
    .replace(
      `import { getForwardMap, getReverseMap } from '$lib/stores/fkMap'`,
      `import { getForwardMap, getReverseMap } from './stub-fkmap.mjs'`
    )
    .replace(
      `import { tableDefs } from '$lib/data/flows'`,
      `import { tableDefs } from './stub-flows.mjs'`
    )
    .replace(
      `import { getSpecificityMap } from '$lib/stores/specificity'`,
      `import { getSpecificityMap } from './stub-specificity.mjs'`
    )
    .replace(
      `import { scoreEdge, scorePath, compareV2, classHintFor, isPlumbingTable } from '$lib/pathScoring'`,
      `import { scoreEdge, scorePath, compareV2, classHintFor, isPlumbingTable } from './pathScoring.mjs'`
    )
  writeFileSync(join(SCRATCH, 'pathfinder.mjs'), pfSrc)

  // Stub fkMap: forward map straight from fk-map.json, cached at module level.
  const forwardMap = JSON.parse(
    readFileSync(join(ROOT, 'static/data/fk-map.json'), 'utf8')
  )
  const reverseMap = {}
  for (const [parent, children] of Object.entries(forwardMap)) {
    for (const [child, parentField, childField] of children) {
      if (!reverseMap[child]) reverseMap[child] = []
      reverseMap[child].push([parent, parentField, childField])
    }
  }
  writeFileSync(
    join(SCRATCH, 'stub-fkmap.mjs'),
    `const forwardMap = ${JSON.stringify(forwardMap)}\n` +
      `const reverseMap = ${JSON.stringify(reverseMap)}\n` +
      `export function getForwardMap() { return forwardMap }\n` +
      `export function getReverseMap() { return reverseMap }\n`
  )

  // Stub specificity: the v2 edge-specificity artifact (static/data/
  // edge-specificity.json), embedded once like the FK map. The pathfinder
  // reads it synchronously via getSpecificityMap().
  const specMap = JSON.parse(
    readFileSync(join(ROOT, 'static/data/edge-specificity.json'), 'utf8')
  )
  writeFileSync(
    join(SCRATCH, 'stub-specificity.mjs'),
    'const specMap = ' + JSON.stringify(specMap) + '\n' +
      'export function getSpecificityMap() { return specMap }\n'
  )

  // Stub flows: documented set = keys of tableDefs in flows.ts.
  const flowsTs = readFileSync(join(ROOT, 'src/lib/data/flows.ts'), 'utf8')
  const defStart = flowsTs.indexOf('export const tableDefs')
  if (defStart < 0) throw new Error('tableDefs not found in flows.ts')
  const defBody = flowsTs.slice(defStart)
  const keys = []
  const keyRe = /^  ([A-Za-z0-9_]+): \{/gm
  let m
  while ((m = keyRe.exec(defBody))) keys.push(m[1])
  writeFileSync(
    join(SCRATCH, 'stub-flows.mjs'),
    `export const tableDefs = ${JSON.stringify(
      Object.fromEntries(keys.map((k) => [k, {}]))
    )};\n`
  )
}

build()

export const { findPaths } = await import(
  join(SCRATCH, 'pathfinder.mjs').replace(/\\/g, '/')
)
export const { scoreEdge, scorePath } = await import(
  join(SCRATCH, 'pathScoring.mjs').replace(/\\/g, '/')
)

export { SCRATCH, ROOT }
