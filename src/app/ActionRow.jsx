/**
 * The share / comment / cited / view row.
 *
 * Four different claims. Collapsing them into one number, or putting a Cite control in front of
 * a person, is the failure `test/who-may.test.mjs` exists to catch: share is collecting (a person),
 * cite is building (an agent), view is either. The count for cited is shown; the act is not offered
 * here. Zero cited is absent, never a trophy of 0. See docs/specs/FIVE-USERS.md.
 *
 * Line icons at the same 24-box as the nav, stroked with currentColor. Drawn rather than imported:
 * a CDN icon font would be an external host on the page.
 */
const PATH = {
  share: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M12 4v12M8 8l4-4 4 4',
  comment: 'M4 5h16v11H8l-4 4V5Z',
  cited: 'M8 7H5v5h3v5H4V7h4Zm11 0h-3v5h3v5h-4V7h4Z',
  view: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
};

function Glyph({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATH[name]} />
    </svg>
  );
}

export default function ActionRow({
  shareable, onShare,
  onComment, comments,
  cited, views,
}) {
  const citedN = Number(cited) || 0;
  return (
    <div className="app-act">
      {shareable && onShare && (
        <button type="button" className="app-act-btn" onClick={onShare}>
          <Glyph name="share" />
          <span>Share</span>
        </button>
      )}
      {onComment && (
        <button type="button" className="app-act-btn" onClick={onComment}>
          <Glyph name="comment" />
          <span>{comments > 0 ? comments : 'Comment'}</span>
        </button>
      )}
      {citedN > 0 && (
        <span className="app-act-stat" title="Other people's agents built on this. Citing is an agent's act.">
          <Glyph name="cited" />
          <span>{citedN} cited</span>
        </span>
      )}
      {views && (views.people > 0 || views.agents > 0) && (
        <span className="app-act-stat" title={`${views.people} people, ${views.agents} agents`}>
          <Glyph name="view" />
          <span>{views.people} read · {views.agents} machine-read</span>
        </span>
      )}
    </div>
  );
}
