/**
 * Navigation — one set of destinations, two shapes.
 *
 * ─── What is borrowed, and what is deliberately not ──────────────────────────────────────
 *
 * BORROWED, because Instagram and X both settled on it and it works:
 *
 *   · the same destinations as a left sidebar on desktop and a bottom bar on a phone. Never two
 *     different navigations — that is two products to keep in agreement, and ADR-0002 exists
 *     because the mockups already contained four.
 *   · compose as its own affordance, not a tab. X has a prominent Post button; we have ＋ Create.
 *     Nobody navigates TO create — they create a thing and leave.
 *   · the account at the foot of the sidebar, out of the way but always reachable.
 *   · an attention count on the destination that has something waiting. X does this for
 *     notifications; here it is a pending proposal, which is literally a decision waiting on you.
 *
 * NOT BORROWED:
 *
 *   · icon-only rails. Instagram can drop labels because people open it daily and learn the
 *     glyphs. "Deals" and "Discover" are not guessable from a shape, and this app will be opened
 *     weekly at first. Labels stay.
 *   · engagement counts. The mockup showed "↑ 23" on posts. On a trade platform an upvote is
 *     theatre: the signal that matters is derived standing and whether a post points at something
 *     real. Copying the mechanic imports the incentive with it.
 *   · infinite scroll. This is a place of work, not a place to be kept.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { NavLink, useLocation } from 'react-router-dom';
import { NAV } from '../../shared/navigation.mjs';

/* Line icons at a common 24-box, stroked with currentColor so one rule colours the active item.
   Drawn rather than imported: five glyphs is less code than a dependency, and no icon font can
   be dropped by a CDN block. */
const ICONS = {
  Home: 'M3 11.5 12 4l9 7.5M6 10v10h12V10',
  Discover: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4',
  Messages: 'M4 5h16v11H8l-4 4V5Z',
  Deals: 'M4 7h16v12H4zM4 7l2-3h12l2 3M9 12h6',
  You: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21a8 8 0 0 1 16 0',
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/**
 * `counts` maps a destination label to a number worth interrupting someone for.
 * Only genuine attention — a pending decision — earns a badge. A count of things that merely
 * happened is a notification habit, and this is a tool.
 */
export default function Nav({ counts = {}, onCreate }) {
  const loc = useLocation();

  const items = NAV.map((n) => {
    const count = counts[n.label] ?? 0;
    // `end` on the index route only, or Home stays highlighted everywhere beneath /app.
    return (
      <NavLink
        key={n.to}
        to={n.to}
        end={n.to === '/app'}
        className={({ isActive }) => `nav-item${isActive ? ' on' : ''}`}
        title={n.hint}
      >
        <span className="nav-icon">
          <Icon name={n.label} />
          {count > 0 && <span className="nav-dot" aria-hidden="true" />}
        </span>
        <span className="nav-label">{n.label}</span>
        {count > 0 && (
          <span className="nav-count" aria-label={`${count} waiting`}>{count > 9 ? '9+' : count}</span>
        )}
      </NavLink>
    );
  });

  return (
    <>
      {/* Desktop: a rail that stays put. */}
      <nav className="nav-rail" aria-label="Main">
        <a className="nav-brand" href="/">theunivers<span className="grad">.ai</span></a>
        <div className="nav-items">{items}</div>
        <button type="button" className="nav-create" onClick={onCreate}>
          <span aria-hidden="true">＋</span> Create
        </button>
      </nav>

      {/* Phone: the same five, thumb-height at the bottom. Rendered separately rather than
          reflowed with CSS so each can have the right markup — a bar needs no brand, and a rail
          needs no safe-area padding. */}
      <nav className="nav-bar" aria-label="Main">
        {items}
      </nav>
      <button type="button" className="nav-fab" onClick={onCreate} aria-label="Create">＋</button>

      {/* A live region so a screen reader is told when a decision arrives, rather than a badge
          appearing silently for people who cannot see it. */}
      <span className="sr-only" aria-live="polite">
        {counts.Deals > 0 ? `${counts.Deals} decisions waiting` : ''}
      </span>
      <span hidden>{loc.pathname}</span>
    </>
  );
}
