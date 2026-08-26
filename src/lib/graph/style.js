/**
 * style.js — pure visual contract for the Sigma table graph (grill Q2/Q6/Q10/Q11,
 * TDD §5.4, §7.1). Node-testable: DOM-dependent helpers guard `typeof document`.
 *
 * Token sources (single source of truth = src/app.css — NO hex here):
 *  - Root-scoped (resolve via documentElement): --clr-edge-out/-h, --clr-edge-in/-h,
 *    --clr-edge-schema, --clr-node-* , --clr-label-*, --clr-text, --clr-text-faint
 *  - Module accents are SCOPED to [data-module="X"] selectors in app.css, so they
 *    CANNOT be read from documentElement — a hidden probe element carries the
 *    attribute while getComputedStyle resolves --mod-clr.
 */

/** Locked faintness for plumbing edges when "Show plumbing" is OFF (Q11).
 *  Sigma's stock line program has no dash support — faintness stands in for
 *  dashed, same precedent as Second Brain's similarity edges (0.7/0.18). */
export const PLUMBING_FAINT_ALPHA = 0.18

/**
 * Node size formula (Q2, Second Brain NODE_SIZE shape).
 * M5 readability: raised base 2.5 → 4.0 and per-degree slope 0.25 → 0.45 so
 * hubs read clearly at a glance (degree 24 → ~15 units vs ~8.5 before).
 * @param {number} degree distinct FK neighbours within the rendered slice
 */
export function nodeSize(degree) {
  return 4 + Math.min(degree, 24) * 0.45
}

/**
 * Edge thickness px from specificity bucket (Q6: rarest wins → thickest).
 * Inverted artifact: bucket 3 = rare = 4px … bucket 0 = common = 1px.
 * M5 readability: floor 1.5px keeps common joins visible on busy panes.
 * @param {number} maxBucket 0|1|2|3
 */
export function edgeThickness(maxBucket) {
  return Math.max(1.5, Math.min(4.5, (maxBucket | 0) + 1.5))
}

/**
 * Direction class relative to an anchor node. fk semantics: edge.from is the
 * CHILD, edge.to the PARENT. An edge points INTO the anchor when anchor is
 * the parent side → 'in' (green), otherwise 'out' (blue).
 * @param {{ from: string; to: string }} edge
 * @param {string | null | undefined} anchor
 * @returns {'in'|'out'}
 */
export function classifyEdge(edge, anchor) {
  if (anchor && edge.to === anchor) return 'in'
  return 'out'
}

/**
 * Rewrite the alpha channel of a css color string. Handles rgba()/rgb();
 * passes through anything else untouched (defensive against future hex tokens).
 * @param {string} color e.g. "rgba(90, 148, 232, 0.30)"
 * @param {number} alpha
 * @returns {string}
 */
export function withAlpha(color, alpha) {
  const m = /rgba?\(([^)]+)\)/.exec(color ?? '')
  if (!m) return color
  const parts = m[1].split(',').map((s) => s.trim())
  if (parts.length < 3) return color
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`
}

/** @returns {boolean} true when the site is in dark mode (default). */
export function isDarkMode() {
  if (typeof document === 'undefined') return true
  return !document.documentElement.classList.contains('light')
}

/**
 * Read every colour the graph needs from computed styles. Re-runs on theme
 * flip (MutationObserver) — never cached across toggles.
 * @param {typeof document} [docLike] injectable for tests
 * @returns {{
 *   dark: boolean,
 *   text: string, textFaint: string, bg: string,
 *   edgeOut: string, edgeOutH: string, edgeIn: string, edgeInH: string, edgeSchema: string,
 *   nodeSatBd: string, nodeCtr: string, labelBg: string, labelBd: string,
 *   modules: Record<string, string>
 * }}
 */
export function readPalette(docLike = typeof document !== 'undefined' ? document : undefined) {
  if (!docLike) throw new Error('readPalette requires a DOM')
  const root = docLike.defaultView ? docLike.defaultView.getComputedStyle(docLike.documentElement) : null
  const v = (name) => (root ? root.getPropertyValue(name).trim() : '')
  const palette = {
    dark: isDarkMode(),
    text: v('--clr-text'),
    textFaint: v('--clr-text-faint'),
    bg: v('--clr-bg'),
    edgeOut: v('--clr-edge-out'),
    edgeOutH: v('--clr-edge-out-h'),
    edgeIn: v('--clr-edge-in'),
    edgeInH: v('--clr-edge-in-h'),
    edgeSchema: v('--clr-edge-schema'),
    nodeSatBd: v('--clr-node-sat-bd'),
    nodeCtr: v('--clr-node-ctr'),
    labelBg: v('--clr-label-bg'),
    labelBd: v('--clr-label-bd'),
    modules: {},
  }
  // Probe scoped [data-module] accents — one detached-in-body element reused
  // across modules; getComputedStyle forces synchronous recalc per mutation.
  try {
    const probe = docLike.createElement('div')
    probe.style.display = 'none'
    docLike.body.appendChild(probe)
    for (const m of ['Sales', 'Procurement', 'Production', 'Inventory', 'Project', 'Finance', 'HR', 'Service']) {
      probe.setAttribute('data-module', m)
      palette.modules[m] = docLike.defaultView.getComputedStyle(probe).getPropertyValue('--mod-clr').trim()
    }
    probe.remove()
  } catch {
    /* body unavailable (SSR/test) — modules stay empty, reducers fall back */
  }
  return palette
}
