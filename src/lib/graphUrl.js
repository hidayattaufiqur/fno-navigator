// graphUrl.js — tiny shared helpers for the graph URL state.
// graph/modules live in the URL (single source of truth); /tables and /find
// both read these. Kept dependency-free (Svelte legacy runes: no $state).
//
// NOTE (Svelte 5 legacy `$:` timing): syncGraphUrl must NEVER be called
// synchronously right after mutating the reactive var it derives from —
// `$:` flushes AFTER the sync block, so it would read the stale value and
// write the OPPOSITE state (the 2e6abc5 family of bug). The caller (tables
// page) awaits a microtask/tick before calling, so graphOn is fresh.

const CANONICAL = ['Sales', 'Procurement', 'Production', 'Inventory', 'Project', 'Finance', 'HR', 'Service']

/** Modules from a URLSearchParams — only canonical ones, [] = All. */
export function modulesFromSearch(sp) {
  return (sp.get('modules') ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => CANONICAL.includes(m))
}

/**
 * Rewrite the current URL's graph params for the GIVEN state (not derived
 * reactively — explicit args sidestep the $: timing trap entirely).
 * graph=false deletes all graph params; graph=true writes graph=1 + modules
 * (modules dropped when empty or all canonical = All).
 * @param {{ graph: boolean, modules: string[] }} state
 */
export function syncGraphUrl({ graph, modules }) {
  const sp = new URLSearchParams(location.search)
  if (!graph) {
    ;['graph', 'modules'].forEach((k) => sp.delete(k))
  } else {
    sp.set('graph', '1')
    const mods = modules
    mods.length && mods.length < CANONICAL.length ? sp.set('modules', mods.join(',')) : sp.delete('modules')
  }
  history.replaceState(null, '', `${location.pathname}?${sp.toString()}`)
}
