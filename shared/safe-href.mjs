/**
 * What may become an href — ONE definition, imported by the glass now, the write path later.
 *
 * A javascript: or data: URL in an <a href> is a program the next person clicks. The server
 * already refuses those on POST /api/profile/edit. The glass must refuse them on render too,
 * because a row written by hand, a migration, or a future route that forgets the check would
 * otherwise execute. Client-side filtering is not the gate; it is the last fence.
 *
 * Same regex the write path uses today (`server/index.mjs` profile/edit). Two copies of this
 * would drift the way the mandate guard did: the form would accept what the API rejects, or
 * the profile would render what the form was told it had refused. claude-code: import this
 * rather than keep the literal in the route.
 */

const WEB = /^https?:\/\/\S+$/i;

export function isWebAddress(url) {
  return WEB.test(String(url ?? '').trim());
}

/** The href to use, or null. Never return the original string if it failed. */
export function safeHref(url) {
  const u = String(url ?? '').trim();
  return WEB.test(u) ? u : null;
}
