/**
 * The catch-all route.
 *
 * ─── Why an unmatched URL is a screen and not an oversight ───────────────────────────────
 *
 * Without a `path="*"` route, react-router matches nothing, renders nothing, and leaves an empty
 * <div id="root"> behind. That is pixel-for-pixel the blank page a crash produces — so a mistyped
 * address, a stale bookmark or a link shared with a truncated path all look exactly like the
 * application being broken. The visitor cannot tell the two apart, and neither could I: this was
 * found while verifying the fix for a real crash, by opening a URL that had never existed.
 *
 * So this screen exists to make "there is nothing here" say so, and to offer the way back that a
 * blank page cannot.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { Link, useLocation } from 'react-router-dom';

export default function NotFound() {
  const { pathname } = useLocation();

  return (
    <div className="deal-empty">
      <h2>There is nothing at this address</h2>

      {/* Show the path back to them. It is the fastest way to spot a typo or a truncated link,
          and it distinguishes this screen from a failure with no explanation. */}
      <p className="app-note">
        <code>{pathname}</code> does not match anything on theunivers.ai.
      </p>

      <div className="nf-actions">
        <Link className="app-cta" to="/app">Go to Home</Link>
        <Link className="app-link" to="/">The front page</Link>
      </div>
    </div>
  );
}
