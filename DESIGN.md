---
version: alpha
name: FnO Navigator redesign
description: "Strip-down redesign of the D365FO table navigator: one accent, one focal point, data-first, mobile-first, WCAG 2.1 AA."
colors:
  # Neutrals (GitHub-dark ancestry, preserved from current tokens where they pass)
  bg: "#0d1117"
  bg-nav: "#010409"
  surface: "#161b22"
  surface-raised: "#1c2128"
  border-subtle: "#21262d"
  border: "#30363d"
  text: "#c9d1d9"
  text-muted: "#8b949e"
  text-faint: "#6e7681"
  # Light mode
  bg-light: "#f6f8fa"
  surface-light: "#ffffff"
  border-light: "#d0d7de"
  border-subtle-light: "#eaeef2"
  text-light: "#1c2128"
  text-muted-light: "#57606a"
  text-faint-light: "#656d76"
  # The single interaction accent (dark mode)
  primary: "#5a94e8"
  accent: "#5a94e8"
  accent-strong: "#79b8ff"
  accent-light: "#a0bef0"
  accent-light-bg: "rgba(90, 148, 232, 0.12)"
  accent-tint: "#23324a"
  # The single semantic accent for light mode
  accent-light-mode: "#0969da"
  accent-light-mode-strong: "#0550ae"
  # On-accent text for the primary button (near-black ink, passes AA on accent)
  primary-button-text: "#0d1117"
  # Success / warning / error (semantic, sparse)
  success: "#3fb950"
  warning: "#d29922"
  danger: "#f85149"
  success-light: "#1a7f37"
  warning-light: "#9a6700"
  danger-light: "#cf222e"
  # Module accents (graph + module chips ONLY, never headings/buttons)
  mod-sales: "#60a5fa"
  mod-procurement: "#fbbf24"
  mod-production: "#fb923c"
  mod-inventory: "#34d399"
  mod-project: "#818cf8"
  mod-finance: "#22d3ee"
  mod-hr: "#e879f9"
  mod-service: "#2dd4bf"
  mod-unknown: "#8b949e"
typography:
  h1:
    fontFamily: 0xProto
    fontSize: 1.75rem
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  h2:
    fontFamily: 0xProto
    fontSize: 1.25rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  h3:
    fontFamily: 0xProto
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: 0xProto
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.6
  body-small:
    fontFamily: 0xProto
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 0xProto
    fontSize: 0.6875rem
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.08em"
  code:
    fontFamily: 0xProto
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.4
  stat:
    fontFamily: 0xProto
    fontSize: 1.5rem
    fontWeight: 700
    lineHeight: 1.1
  micro:
    fontFamily: 0xProto
    fontSize: 0.625rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.06em"
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 20px
  xl: 28px
  xxl: 40px
elevation:
  none: none
  raised: "0 1px 0 rgba(255,255,255,0.03) inset, 0 1px 2px rgba(1,4,9,0.4)"
  overlay: "0 8px 24px rgba(1,4,9,0.5)"
  graph-canvas: "inset 0 0 0 1px var(--clr-border-subtle), 0 1px 2px rgba(1,4,9,0.4)"
components:
  brand-title:
    typography: "{typography.h1}"
    textColor: "{colors.text}"
  eyebrow:
    typography: "{typography.label}"
    textColor: "{colors.accent}"
  lede:
    typography: "{typography.body}"
    textColor: "{colors.text-muted}"
  page-title:
    typography: "{typography.h1}"
    textColor: "{colors.text}"
  section-heading:
    typography: "{typography.label}"
    textColor: "{colors.text-muted}"
  module-chip:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.accent-light}"
    rounded: "{rounded.pill}"
    padding: 2px 10px
  trace-button:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.accent}"
    rounded: "{rounded.sm}"
    padding: 6px 12px
  trace-button-hover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.accent-strong}"
  link:
    textColor: "{colors.accent}"
  link-hover:
    textColor: "{colors.accent-strong}"
  primary-button:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary-button-text}"
    rounded: "{rounded.sm}"
    padding: 10px 18px
    height: 44px
  primary-button-hover:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.primary-button-text}"
  secondary-button:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: 10px 16px
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: 10px 12px
  toc-pill:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: 6px 14px
  toc-pill-active:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.accent-strong}"
    rounded: "{rounded.pill}"
    padding: 6px 14px
  mod-pill:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: 6px 12px
  mod-pill-active:
    textColor: "{colors.text}"
  badge-semantic:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    padding: 2px 8px
  pager-button:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: 8px 14px
  path-table-link:
    textColor: "{colors.text}"
  path-table-link-hover:
    textColor: "{colors.accent}"
  path-source-target:
    typography: "{typography.code}"
    textColor: "{colors.text}"
  graph-toolbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
  status-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: 4px 12px
---

## Overview

FnO Navigator helps D365FO consultants trace business processes and find FK paths between
tables. The redesign strips the UI to its essentials: **one focal point per screen, one
interaction accent, data before decoration.** The graph stays — it is the differentiator —
but its chrome is tamed. Both themes are first-class; nothing is dark-mode-only.

Surface archetype (claude-design "surface-first"):
- **/find** → **Operate** (the user is driving a search): the finder form is the hero;
  results are the output; the graph is a preview pane, not the star.
- **/tables/[name]** → **Command / Inspect** (the user drills into one object): the table
  title block is the anchor; sections are data, not cards.
- **/tables** → **Explore** (browsing an open space): filter + grid, no marketing framing.

### Design rules (binding)

1. **One accent.** `--clr-accent` (dark: `#5a94e8` / light: `#0969da`) means *interaction*:
   links, active state, primary button. It is never used for headings, section labels,
   borders, badges, or decoration. If a heading is colored, that's a bug.
2. **Module colors are data, not chrome.** The 8 module accents appear ONLY as: graph node
   colors, module chips on cards, and module filter dots. Never on buttons, headings, or
   links.
3. **Semantic colors are sparse.** Success/warning/danger only for real states (loading,
   errors, "not found"). No pastel rainbow for categories — method categories are neutral
   labels.
4. **One focal point per screen.** /find: the form. /tables/[name]: the title block +
   first section. Everything above the fold either serves the focal point or leaves.
5. **Data-first hierarchy.** Table names and FK fields are the most important text on
   detail pages. They get the largest, highest-contrast type. Meta (scores, counts,
   notes) is smaller and muted.
6. **Hit targets ≥ 44px** (mobile) / ≥ 32px (desktop dense). Every interactive control.
7. **No text below 11px.** `micro` (10px) is allowed for uppercase badges only with
   letter-spacing; body never below 13px.
8. **Mobile-first.** Layouts are defined for 390px first; desktop enhances.
9. **No glass in light mode.** Light surfaces are solid; `backdrop-filter` only in dark.
10. **Keep the graph.** Same features (module filter, system-FK toggle, expand, URL
    state). Only the chrome around it changes.

---

## Colors

### Dark (default)

| Token | Value | Use | Contrast vs bg |
|---|---|---|---|
| `--clr-bg` | `#0d1117` | page background | — |
| `--clr-bg-nav` | `#010409` | sidebar | — |
| `--clr-surface` | `#161b22` | cards, toolbars, inputs | — |
| `--clr-surface-raised` | `#1c2128` | hover, raised, pills | — |
| `--clr-border-subtle` | `#21262d` | hairline borders | — |
| `--clr-border` | `#30363d` | control borders | — |
| `--clr-text` | `#c9d1d9` | body, table names | 10.3:1 ✅ |
| `--clr-text-muted` | `#8b949e` | secondary text | 6.1:1 ✅ |
| `--clr-text-faint` | `#6e7681` | tertiary, placeholders | **4.45:1 ✅** (was 2.28:1) |
| `--clr-accent` | `#5a94e8` | links, active, primary | 6.2:1 ✅ |
| `--clr-accent-strong` | `#79b8ff` | hover | 9.0:1 ✅ |
| `--clr-accent-light` | `#a0bef0` | on-tint text | 10.0:1 ✅ |
| `--clr-success` | `#3fb950` | shortest/verified | 7.5:1 ✅ |
| `--clr-warning` | `#d29922` | sampled/hints | 8.6:1 ✅ |
| `--clr-danger` | `#f85149` | errors | 6.3:1 ✅ |

### Light

| Token | Value | Use | Contrast vs bg |
|---|---|---|---|
| `--clr-bg` | `#f6f8fa` | page background | — |
| `--clr-bg-nav` | `#ffffff` | sidebar | — |
| `--clr-surface` | `#ffffff` | cards, toolbars | — |
| `--clr-surface-raised` | `#f6f8fa` | hover, raised | — |
| `--clr-border-subtle` | `#eaeef2` | hairline | — |
| `--clr-border` | `#d0d7de` | controls | — |
| `--clr-text` | `#1c2128` | body | 15.2:1 ✅ |
| `--clr-text-muted` | `#57606a` | secondary | 7.2:1 ✅ |
| `--clr-text-faint` | `#656d76` | tertiary | **4.9:1 ✅** (was 2.74:1) |
| `--clr-accent` | `#0969da` | links, active, primary | 4.9:1 ✅ |
| `--clr-accent-strong` | `#0550ae` | hover | 8.4:1 ✅ |
| `--clr-success` | `#1a7f37` | shortest/verified | 4.8:1 ✅ |
| `--clr-warning` | `#9a6700` | sampled/hints | 5.1:1 ✅ |
| `--clr-danger` | `#cf222e` | errors | 4.9:1 ✅ |

> Light-mode `faint` was the worst offender at 2.74:1; the new `#656d76` hits 4.9:1.
> The dark-mode `curated` badge purple `#ab47bc` (3.93:1) is removed — curated rows use
> the semantic `success` badge instead.

---

## Typography

Keep `0xProto` (the site's identity, already bundled). The change is **discipline, not a
new font**: one family, a small scale, mono everywhere (it's a developer tool — this is
appropriate, not a default-Inter cop-out).

| Token | Size | Weight | Use |
|---|---|---|---|
| `--fs-h1` | 28px | 700 | page titles (was 34px — demoted) |
| `--fs-h2` | 20px | 700 | section headings when needed (rare) |
| `--fs-body` | 14px | 400 | default body |
| `--fs-body-sm` | 13px | 400 | secondary |
| `--fs-label` | 11px | 700 + 0.08em | uppercase labels, section headings |
| `--fs-code` | 13px | 400 | table names, FK fields, signatures |
| `--fs-micro` | 10px | 600 + 0.06em | badges only (uppercase) |
| `--fs-stat` | 24px | 700 | home stats |

Rules: never use `--fs-micro` for body copy; keep label/body/code contrast ≥ 4.5:1;
the page title is the largest text on the page (sidebar brand is demoted below it).

---

## Layout

### Shell (both routes)
- Desktop: 260px sidebar + content. Sidebar keeps flows nav + 2 tool links. The "163"
  badge becomes labeled text ("163 tables") or is dropped.
- Mobile (< 900px): top bar (hamburger + brand), sidebar slides in, theme toggle stays
  fixed top-right.
- Theme toggle: keep fixed, but move it INTO the top bar region on mobile (it currently
  overlaps the TOC pills on small screens — the reason the TOC top is 60px).

### /find (Operate surface)
1. **Finder form** — the hero. One row on desktop (from ⇄ to · hops · find), stacked on
   mobile. `max hops` becomes a segmented control (2/3/4/5) like Sort, not a `<select>`.
   The swap button gets a visible label affordance (or 44px target + tooltip).
2. **Results header** — one line: "N paths · shortest M hops · [sort mode]". The "click a
   table name" instruction moves to a hover-visible hint or the legend.
3. **Graph pane** — below the header, above the list, toggle stays. Toolbar becomes a
   **solid** top bar inside the canvas (not floating glass): one module `<select>` +
   "Show system FKs" switch + "Hide graph". The status line ("Showing X of Y") stays as a
   small pill in the canvas corner.
4. **Path list** — the primary output. One badge max per row:
   - rank #1 (cleanest) → highlighted row (accent border) + "cleanest" badge
   - class-3 / curated → single semantic badge ("business flow" / "curated")
   - "shortest" badge removed (it's the sort mode); the header states "shortest first".
   Breakdown line de-duplicated: drop "via X" (already in headline), keep "M hops · score
   N" only when it adds info; FK field labels stay (they're the real value).
5. **Legend** — move badge explanations next to the results header ("What do badges
   mean?"), keep only the reason-code table in `<details>`.

### /tables/[name] (Command/Inspect surface)
1. **Title block** — one surface, not 9 stacked elements:
   `[module chip] [docs ↗]` / `InventTable` (h1) / description / `[⇢ Trace from] [⇠ Trace
   to]`. No full-width badge band. Breadcrumb above ("Table Reference / InventTable").
2. **TOC pills** — keep scroll-spy (it works), restyle: larger targets (≥32px desktop,
   ≥44px mobile), active = accent tint. Drop the "▸" folded-graph glyph (redundant with
   the pill's fold state).
3. **Sections** — uniform flat sections with a label heading + hairline divider, NOT
   identical cards. The Graph section is visually distinct: a raised dark canvas area.
4. **Key fields** — the star. Table rows ≥ 40px. Under 700px: table → stacked cards
   (field name, type, FK, note) to kill the overflow.
5. **Methods** — ONE control set: search + category pills. "Common only" becomes a pill
   toggle in the same row as the category pills (not a separate checkbox with an
   explanatory note). The methods-note paragraph is trimmed to one line.
6. **Relations + Schema FK** — same row component, distinct label. Merge the direction
   groups: single list with an "outgoing/incoming" column filter instead of four
   sub-sections with four pagers.
7. **Pager** — only when a list exceeds ~24 rows. Buttons ≥ 32px. All tables use the same
   `Pager` component (it exists; just enlarge + lighten).

### /tables (Explore surface)
- Module pills get the module dot color (consistency with the graph/sidebar).
- Cards: fixed-height title row (name + module chip) + 1-line clamped description +
  stage count. Remove wall-of-text variability.

---

## Elevation & Depth

- **Flat by default.** Borders separate, not shadows.
- `raised` (1px inset highlight + soft shadow): title block, active nav, hover states.
- `overlay`: popovers, tooltips, autocomplete dropdowns.
- `graph-canvas`: inset border around the graph area only.
- **Dark mode only:** subtle `backdrop-filter` on the graph toolbar and pop card (the
  starfield makes it legible). Light mode uses solid surfaces.

---

## Shapes

- Radius scale: `sm 6px` (buttons, inputs), `md 10px` (cards, toolbars), `lg 14px`
  (title block, graph canvas), `pill` (chips, TOC, module filters).
- One radius per component; no mixing inside a surface.

---

## Components

### Buttons
- `primary-button`: accent bg, white text, 44px min height on mobile / 32px desktop.
  Used ONLY for the single primary action per screen (Find paths, Save, etc.).
- `secondary-button`: raised surface, neutral text. All other actions.
- `trace-button`: secondary style; both directions share the SAME style (drop the
  green/neutral split).

### Pills & chips
- `toc-pill` / `mod-pill`: pill radius, raised surface, muted text; active = accent tint
  + accent text. Module pills show the module dot; zero-count pills at 45% opacity.
- `module-chip`: pill, accent-tint, `--mod-clr` text — used on table cards and title
  blocks.
- `badge-semantic`: flat, muted, 10px uppercase — for "curated", "business flow",
  "sampled". One accent-free look; semantic color only when the badge IS the message
  (e.g. "shortest" is success-green, but only if it stays).

### Path rows (/find)
- Row: rank (muted, tabular) + chain (table names, neutral ink, bold source/target,
  accent on hover) + FK fields (indented, muted) + one badge max.
- Rank #1 highlighted with accent border; other rows hairline only.

### Graph
- Toolbar: solid `surface` bar pinned to the top of the canvas (not floating/absolute
  glass). Contains: module `<select>` (replaces 10 pills — one control, searchable,
  touch-friendly), "Show system FKs" switch, "Hide graph" button.
- Canvas: inset border, dark starfield retained.
- Status pill: bottom-right, `status-pill` style.
- Node pop: keep Goto/Expand, but the pop card is solid `surface-raised` in light mode
  and glass in dark only.

### Section toggle
- Keep the component; bump the button to ≥ 32px (44px mobile), keep the chevron +
  aria-expanded. Replace the `▸` TOC glyph with the pill's own state.

---

## Do's and Don'ts

### Do
- Use the accent ONLY for interaction affordances.
- Make the table name and FK fields the most legible text on the page.
- Put one idea per section; let whitespace do the grouping.
- Keep every interactive target ≥ 44px on touch devices.
- Keep the URL state machine exactly as-is (`?graph=1`, `?from=`, `?to=`, `?modules=`).
- Keep the graph's features; simplify only its chrome.

### Don't
- Don't color headings or section labels with the accent.
- Don't use module colors on buttons, links, or headings — they are data colors.
- Don't stack a rainbow of category badges; method categories are neutral labels.
- Don't put a `<select>` where a segmented control fits (hops), and don't make a
  segmented control where a `<select>` fits (module filter).
- Don't paginate a 7-row table.
- Don't duplicate the "43,584 associations / 5,587 tables" number in three places.
- Don't use glassmorphism in light mode.
- Don't leave any interactive control under the hit-target minimum.
