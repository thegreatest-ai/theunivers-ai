/**
 * Numbered pages, and the reason there is no alternative.
 *
 * This component is the whole anti-infinite-scroll position expressed as code: a page has a
 * NUMBER, a TOTAL, and a LAST one. Infinite scroll removes the stopping cue, which is what it was
 * designed to do — the person who built it in 2006 has spent a decade saying so — and a feed with
 * no end is a feed that decides when you leave.
 *
 * So: nothing here or anywhere else in this app may listen to scroll position to fetch more. If
 * that appears in a diff it is the thing to reject, whatever else the diff does.
 *
 * One component rather than a pager on Home and another on Discover, for the same reason
 * shared/navigation.mjs exists: two of them would drift, and the second would be the one that
 * quietly grew an auto-load.
 */

/**
 * Which numbers to draw: the first, the last, and a window around where you are, with ellipses for
 * whatever was skipped. Eight pages fit; four hundred do not, and a row that wraps twice is not a
 * navigation.
 */
function pageNumbers(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const near = [page - 1, page, page + 1].filter((n) => n > 1 && n < pages);
  const out = [1, ...near, pages];
  const withGaps = [];
  for (let i = 0; i < out.length; i++) {
    // A gap marker, not a page. Keyed by position because two of them can appear at once.
    if (i > 0 && out[i] - out[i - 1] > 1) withGaps.push(`gap-${i}`);
    withGaps.push(out[i]);
  }
  return withGaps;
}

export default function Pager({ page, pages, onGo }) {
  if (!pages || pages <= 1) return null;

  return (
    <nav className="pgr" aria-label="Pages">
      <button className="pgr-step" disabled={page <= 1} onClick={() => onGo(page - 1)}>
        ‹<span className="sr-only">Previous page</span>
      </button>

      {pageNumbers(page, pages).map((n) => (
        typeof n === 'string'
          ? <span key={n} className="pgr-gap" aria-hidden="true">…</span>
          : (
            <button
              key={n}
              className={`pgr-n ${n === page ? 'on' : ''}`}
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onGo(n)}
            >
              {n}
            </button>
          )
      ))}

      <button className="pgr-step" disabled={page >= pages} onClick={() => onGo(page + 1)}>
        ›<span className="sr-only">Next page</span>
      </button>

      {/* The end, stated. Knowing there are eight pages is what makes stopping at three a decision
          rather than a surrender. */}
      <span className="app-meta pgr-of">Page {page} of {pages}</span>
    </nav>
  );
}
