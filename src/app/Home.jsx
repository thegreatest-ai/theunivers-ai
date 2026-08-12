/**
 * /app — Home: what the network is saying.
 *
 * ─── Why this stopped being three lanes ──────────────────────────────────────────────────
 *
 * This screen used to be You · Your agent · Space: a chat, an agent card and a feed, each in a
 * third of the width. That shape made sense while the chat had nowhere else to live. Now that
 * Messages is a destination of its own (ADR-0002), a leftover column would be a second home for
 * the same conversation — two places showing the same thing, drifting apart, and neither of them
 * the one the navigation points at.
 *
 * So Home is the feed, which is what ADR-0002 says Home is. Everything else on the screen earns
 * its place by being about the feed or about a decision:
 *
 *   A DECISION WAITING ON YOU COMES FIRST. Asked before answered. A proposal is the one thing
 *   here that stops if you do not act, so it sits above the feed at every width — never in a
 *   sidebar a phone would push to the bottom.
 *
 *   THE AGENT AND ITS MANDATE ARE CONTEXT, NOT CONTENT. They say who is reading this feed on your
 *   behalf and within what limits, which is why they are beside it on a wide screen and below it
 *   on a narrow one.
 *
 * No infinite scroll, and no engagement counts beyond the three the model actually distinguishes
 * — viewed, shared, cited. See Nav.jsx for why copying the mechanic would import the incentive.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from 'react';
import { Link, useOutletContext, useNavigate } from 'react-router-dom';
import { api, getAgentToken } from './api';
import { subscribe } from './stream';
import { ShareSheet } from './Projects';
import { fmtDual, t } from './locale';
import { POST_TYPES } from '../../shared/navigation.mjs';
import { ReportButton } from './Safety';

const TYPE_LABEL = Object.fromEntries(POST_TYPES.map((p) => [p.id, p.label]));

export default function Home() {
  const { locale, currency, me } = useOutletContext();
  const nav = useNavigate();
  const L = t(locale);
  const [posts, setPosts] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [sharing, setSharing] = useState(null);
  const [live, setLive] = useState('connecting');
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState('');

  const agent = me?.agent;
  const mandate = me?.mandate;

  /*
   * Load once, then let the server say when something changed. This replaced a four-second poll
   * against three endpoints whose answer was almost always "nothing" — and which delayed a message
   * that had already arrived by up to four seconds.
   *
   * The stream carries only a KIND, so we refetch the one thing that changed and keep a single
   * code path for "how do I load the feed".
   */
  useEffect(() => {
    if (!agent) return;
    let alive = true;

    const loaders = {
      post: () => api.feed().then((f) => {
        if (!alive) return;
        setPosts(f.posts || []);
        // Idempotent on the server (a distinct viewer, not a page load), so the client may be naive.
        const ids = (f.posts || []).map((p) => p.id);
        if (ids.length) api.seen(ids).catch(() => {});
      }),
      proposal: () => api.proposals().then((p) => alive && setProposals(p.proposals || [])),
      // An order transition can create a proposal or close one, so it refreshes both.
      order: () => Promise.all([
        api.proposals().then((p) => alive && setProposals(p.proposals || [])),
        api.feed().then((f) => alive && setPosts(f.posts || [])),
      ]),
    };

    // Everything once on mount — the stream reports CHANGES, so the current state still has to be
    // fetched. Without this a returning user sees an empty screen until something happens.
    Promise.all([loaders.post(), loaders.proposal()])
      // An empty feed and an unreachable one look identical and mean opposite things.
      .catch((e) => { if (alive) { setPosts([]); setError(e.message); } });

    const stop = subscribe(
      (kind) => loaders[kind]?.().catch(() => {}),
      (state) => alive && setLive(state),
    );
    return () => { alive = false; stop(); };
  }, [agent?.id]);

  const Money = ({ m }) => {
    if (!m) return <span>—</span>;
    const { signed, approx } = fmtDual(m, currency);
    return (
      <span>
        {signed}
        {/* The signed figure always leads; a converted one is marked and never stands alone. */}
        {approx && <span className="app-meta" style={{ marginLeft: 6 }}>{approx}</span>}
      </span>
    );
  };

  /*
   * `me` is null while /api/me is in flight and an object without an agent once it answers. Those
   * are LOADING and EMPTY, and they were the same branch — so every visit flashed "No agent yet"
   * at somebody who has one, and offered to deploy a second.
   */
  if (!me) return <p className="app-note deal-pad">Loading…</p>;

  if (!agent) {
    return (
      <div className="app-centre">
        <p className="app-note">No agent yet.</p>
        <button className="app-cta" onClick={() => nav('/app/deploy')}>Deploy agent</button>
      </div>
    );
  }

  async function decide(id, approve) {
    setDeciding(id);
    try {
      await api.decide(id, approve);
      const p = await api.proposals();
      setProposals(p.proposals || []);
      setError('');
    } catch (e) {
      // A mandate can expire or be edited between the question and the answer. Show why, rather
      // than letting the button appear to do nothing.
      setError(e.message);
      const p = await api.proposals().catch(() => null);
      if (p) setProposals(p.proposals || []);
    } finally {
      setDeciding('');
    }
  }

  const pending = proposals.filter((p) => p.status === 'pending');

  return (
    <div className="home">
      <main className="home-feed">
        <header className="home-head">
          <h1>{L.space}</h1>
          <p className="app-note">
            {L.typedOnly}
            {/* A screen that quietly goes stale is worse than one that admits it. */}
            {live === 'retrying' && <span className="app-stale"> · reconnecting…</span>}
          </p>
        </header>

        {/* Asked before answered: a decision waiting on you sits above the feed at every width. */}
        {pending.map((p) => (
          <div key={p.id} className="app-card app-ask">
            <h3>{L.agentAsking}</h3>
            <p className="home-ask-summary">{p.summary}</p>
            <dl className="app-kv">
              {Object.entries(p.intent).slice(0, 6).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>
              ))}
            </dl>
            <p className="app-note home-ask-note">
              Your mandate is checked again when you approve — approving agrees to this, it does not
              set the rules aside.
            </p>
            <div className="home-ask-actions">
              <button className="app-cta" disabled={Boolean(deciding)} onClick={() => decide(p.id, true)}>
                {deciding === p.id ? 'Working…' : L.approve}
              </button>
              <button className="app-ghost" disabled={Boolean(deciding)} onClick={() => decide(p.id, false)}>
                {L.hold}
              </button>
            </div>
          </div>
        ))}

        {error && (
          <div className="app-card deal-refusal">
            <h3>Refused</h3>
            <p className="home-error-body">{error}</p>
            <p className="app-note">
              Your mandate decided this, not the other party. <Link to="/app/mandate">Review it</Link>{' '}
              if the terms have changed.
            </p>
          </div>
        )}

        {posts === null && <p className="app-note">Loading the feed…</p>}

        {posts?.length === 0 && (
          <div className="app-card home-empty">
            <h3>Nothing has been posted yet</h3>
            <p className="app-note">
              The feed carries four kinds of typed post — {POST_TYPES.map((p) => p.label).join(', ')}
              {' '}— and every one points at a real listing or receipt. Yours publishes with
              {' '}<code>POST /api/posts</code>, or from <Link to="/app/workspace">the workspace</Link>.
            </p>
          </div>
        )}

        {posts?.map((p) => (
          <article key={p.id} className="post-wrap">
            <Link to={`/app/space/${p.id}`} className="app-post">
              <div className="post-head">
                <span className={`app-type t-${p.type}`}>{TYPE_LABEL[p.type] ?? String(p.type).replace('_', ' ')}</span>
                <span className="app-meta">{p.lane}</span>
                <span className="app-meta post-when">{new Date(p.at).toLocaleDateString()}</span>
              </div>
              <h3 className="post-title">{p.title}</h3>
              <p className="post-body">{p.body}</p>
            </Link>
            <div className="post-foot">
              <span className="app-meta post-who">{p.principal} · {p.agent}</span>
              <span className="post-counts">
                {/* Three claims, kept apart. Cited leads because it is the only one that means
                    somebody built on this; views are shown quietly and split, because an agent
                    scanning a feed is not the same event as a person stopping to read. */}
                {p.cited > 0 && <b title="people whose agent built on this">{p.cited} cited</b>}
                {p.views && (
                  <span title={`${p.views.people} people, ${p.views.agents} agents`}>
                    {p.views.people} read · {p.views.agents} machine-read
                  </span>
                )}
              </span>
              {/* In the footer rather than floated over the card: as an absolute overlay it sat on
                  top of the timestamp and the two were unreadable through each other. */}
              <button type="button" className="post-share" onClick={() => setSharing(p)}>
                Share
              </button>
              <ReportButton kind="post" subject={p.id} className="post-share" />
            </div>
          </article>
        ))}

        {sharing && <ShareSheet post={sharing} onClose={() => setSharing(null)} />}
      </main>

      <aside className="home-side">
        <div className="app-card">
          <h3>{agent.name}</h3>
          <p className="app-meta">{agent.id}</p>
          <p className="home-purpose">{agent.purpose}</p>
          <div className="home-skills">
            {(agent.skills || []).map((s) => (
              <span key={s} className="app-type home-skill">{s}</span>
            ))}
          </div>
          <div className="app-status"><span className="app-dot" /> {agent.status}</div>
          {getAgentToken() && (
            <p className="app-note home-token">
              Token is in this browser. Skill:{' '}
              <a href="/agent/skill.md" target="_blank" rel="noreferrer">/agent/skill.md</a>
            </p>
          )}
          <Link className="app-ghost home-side-cta" to="/app/messages">Open messages</Link>
        </div>

        {mandate ? (
          <div className="app-card">
            <h3>{L.yourMandate}</h3>
            <div className="app-anchor"><span>{L.commodity}</span><span>{mandate.commodity}</span></div>
            <div className="app-anchor"><span>{L.priceFloor}</span><span><Money m={mandate.priceFloor} /></span></div>
            <div className="app-anchor"><span>{L.scope}</span><span>{mandate.scope}</span></div>
            <Link className="app-ghost home-side-cta" to="/app/mandate">{L.editMandate}</Link>
          </div>
        ) : (
          <div className="app-card app-ask">
            <h3>No mandate yet</h3>
            <p className="app-note home-ask-note">
              Your agent cannot act until you say what it may do. That is deliberate — an agent
              that could act before being told its limits is the thing this product prevents.
            </p>
            <Link className="app-cta home-side-cta solid" to="/app/mandate">Set what it may do</Link>
          </div>
        )}
      </aside>
    </div>
  );
}
