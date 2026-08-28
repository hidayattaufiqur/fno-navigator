# fno-navigator — R3 Design Spec: unify ALL interactive radius to sm (6px)

Task: t_bcd9401f — d9s wants ALL interactive elements to use uniform border-radius
matching the "All" dropdown (`select`, sm 6px) and the "Step 1…" pipeline boxes
(`.pipeline-node`, sm 6px). This **overrides** the R2 pill decision for interactive
elements.

Repo: /home/smolpanda/Fun/Projects/fno-navigator (branch `feat/ui-redesign-r3`, already
contains the first two r3 commits `eae0246` + `61590c7` fixing `.pipeline-node .pill`
role chips to sm).

---

## 1. The rule (binding, one sentence)

> **Every interactive element uses `sm` (6px) radius. `pill` (999px) is reserved for
> non-interactive data indicators (static info chips, badges, dots, status reads).**

That's it. One radius for anything you can click/tap/focus; pill only for things you
can't. `md`/`lg` stay for containers/cards/canvases (they are not interactive
surfaces).

---

## 2. Element classification (exhaustive)

### 2a. Interactive → becomes `sm` (6px)  [the change]

| Selector | Element | Where | Current | Target |
|---|---|---|---|---|
| `.mod-pill` | module filter pill (incl. "All") | /tables | pill | **sm** |
| `.cat-pill` | method category filter pill (+ common-only) | /tables/[name] | pill | **sm** |
| `.toc-pill` | section nav pills (scroll-spy) | /tables/[name] | pill | **sm** |
| `.rel-sort-btn` | relation sort button | /tables/[name] | pill | **sm** |
| `.trace-link` | "⇢ Trace from / ⇠ Trace to" | /tables/[name] | **already sm** (page rule line 894 wins over app.css pill) | sm ✓ |
| `.flow-link` | flow card link on home | / | 10px | **sm** (already sm-adjacent) |
| `.flow-list a` | flow nav list item | layout sidebar | 9px | **sm** (already sm-adjacent) |
| `.pipeline-node` | "Step 1…" stage boxes | /flow | 10px | **sm** (r1 norm already maps it) |
| `.pipeline-node .pill` | role chips inside stage boxes | /flow | **done r3** | sm ✓ |
| `.table-chip` | clickable table chip (links to /tables/X) | /flow, /tables/[name] | pill | **sm** |
| `.nav-link` | sidebar nav links (Home, Tables, Find) | layout | sm (r1) | sm ✓ (no change) |
| `.rel-source` (`.pill` as link) | "used in <stage>" links | /tables/[name] | pill (from .pill) | **sm** |
| `.th-sort` | sortable column header buttons | /tables/[name] | none (transparent) | sm focus ring ✓ |
| `.legend-summary` | legend `<summary>` toggle | /find | sm | sm ✓ (no change) |
| `.sort-toggle` / `.hops-toggle` | segmented controls | /find | sm | sm ✓ (no change) |
| `.swap-btn` `.pager-btn` `.cta-button` `.step-nav-btn` `.suggestions button` `.section-toggle` `.theme-toggle` `.view-toggle` | buttons | all | sm | sm ✓ (no change) |
| `select`, `.search input`, `.method-search`, `.nav-search input` | inputs/selects | all | sm | sm ✓ (no change) |
| `.section-docs-link` | "Common docs ↗" | /tables/[name] | inline text (no surface) | n/a |
| `.docs-link` | "Microsoft Learn docs ↗" | /tables/[name] | inline text | n/a |

### 2b. Non-interactive data indicators → keep `pill` (999px)  [no change]

| Selector | Element | Why it stays pill |
|---|---|---|
| `.module-badge` | module chip on cards/title blocks | data indicator, not clickable |
| `.pill` (bare span) | module tint chip in search results | static info chip |
| `.chip` | (legacy) static chip | static |
| `.suggest-mod` | module tag in autocomplete suggestions | static label; the suggestion row itself is the control |
| `.cat-badge` `.method-badge` | method category badges | data label inside a table row |
| `.class3-badge` `.curated-badge` `.canonical-badge` | path editorial badges | data label |
| `.match-reason` | "matched X" hint | data label |
| `.reason-chip` | reason code chips | data label |
| `.rel-fields` `.rel-field` | FK field code chips | data label |
| `.schema-badge` | schema FK badge | data label |
| `.nav-link-count` | table count chip in sidebar | data readout |
| `.status-pill` `.graph-status` | graph status pill | status readout, `pointer-events: none` |
| `.overridable-dot` `.flow-list-dot` `.dot` | dots | dots stay 50% (not a surface) |
| `50%` spinners, `2px` hamburger lines | — | not surfaces |

### 2c. Containers → unchanged (`md` 10px / `lg` 14px)

Cards, table wraps, graph toolbar/canvas, stage pipeline, finder form, callouts,
tooltips, dropdowns, autocomplete — **not interactive surfaces**, keep `md`/`lg`.

---

## 3. Selector-level changes for nix (patch, all additive overrides in app.css)

Add one block to `src/app.css` (after the r2 radius-completion block, ~line 1622)
so the r3 rule is explicit and wins over the r2 pill block for these selectors:

```css
/* ── r3 radius rule (R3-SPEC §1): every INTERACTIVE element = sm (6px).
   Pill (999px) is reserved for non-interactive data indicators only.
   Overrides the r2 pill mapping for the clickable subset. ─────────── */

/* interactive pills → sm */
.mod-pill, .cat-pill, .toc-pill, .rel-sort-btn, .trace-link,
.table-chip, .flow-link, .flow-list a,
a.pill, .pill.rel-source, .rel-source { border-radius: var(--r-sm, 6px); }

/* pipeline stage boxes → sm (r1 mapped this; make it explicit + binding) */
.pipeline-node { border-radius: var(--r-sm, 6px); }
```

Notes for nix:

1. **`a.pill, .pill.rel-source`** — the `rel-source` stage links in
   /tables/[name] (`<a class="pill rel-source">`) are interactive; they inherit
   `pill` from the `.pill` base. The `a.pill` + `.pill.rel-source` + `.rel-source`
   selectors cover them without touching bare static `.pill` spans.
2. **`.toc-pills` container** (the scroll strip) stays `sm` — already sm, no change.
3. **`.th-sort`** buttons have no surface; ensure `:focus-visible` outline uses sm
   radius (SectionToggle already does: `border-radius: var(--r-sm)` on focus).
4. **Keep the `.pipeline-node .pill` rule** from r3 commit `eae0246` (already in
   app.css line ~1348) — role chips inside stage boxes are sm now.
5. Do NOT touch the `.pill` base rule (line 458) — static `.pill` spans keep pill
   radius; the r3 override targets only the interactive subset.
6. Light mode: no new contrast risk — radius only, zero color changes.

### Page-level CSS to check (r3 scope)

- `src/routes/tables/[name]/+page.svelte` — `.toc-pill` (line 801), `.cat-pill`
  (line 985), `.rel-sort-btn` (line 1079) all currently `var(--r-pill)` →
  change to `var(--r-sm, 6px)`. `.trace-link` (line 913) → sm. These are scoped
  page rules that win over app.css (Svelte scoping), so the app.css override
  alone is NOT enough for them.
- `src/routes/tables/+page.svelte` — `.mod-pill` (app.css r2 block line 1601 →
  covered by app.css override; verify no page-level pill rule wins).
- `src/routes/flow/[flowId]/[stageId]/+page.svelte` — `.table-chip` (app.css),
  `.pipeline-node` (app.css), `.step-nav-btn` (line 317, already sm).

**The Svelte-scoped page rules are the critical ones** — app.css overrides lose to
scoped `<style>` blocks. Change these selectors at their definition sites:

```
tables/[name]/+page.svelte:
  .toc-pill      { border-radius: var(--r-pill, 999px); }  →  var(--r-sm, 6px)
  .cat-pill      { border-radius: var(--r-pill, 999px); }  →  var(--r-sm, 6px)
  .rel-sort-btn  { border-radius: var(--r-pill, 999px); }  →  var(--r-sm, 6px)
  .trace-link    already sm (line 894) — no change needed
```

---

## 4. DESIGN.md changes (this task's primary deliverable)

Already applied in this task — see the DESIGN.md diff below. Summary:

1. **YAML `components:`** — flip interactive component radii from `{rounded.pill}`
   to `{rounded.sm}`: `toc-pill`, `toc-pill-active`, `mod-pill`, `mod-pill-active`,
   `trace-button` (already sm — verify). Keep `module-chip`, `chip-pill`,
   `badge-light`, `status-pill` at pill (non-interactive).
2. **Design rule 11** — rewrite: "One radius per element. Every **interactive**
   element is `sm` (6px). `pill` is reserved for **non-interactive** data
   indicators (static chips, badges, status reads)."
3. **Shapes section** — split the pill row: pill applies to non-interactive
   indicators only; interactive pills (filters, TOC, chips-as-links) are sm.
4. **Components → Pills & chips** — update: interactive filter pills = sm;
   static chips/badges = pill.
5. **Do's and Don'ts** — add: "Don't give an interactive element a pill radius."

---

## 5. Verification (nix)

- `npm run build` passes.
- `npx -y @google/design.md lint DESIGN.md` — 0 errors, no NEW contrast warnings
  (existing warnings are pre-r3: orphaned tokens + the chip-pill 1.63:1 tint
  contrast which is a pre-existing additive-tint warning).
- Grep guard (interactive subset, expect only sm):
  `grep -rn "border-radius" src/routes/tables/\[name\]/+page.svelte | grep -E "toc-pill|cat-pill|rel-sort-btn|trace-link"` → all `var(--r-sm)`.
- Visual: /tables "All" module pill, /tables/[name] TOC pills + category pills +
  trace links + relation sort buttons all 6px; /flow "Step 1…" boxes + role chips
  6px; /find results module chip + path badges still pill (non-interactive).
- Screenshot both themes at 1440px and 390px; attach to the card.
