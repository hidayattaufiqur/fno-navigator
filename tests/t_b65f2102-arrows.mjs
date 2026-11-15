// Self-check: pipeline arrows must only appear where flow.edges declares one.
// Reads the real otc entry out of src/lib/data/flows.ts rather than a copy.
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/lib/data/flows.ts', import.meta.url), 'utf8').replace(/\0/g, '')

// otc block: from `id: 'otc'` to the next top-level flow entry
const start = src.indexOf("id: 'otc'")
const end = src.indexOf("id: 'p2p'")
const otc = src.slice(start, end)

const stageIds = [...otc.matchAll(/^        id: '([^']+)'/gm)].map((m) => m[1])
// Split per stage so `optional: true` is attributed to its own stage, not any later one
const chunks = otc.split(/^        id: '/m).slice(1)
const optional = new Set(
  chunks
    .map((chunk) => [chunk.slice(0, chunk.indexOf("'")), /^\s*optional: true/m.test(chunk)])
    .filter(([, isOptional]) => isOptional)
    .map(([id]) => id),
)
const edgeSet = new Set(
  [...otc.matchAll(/\{ from: '([^']+)', to: '([^']+)' \}/g)].map((m) => `${m[1]}>${m[2]}`),
)

// Mirror the template's arrow expression exactly.
const arrows = stageIds.slice(0, -1).map((from, i) => {
  const to = stageIds[i + 1]
  const linked = edgeSet.has(`${from}>${to}`)
  return linked ? (optional.has(to) ? '↳' : '→') : '·'
})

console.log('stages  ', stageIds.join(', '))
console.log('optional', [...optional].join(', '))
console.log('arrows  ', arrows.join(' '))
console.log('rendered', stageIds.map((s, i) => s + (arrows[i] ? ' ' + arrows[i] : '')).join(' '))

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
}

assert(stageIds.length === 8, `expected 8 otc stages, got ${stageIds.length}`)
assert(optional.size === 2 && optional.has('returns') && optional.has('collections'), 'returns + collections must be the only optional stages')

// The two defects this patch fixes: neither pair is a declared edge.
assert(!edgeSet.has('returns>payment'), 'returns->payment is not an edge')
assert(!edgeSet.has('payment>collections'), 'payment->collections is not an edge')
assert(arrows[stageIds.indexOf('returns')] === '·', 'returns->payment must render as a gap')
assert(arrows[stageIds.indexOf('payment')] === '·', 'payment->collections must render as a gap')

// And the real branch entry still shows as a branch.
assert(arrows[stageIds.indexOf('invoice')] === '↳', 'invoice->returns must render as a branch arrow')

console.log('\nOK: arrows match flow.edges; both phantom pairs render as gaps.')
