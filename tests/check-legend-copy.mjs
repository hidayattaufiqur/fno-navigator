// Verbatim check: src/lib/findLegendCopy.js vs find-legend-copy.md (dossier).
//
// The /find tooltips and legend must match the secretary's copy deck EXACTLY —
// copy changes only via the dossier, so any drift here fails the check.
//
// Usage: node tests/check-legend-copy.mjs
// Exit code 0 = verbatim match. Non-zero = list of mismatches.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  TOOLTIP_COPY,
  REASON_TOOLTIP_COPY,
  LEGEND_GROUPS,
} from '../src/lib/findLegendCopy.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const md = readFileSync(join(root, 'find-legend-copy.md'), 'utf8')

const errors = []
const check = (label, expected, actual) => {
  if (expected !== actual) {
    errors.push(`MISMATCH ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`)
  }
}

// ── md table parser ──────────────────────────────────────────────────────────

// Parses every markdown table in the file. Returns a list of
// { header: string[], rows: string[][] }.
function parseTables(text) {
  const lines = text.split('\n')
  const tables = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim().startsWith('|')) { i += 1; continue }
    const header = splitRow(line)
    // separator row: | --- | --- |
    if (!lines[i + 1] || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) { i += 1; continue }
    const rows = []
    let j = i + 2
    while (j < lines.length && lines[j].trim().startsWith('|')) {
      rows.push(splitRow(lines[j]))
      j += 1
    }
    tables.push({ header, rows })
    i = j
  }
  return tables
}

function splitRow(line) {
  return line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
}

// The dossier wraps code-formatted cells in backticks; strip them so code
// cells compare against the module's bare keys.
const stripCode = (cell) => (cell.startsWith('`') && cell.endsWith('`') ? cell.slice(1, -1) : cell)

const tables = parseTables(md)

// ── Tooltip tables ───────────────────────────────────────────────────────────

const generalTable = tables.find((t) => t.header[0] === 'UI label' && t.header[1] === 'Tooltip copy')
const reasonTable = tables.find((t) => t.header[0] === 'Code' && t.header[1] === 'Tooltip copy')

if (!generalTable) { errors.push('General tooltip table not found in md'); }
else {
  // The general table's UI-label column is a display string (e.g.
  // "`cleanest path` / `Top-ranked path`"), not the module key, so verbatim
  // equivalence is checked on the copy VALUES (multiset equality).
  const expectedCopies = generalTable.rows.map(([, copy]) => copy).sort()
  const actualCopies = Object.values(TOOLTIP_COPY).sort()
  check('general tooltip count', expectedCopies.length, actualCopies.length)
  expectedCopies.forEach((copy, i) => {
    check(`general tooltip value #${i + 1}`, copy, actualCopies[i])
  })
}

if (!reasonTable) { errors.push('Reason tooltip table not found in md'); }
else {
  const expectedReason = new Map(reasonTable.rows.map(([code, copy]) => [stripCode(code), copy]))
  check('reason tooltip key count', expectedReason.size, Object.keys(REASON_TOOLTIP_COPY).length)
  for (const [code, copy] of expectedReason) {
    if (!(code in REASON_TOOLTIP_COPY)) { errors.push(`MISSING reason tooltip key: ${code}`); continue }
    check(`reason tooltip [${code}]`, copy, REASON_TOOLTIP_COPY[code])
  }
}

// ── Legend groups and sections ───────────────────────────────────────────────

// Parse ### groups and #### sections with their following prose paragraphs.
const legendLines = md.split('## Legend section copy\n')[1] ?? ''
const legendTables = parseTables(legendLines)

const expectedGroups = []
let currentGroup = null
let currentSection = null
for (const raw of legendLines.split('\n')) {
  const line = raw.trim()
  if (line.startsWith('### ')) {
    currentGroup = { heading: line.slice(4), sections: [] }
    expectedGroups.push(currentGroup)
    currentSection = null
  } else if (line.startsWith('#### ')) {
    currentSection = { title: line.slice(5), body: [], table: null }
    currentGroup.sections.push(currentSection)
  } else if (line && !line.startsWith('|') && !line.startsWith('---') && currentSection) {
    currentSection.body.push(line)
  }
}

// Attach the reason-chips table to its section.
for (const t of legendTables) {
  if (t.header[0] === 'Code' && t.header[1] === 'Current chip text') {
    const target = expectedGroups
      .flatMap((g) => g.sections)
      .find((s) => s.title === 'Reason chips')
    if (target) target.table = t.rows.map(([code, chip, meaning]) => ({ code: stripCode(code), chip, meaning }))
  }
}

check('legend group count', 3, LEGEND_GROUPS.length)
for (const g of expectedGroups) {
  const actual = LEGEND_GROUPS.find((x) => x.heading === g.heading)
  if (!actual) { errors.push(`MISSING legend group: ${g.heading}`); continue }
  check(`legend group [${g.heading}] section count`, g.sections.length, actual.sections.length)
  for (const s of g.sections) {
    const aSection = actual.sections.find((x) => x.title === s.title)
    if (!aSection) { errors.push(`MISSING legend section: ${g.heading} / ${s.title}`); continue }
    check(`legend [${g.heading} / ${s.title}] body count`, s.body.length, aSection.body.length)
    s.body.forEach((para, i) => {
      check(`legend [${g.heading} / ${s.title}] para ${i + 1}`, para, aSection.body[i])
    })
    if (s.table) {
      const expectedRows = s.table.map((r) => `${r.code}|${r.chip}|${r.meaning}`)
      const actualRows = (aSection.table ?? []).map((r) => `${r.code}|${r.chip}|${r.meaning}`)
      check(`legend [${g.heading} / ${s.title}] table rows`, expectedRows.join('\n'), actualRows.join('\n'))
    }
  }
}

// ── Sanity: every tooltip is 12 words or fewer (dossier claim) ───────────────

const wordCount = (s) => s.trim().split(/\s+/).length
for (const [k, v] of Object.entries({ ...TOOLTIP_COPY, ...REASON_TOOLTIP_COPY })) {
  if (wordCount(v) > 12) errors.push(`tooltip [${k}] is ${wordCount(v)} words (max 12): ${v}`)
}

// ── Report ───────────────────────────────────────────────────────────────────

if (errors.length) {
  console.error(`✗ ${errors.length} copy mismatch(es):`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

const totalTooltips = Object.keys(TOOLTIP_COPY).length + Object.keys(REASON_TOOLTIP_COPY).length
const totalSections = LEGEND_GROUPS.reduce((n, g) => n + g.sections.length, 0)
console.log(`✓ copy verbatim: ${totalTooltips} tooltips, ${LEGEND_GROUPS.length} groups, ${totalSections} sections, all ≤12 words`)
