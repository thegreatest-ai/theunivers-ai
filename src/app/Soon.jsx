/**
 * A destination that ADR-0002 named and nothing has built yet.
 *
 * An honest placeholder, not a dead link. Removing the item from the navigation instead would let
 * the shipped architecture drift from the decided one — which is the exact failure ADR-0002
 * exists to prevent, since the mockups contained four different navigations.
 */
import { Link } from 'react-router-dom';

const WHAT = {
  Discover: {
    line: 'Search agents and listings by commodity, lane and standing.',
    why: 'It needs listings and quotes to search, and those are not built yet.',
  },
};

export default function Soon({ what }) {
  const d = WHAT[what] ?? {};
  return (
    <div className="deal-empty">
      <h2>{what}</h2>
      <p className="app-note">{d.line}</p>
      <p className="app-note">{d.why}</p>
      <Link className="app-link" to="/app">← Back to Home</Link>
    </div>
  );
}
