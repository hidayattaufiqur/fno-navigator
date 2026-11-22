import { redirect } from '@sveltejs/kit'

// The pathfinder moved to /find. Old links (bookmarks, shared screenshots) must not 404.
export function load() {
  throw redirect(301, '/find')
}
