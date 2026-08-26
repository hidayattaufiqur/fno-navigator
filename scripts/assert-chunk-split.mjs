#!/usr/bin/env node
/**
 * assert-chunk-split.mjs — T4.2 / TDD §9.1 (Q15 verbatim).
 *
 * After `npm run build`, verify the lazy-loaded graph stack is NOT in the
 * entry bundle:
 *   1. the entry chunk (build/_app/immutable/entry/*.js) does NOT contain
 *      the graphology/forceatlas2/`import("sigma` markers (lazy only)
 *   2. at least one non-entry chunk contains "sigma" (the lazy chunk exists)
 *
 * Exit 0 on pass, 1 on fail. Static, <50ms. Chunks are content-hashed by
 * Vite, so we check CONTENT, not the `sigma-*` filename.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const buildDir = join(process.cwd(), 'build', '_app', 'immutable')
const chunksDir = join(buildDir, 'chunks')
const entryDir = join(buildDir, 'entry')

if (!existsSync(chunksDir) || !existsSync(entryDir)) {
  console.error('assert-chunk-split: build dir missing — run `npm run build` first')
  process.exit(1)
}

// Lazy graph stack markers: class names from the three/3d-force-graph bundle.
// Minified chunk content is what we check, so use identifiers that survive
// terser (string class names, not package names or variable refs).
const LAZY_MARKERS = ['IcosahedronGeometry', 'UnrealBloomPass']

const entries = readdirSync(entryDir).filter((f) => f.endsWith('.js'))
let entryLeak = false
for (const e of entries) {
  const content = readFileSync(join(entryDir, e), 'utf8')
  for (const marker of LAZY_MARKERS) {
    if (content.includes(marker)) {
      console.error(`assert-chunk-split: FAIL — entry ${e} contains "${marker}" (graph leaked into entry)`)
      entryLeak = true
    }
  }
}

const chunks = readdirSync(chunksDir).filter((f) => f.endsWith('.js'))
let lazyChunk = false
for (const c of chunks) {
  const content = readFileSync(join(chunksDir, c), 'utf8')
  if (content.includes('UnrealBloomPass')) { lazyChunk = true; break }
}

if (entryLeak) process.exit(1)
if (!lazyChunk) {
  console.error('assert-chunk-split: FAIL — no non-entry chunk contains the graph stack (lazy chunk missing)')
  process.exit(1)
}

console.log('assert-chunk-split: OK — graph stack lazy-split (entry clean, lazy chunk present)')
