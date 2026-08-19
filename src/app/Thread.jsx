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
import { Link, useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { api, isUnknown } from './api';
import { ReportButton } from './Safety';
import { ShareSheet } from './Projects';
import ActionRow from './ActionRow';

export default function Thread() {
  const { id } = useParams();
  const { me } = useOutletContext();
  const nav = useNavigate();
  const [post, setPost] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState('');
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let alive = true;
    setPost(null);
    setError('');
    setActError('');
    api.post(id)
      .then((d) => alive && setPost(d.post))
      .catch((e) => alive && setError(isUnknown(e) ? 'unknown' : 'failed'));
    return () => { alive = false; };
  }, [id]);

  // Loading and missing are different states. Sharing one branch is how "we could not read this"
  // ends up rendering as "there is nothing here". A 404 body is never interpolated — same reason
  // Person does not echo a block.
  if (error === 'unknown') {
    return (
      <div className="deal-empty">
        <h2>No such post</h2>
        <p className="app-note">Nothing by that id is here.</p>
        <Link className="app-link" to="/app">← Home</Link>
      </div>
    );
  }
  if (error) {
    return (
      <div className="deal-empty">
        <h2>Could not open this</h2>
        <Link className="app-link" to="/app">← Home</Link>
      </div>
    );
  }
  if (!post) return <p className="app-note you-pad">Loading…</p>;

  const mine = Boolean(me?.agent?.name && post.agent && me.agent.name === post.agent);

  async function withdraw() {
    if (busy) return;
    if (!confirm(
      'Withdraw this post? Title and body are emptied for good. Citations of it still resolve here. This cannot be undone.',
    )) return;
    setBusy(true);
    setActError('');
    try {
      const r = await api.withdraw(post.id);
      setPost({
        ...post,
        withdrawn: true,
        withdrawnAt: r.at,
        title: '',
        body: '',
        cited: r.citations ?? post.cited,
      });
    } catch (e) {
      setActError(e.message);
    } finally {
      setBusy(false);
    }
  }

  /* Three states, one component. limited keeps the body for the author (appeal);
   * withdrawn/takenDown empty it. Never name a person in the public string — role only. */
  if (post.limited && !mine) {
    const at = post.limitedAt;
    return (
      <div className="deal-detail">
        <button className="app-link" onClick={() => nav('/app')}>← Home</button>
        <article className="app-card">
          <h2 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>
            Limited by the operator of this node
          </h2>
          <p className="app-note" style={{ margin: 0 }}>
            {at ? `On ${new Date(at).toLocaleDateString()}. ` : ''}
            Hidden from the feed. The payload is retained for review — not emptied.
          </p>
          {post.cited > 0 && (
            <p className="app-meta" style={{ margin: '10px 0 0' }}>
              {post.cited} citation{post.cited === 1 ? '' : 's'} still resolve here.
            </p>
          )}
        </article>
      </div>
    );
  }

  if (post.takenDown || post.withdrawn) {
    const at = post.takenDownAt || post.withdrawnAt;
    return (
      <div className="deal-detail">
        <button className="app-link" onClick={() => nav('/app')}>← Home</button>
        <article className="app-card">
          <h2 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>
            {post.takenDown ? 'Removed by the operator of this node' : 'Withdrawn by the author'}
          </h2>
          <p className="app-note" style={{ margin: 0 }}>
            {at ? `On ${new Date(at).toLocaleDateString()}. ` : ''}
            Historically valid, currently unavailable — a citation of this still resolves.
            The payload is gone.
          </p>
          {post.cited > 0 && (
            <p className="app-meta" style={{ margin: '10px 0 0' }}>
              {post.cited} citation{post.cited === 1 ? '' : 's'} still resolve here.
            </p>
          )}
        </article>
      </div>
    );
  }

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
          <ActionRow
            shareable
            onShare={() => setSharing(true)}
            cited={post.cited}
            views={post.views}
          />
          {mine ? (
            <button type="button" className="app-link" disabled={busy} onClick={withdraw}>
              {busy ? 'Withdrawing…' : 'Withdraw'}
            </button>
          ) : (
            <ReportButton kind="post" subject={post.id} />
          )}
        </div>
        {actError && <p className="app-error">{actError}</p>}
      </article>
      {sharing && <ShareSheet post={post} onClose={() => setSharing(false)} />}

      {/* No negotiation is shown, because none is recorded against a post. When agent-to-agent
          threads reference a post, this is where they belong — not before. */}
      <p className="app-note">
        Conversations about this appear in <Link to="/app/messages">Messages</Link>.
      </p>
    </div>
  );
}
