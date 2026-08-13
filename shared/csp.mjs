/**
 * The Content-Security-Policy, in ONE place.
 *
 * It lives in `shared/` and not in the server for the same reason `shared/ranking.mjs` does: the
 * test that proves the page is not blank must serve the SAME policy the server serves, or it is
 * testing a page that cannot fail the way production failed.
 *
 * That is not hypothetical. On 2026-08-12 the marketing page was blank in production for ninety
 * minutes — a CSP-blocked fetch threw, React never mounted, and the root div stayed empty behind an
 * HTTP 200. `test/renders.test.mjs` existed precisely to catch a blank page and could not see it,
 * because its own static server sent no CSP. One definition, imported by both, so they cannot drift.
 *
 * Every external origin this product loads, enumerated — because a Content-Security-Policy written
 * from memory is how a page ends up on "Loading…" forever while the server answers 200.
 *
 *   fonts.googleapis.com  the stylesheet <link> in index.html
 *   fonts.gstatic.com     the font files that stylesheet points at
 *   cdn.jsdelivr.net      planet textures for the marketing page's three.js scene (App.jsx:10).
 *                         three itself is bundled; only the images are remote.
 *
 * Do NOT open connect-src for raw.githack.com / raw.githubusercontent.com. `<Environment
 * preset="night" />` used to pull dikhololo_night_1k.hdr from there; that path is now
 * `/assets/hdri/dikhololo_night_1k.hdr` (same file, same-origin). githack also 403s from
 * Cloudflare as of 2026-08-12 — opening CSP to a dead CDN would have "fixed" the refuse and
 * left the marketing page dark for a different reason.
 *
 * `style-src` needs 'unsafe-inline' because React writes `style={{…}}` as a style ATTRIBUTE, which
 * style-src-attr blocks without it. `script-src` deliberately does NOT get the same concession:
 * scripts are the surface that matters, index.html has no inline script, and Vite emits a module
 * with a src. If a future change needs an inline script, give it a nonce rather than opening this.
 *
 * No HSTS here: it is set by whatever terminates TLS, and asserting it from a process that also
 * serves plain http in development is how a developer locks their own browser out of localhost.
 */
export const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://cdn.jsdelivr.net",
  "media-src 'self' blob:",
  "connect-src 'self' https://cdn.jsdelivr.net",
].join('; ');
