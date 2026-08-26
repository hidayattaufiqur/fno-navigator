/**
 * selectSlice.js — pure slice builder turning findPaths() ranked results into
 * the bounded Sigma graph payload. TDD §2.3 (grill Q4/Q6).
 *
 * Contract notes (verified against source):
 *  - path result: { steps: [{ table, via, edge: { from, fromField, to, toField } }],
 *                   score, qualityClass, key, hops }
 *  - specMap (stores/specificity.js) is INVERTED: key `${childField}@${parent}`
 *    → bucket 0..3, ABSENT = 3 (rare). Rare ⇒ thicker edge.
 *  - Counts shown in UI must be merged table-pairs, never raw FK triples (Q4).
 */

import { specificityBucketForEdge, isPlumbingField, isNamedSystemKeyReference } from '../pathScoring.js'

// ceiling: 40 nodes initial slice — ponytail cut (grill Q4 / TDD §8).
// The 120 total cap is enforced in stores/graphState.js expand(); this file
// only ever builds the initial 40. Raise only with bench evidence.
export const SLICE_CAP = 40

/**
 * Ordered unique tables in rank order (path rank, then step order).
 * @param {Array<{ steps: { table: string }[] }>} paths  findPaths().results (v2 order)
 * @param {number} cap
 * @returns {{ nodes: string[], overflow: number }}
 */
export function pickNodes(paths, cap = SLICE_CAP) {
  /** @type {string[]} */
  const nodes = []
  const seen = new Set()
  outer: for (const path of paths) {
    for (const step of path.steps) {
      if (!seen.has(step.table)) {
        seen.add(step.table)
        nodes.push(step.table)
        if (nodes.length >= cap) break outer
      }
    }
  }
  return { nodes, overflow: countDistinctTables(paths) - nodes.length }
}

function countDistinctTables(paths) {
  const s = new Set()
  for (const p of paths) for (const st of p.steps) s.add(st.table)
  return s.size
}

/**
 * Build the initial Sigma slice from ranked paths.
 *
 * @param {Array<import('../pathfinder.js').PathResult>} paths  findPaths().results (v2 rank order)
 * @param {{ cap?: number; specMap?: Record<string, number> | null }} opts
 * @returns {{
 *   nodes: string[],
 *   overflow: number,
 *   mergedEdges: { from: string; to: string; fields: string[]; thickness: number; maxBucket: number; isPlumbing: boolean; bestClass: number }[]
 * }}
 */
export function selectSlice(paths, { cap = SLICE_CAP, specMap = null } = {}) {
  const { nodes, overflow } = pickNodes(paths, cap)
  const nodeSet = new Set(nodes)

  /** @type {Map<string, { from: string; to: string; fields: Set<string>; maxBucket: number; isPlumbingAll: boolean; bestClass: number }>} */
  const merged = new Map()

  for (const path of paths) {
    for (const step of path.steps) {
      const e = step.edge
      if (!e || !nodeSet.has(e.from) || !nodeSet.has(e.to)) continue
      if (e.from === e.to) continue // self-edges excluded (parity with RelationGraph)

      const key = `${e.from}|${e.to}` // directed pair — one merged edge per from|to (Q6)
      const fieldLabel = `${e.from}.${e.fromField} → ${e.to}.${e.toField}`
      const bucket = specMap ? specificityBucketForEdge(e, specMap) : 3
      const plumbing = isPlumbingField(e.fromField) && !isNamedSystemKeyReference(e)

      let m = merged.get(key)
      if (!m) {
        m = { from: e.from, to: e.to, fields: new Set(), maxBucket: 0, isPlumbingAll: true, bestClass: 0 }
        merged.set(key, m)
      }
      m.fields.add(fieldLabel)
      if (bucket > m.maxBucket) m.maxBucket = bucket // thickness = RAREST wins (max bucket, inverted map)
      if (!plumbing) m.isPlumbingAll = false // one non-plumbing field keeps the edge solid (waiver survives toggle)
      if (path.qualityClass > m.bestClass) m.bestClass = path.qualityClass
    }
  }

  const mergedEdges = [...merged.values()]
    .map((m) => ({
      from: m.from,
      to: m.to,
      fields: [...m.fields],
      maxBucket: m.maxBucket,
      // bucket 0→1px … 3→4px (TDD §5.4); rarest constituent drives thickness
      thickness: m.maxBucket + 1,
      isPlumbing: m.isPlumbingAll,
      bestClass: m.bestClass,
    }))
    .sort((a, b) => b.maxBucket - a.maxBucket || b.bestClass - a.bestClass) // rare-first, then business-flow first (Q4)

  return { nodes, overflow, mergedEdges }
}

/**
 * Merge structured FK edges ({from, fromField, to, toField}) into the same
 * merged-edge shape selectSlice() emits — shared by Expand(+N) batches (M2)
 * and the tables/[name] neighbourhood slice (M3). One edge per directed
 * from|to pair, rarest-bucket thickness, plumbing waiver identical to §5.4.
 *
 * @param {{ from: string; fromField: string; to: string; toField: string }[]} structured
 * @param {Record<string, number> | null} specMap
 * @returns {{ from: string; to: string; fields: string[]; maxBucket: number; thickness: number; isPlumbing: boolean; bestClass: number }[]
 */
export function mergeStructuredEdges(structured, specMap) {
  /** @type {Map<string, { from: string; to: string; fields: Set<string>; maxBucket: number; isPlumbingAll: boolean }>} */
  const m = new Map()
  for (const e of structured) {
    if (!e?.from || !e?.to || e.from === e.to) continue
    const key = `${e.from}|${e.to}`
    let rec = m.get(key)
    if (!rec) {
      rec = { from: e.from, to: e.to, fields: new Set(), maxBucket: 0, isPlumbingAll: true }
      m.set(key, rec)
    }
    rec.fields.add(`${e.from}.${e.fromField} → ${e.to}.${e.toField}`)
    const bucket = specMap ? specificityBucketForEdge(e, specMap) : 3
    if (bucket > rec.maxBucket) rec.maxBucket = bucket
    if (!(isPlumbingField(e.fromField) && !isNamedSystemKeyReference(e))) rec.isPlumbingAll = false
  }
  return [...m.values()]
    .map((r) => ({
      from: r.from,
      to: r.to,
      fields: [...r.fields],
      maxBucket: r.maxBucket,
      thickness: r.maxBucket + 1,
      isPlumbing: r.isPlumbingAll,
      bestClass: 0,
    }))
    .sort((a, b) => b.maxBucket - a.maxBucket)
}
