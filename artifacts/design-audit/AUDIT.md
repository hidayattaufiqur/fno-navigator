# fno-navigator UI/UX Audit Report

**Task:** t_ff324619 · **Auditor:** muse · **Date:** 2026-08-27
**Scope:** /find, /tables/[name], /tables, graph views, dark + light, desktop + mobile
**Method:** live-site screenshots (Playwright on NixOS chromium) + computed DOM metrics + WCAG contrast math + source review

---

## 1. Executive summary

The app is functionally rich and technically impressive — a full D365FO FK graph with
pathfinding, schema enrichment, and a 3D force graph. The problem is **not the features;
it is that the chrome competes with the data everywhere.** The page stacks ~9 elements
before the first row of data, paints the same accent color onto ~25 of ~40 colored
elements, renders 50 path rows each carrying badges, and uses 9–13px text with dozens of
distinct interactive controls under the 44px touch target.

| Metric (measured) | Value | WCAG AA |
|---|---|---|
| Font sizes in use (single page) | 9px → 34px, 12 distinct sizes | — |
| Distinct colored/accented elements (table page) | ~40 (25+ of them the same teal/cyan) | — |
| Small hit targets (desktop, < 40px) | 30+ controls (TOC pills 23px, cat pills 24px, pager 24px, section toggles 18px) | ❌ |
| Mobile table page horizontal overflow | scrollWidth 480 vs 390 viewport | ❌ |
| Mobile /find graph horizontal overflow | 394 vs 390 | ❌ |
| `--clr-text-faint` contrast (dark + light) | 2.28:1 / 2.74:1 | ❌ |
| `curated` badge purple `#ab47bc` on dark | 3.93:1 | ❌ |
| Path rows on /find (InventTable→SalesTable) | 50 rows, 49 carry ≥1 badge, 47 carry "shortest" | — |

**What works (keep):**
- The data model and information architecture are sound: sections map to real questions.
- The 3D graph is genuinely the differentiator — keep it, simplify its chrome.
- URL state (`?graph=1`, `?from=`, `?to=`) is well-engineered (replaceState, popstate).
- The dark palette's core tokens (bg/text/muted/blue/green) pass contrast.
- Accessibility scaffolding exists: real `<button>`s, aria-labels, tooltips with keyboard support, focus-visible styles.

---

## 2. Screen-by-screen findings

### 2.1 /tables/[name] — table detail (the heaviest page)

**Top-of-page stacking (9 elements before data):**
breadcrumb → 5 TOC pills → full-width module badge band → oversized heading (28–34px mono)
→ description paragraph → docs link → 2 trace buttons → section heading → table.
Redundancy: the word "InventTable" and the "INVENTORY" fact each appear 3–4 times before
any data.

**Module badge:** full-width colored band; competes with the trace buttons (both green for
Inventory). Should be a small inline chip.

**Color overload:** ~40 colored elements. The same cyan/teal accent paints section
headings, active TOC pill, active graph tab, "Common only" toggle, all links, sort
buttons, canonical hints, legend headings, and the find button — 25+ placements. When
everything is accent-colored, nothing is. The Methods section adds an 8-color rainbow of
category badges that fights the otherwise restrained palette.

**Methods section:** 3 control systems for one table (search input + 8 category pills +
"Common only" checkbox), plus the section heading's own "Common docs" link, plus a
methods-note paragraph. 18 rows default view. The note "Toggle Common only off to see all
55 methods" contradicts the count in the heading.

**Section styling:** all 6 sections (Key fields, Methods, Relations, Schema FK, Used-in +
Graph) share one identical card style — the eye cannot tell where one ends and the next
begins. Graph section visually identical to the rest, yet it's a different tool.

**Pagination:** 4 tables × the same Pager (24px buttons, "1–7 of 7", Prev/Next) —
30 pager-related elements measured on one page. Tables with ≤24 rows don't need
pagination, or need one shared "show more" affordance.

**Schema FK section:** 24 near-identical mono rows, each with a teal `InventTable` link,
opacity 0.65 rows, plus a long prose note with the raw "43,584 / 5,587" numbers repeated
from /find. Reads as a dump, not a scannable list.

**Trace links:** two sibling actions styled differently (one neutral, one green). Both
should share a base style.

### 2.2 /find — Table Path Finder

**Hero:** eyebrow "Dynamics 365 Finance & Operations" duplicates the sidebar brand; the
H1 competes with the sidebar product name (sidebar title is larger than the page H1).
The 43,584/5,587 numbers repeat in the lede, the loading state, and the legend.

**Legend:** a 3-column, 11-row reason-code table buried inside a `<details>`; excellent
content, heavy presentation. It explains every badge — but it's collapsed by default
and visually remote from the rows it explains.

**Results header line:** 3 facts in one mini line (`50+ paths from X to Y · Shortest: 2
hops · Fewest hops first · click a table name to view its reference`) — the instruction
"click a table name" sits in a muted meta line while table names are colored, not styled
as links.

**Path rows — badge overload:** 50 rows; 49 carry ≥1 badge, 47 carry the "shortest" badge
(a property of the sort mode, not of the row). Row #1 carries 2 badges. Breakdown line
duplicates headline info: `2 hops · score 10 · via X` — hops are implied by the arrows,
"via X" is the intermediate table already named in the headline. "score 10" is identical
across rows (a constant, not a signal).

**Color semantics collide:** blue = source table, active sort, sidebar eyebrow, "Find
paths" button, "cleanest path" badge, "Find Table Path" nav item. Green = target table,
"shortest" badge, Inventory module. A user cannot map color → meaning without the legend.

**Swap button:** 38×34 icon-only `⇄` with no label; below 44px.

### 2.3 Graph view (both routes)

**Toolbar:** glass toolbar with 10 module pills + "Show system FKs" toggle + "Hide graph"
button. On desktop the toggle label wraps onto a second row, orphaning its checkbox. On
mobile, pills scroll horizontally but every pill is 22px tall and the toolbar overlaps the
canvas. Zoom buttons 32×32.

**Module pill palette:** Procurement (amber) vs Production (orange), Inventory (teal) vs
Finance (cyan) vs Service (green) are near-duplicates at 7px dot size. Zero-count pills
(Project, HR, Service = 0) render at full opacity with equal weight.

**Attention balance:** the bloom/glow 3D graph dominates; the actionable path list below
is plain text. The list is the product; the graph is the garnish.

### 2.4 /tables index

- Module filter pills not color-coded despite the module color system existing (sidebar
  dots use it) — a missed consistency win.
- Cards are variable-height (some "2 stages", some 8-line descriptions) → ragged grid.
- Cards don't show the module chip, forcing cross-reference to pills/sidebar.
- The "163" nav badge is unlabeled (163 = tables in tableDefs; the index shows 139 — the
  discrepancy is unexplained to users).

### 2.5 Light mode

The design is dark-mode-first; light mode is the orphan:
- Dot-grid background invisible; glass toolbar/buttons lose their effect → flat.
- Sidebar text, breadcrumb, pagination, section arrows all low-contrast gray.
- `--clr-text-faint` (#9198a1) at 2.74:1 fails AA.
- Colored badges (pastel on white) all blur together; method category pills nearly
  indistinguishable.

### 2.6 Mobile (390px)

- **Table page: horizontal overflow (480 vs 390)** — the field table and other content
  force the page wider.
- Every interactive element under 44px: hamburger 30×26, TOC pills 23px, trace buttons
  30px, section toggles 18px, pager buttons 24px, method search 29px, cat pills 24px.
- Sticky TOC pill row scrolls with no visible scroll affordance; Graph pill can be
  partially off-screen.
- Graph: unreadable node labels; zoom controls tiny; toolbar eats the canvas.

---

## 3. Root causes

1. **No single focal point.** Every screen presents 3–4 equally-weighted action systems
   (breadcrumb + TOC + badge + heading + trace links + section toggles).
2. **Accent color inflation.** One accent applied to 25+ roles; plus a second palette
   (module colors, category colors) layered on top without a rule for when each applies.
3. **Small-type density.** 9–13px text carries most of the UI; 12 distinct font sizes on
   one page; no type scale system.
4. **Decoration pretending to be hierarchy.** Full-width module badge, glass toolbar,
   colored source/target table names, 4 badge types on path rows — all decoration, all
   competing with data.
5. **Dark-mode-first tokens.** Light mode was an afterthought (glass/dots/badges all
   degrade), and `faint` fails AA in both modes.

---

## 4. Proposed direction (see DESIGN.md + wireframes for the full spec)

| Problem | Fix |
|---|---|
| 9 elements before data | One title block: module chip + name + description + actions. No full-width badge band. |
| 25 uses of one accent | Accent = interaction only (links, active state, primary button). Headings, borders, badges go neutral. One accent, one semantic role. |
| Badge overload on rows | Drop "shortest" (it's the sort mode). Keep at most one meaningful badge per row (business flow / curated). Fold cleanest into rank #1 styling. |
| 8-color category rainbow | Neutral method category labels; one accent color only. Module colors stay for the graph + module chips only. |
| 4 identical sections | Hierarchy of surfaces: title block (raised), content sections (flat), graph (distinct dark canvas). |
| Pager everywhere | No pagination under ~24 rows; consistent "show all/less" affordance; larger touch targets. |
| Light mode orphan | Rebuild light tokens with real contrast (faint ≥ 4.5:1), drop glass in light mode (solid surface), keep dot grid subtle or remove. |
| Mobile overflow | Tables → card/stacked layout under 700px; TOC pills larger; all hit targets ≥ 44px. |
| Graph toolbar | Collapse module pills into a single filter `<select>` + "Show system FKs" switch; move controls off-canvas (top bar), not floating glass. |
| Legend buried | Move badge explanations next to the results; keep the reason-code table as the only `<details>`. |
| Duplicated numbers (43,584/5,587) | State once in the /find lede; the loading state and schema note reference "the full FK map" instead. |

---

## 5. Verification notes

- Screenshots: `artifacts/design-audit/shots/*.png` (12 views, both themes, desktop+mobile).
- Metrics: `tools/audit-metrics.mjs` (DOM measurements) — real values, not estimates.
- Contrast: computed with WCAG 2.1 relative-luminance math on the actual token values.
- Live site host: `fno.hidayattaufiqur.dev` (the root domain serves the portfolio).
- The mobile vision pass hallucinated unrelated content; mobile facts above are from
  computed DOM metrics, not vision descriptions.
