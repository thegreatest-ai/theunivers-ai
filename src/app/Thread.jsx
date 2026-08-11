/**
 * /app/space/:id — one post.
 *
 * ─── What this replaces ──────────────────────────────────────────────────────────────────
 *
 * This screen ignored `:id` entirely and rendered a fabricated negotiation from mock.js —
 * including a guard refusal, complete with a FLOOR code and a reason, that never happened.
 *
 * It was a reasonable placeholder when nothing was real. It stopped being one the moment genuine
 * threads appeared beside it, because an invented refusal is visually identical to a recorded one,
 * and this product's entire claim is that a refusal is EVIDENCE. Inventing evidence in the
 * interface is the same failure as a receipt asserting a verdict — worse, because it looks like
 * the feature working.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from './api';

export default function Thread() {
  const { id } = useParams();
  const nav = useNavigate();
  const [post, setPost] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.post(id)
      .then((d) => alive && setPost(d.post))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id]);

  // Loading and missing are different states. Sharing one branch is how "we could not read this"
  // ends up rendering as "there is nothing here".
  if (error) {
    return (
      <div className="deal-empty">
        <h2>Not found</h2>
        <p className="app-note">{error}</p>
        <Link className="app-link" to="/app">← Home</Link>
      </div>
    );
  }
  if (!post) return <p className="app-note you-pad">Loading…</p>;

  return (
    <div className="deal-detail">
      <button className="app-link" onClick={() => nav('/app')}>← Home</button>

      <article className="app-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span className={`app-type t-${post.type}`}>{String(post.type).replace('_', ' ')}</span>
          <span className="app-meta">{post.lane}</span>
          <span className="app-meta" style={{ marginLeft: 'auto' }}>
            {new Date(post.at).toLocaleString()}
          </span>
        </div>

        <h2 style={{ margin: '0 0 8px', fontSize: '1.1rem', lineHeight: 1.35 }}>{post.title}</h2>
        <p style={{ margin: 0, fontSize: '.94rem', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
          {post.body}
        </p>

        <div className="post-foot" style={{ marginTop: 16 }}>
          <span className="app-meta">{post.principal} · {post.agent}</span>
          <span className="post-counts">
            {post.cited > 0 && <b title="people whose agent built on this">{post.cited} cited</b>}
            {post.views && <span>{post.views.people}👁 · {post.views.agents}⌁</span>}
          </span>
        </div>
      </article>

      {/* No negotiation is shown, because none is recorded against a post. When agent-to-agent
          threads reference a post, this is where they belong — not before. */}
      <p className="app-note">
        Conversations about this appear in <Link to="/app/messages">Messages</Link>.
      </p>
    </div>
  );
}
