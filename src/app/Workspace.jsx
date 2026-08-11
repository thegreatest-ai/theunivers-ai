/**
 * /app/workspace — what you and your agent have in progress.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────────────────
 *
 * Everything else in the app is finished or happening. This is the only place that holds the
 * unfinished: a purchase order you have not sent, a post you have not published, a search you care
 * about, and whatever your agent noticed while you were away.
 *
 * Three sections, and the order is deliberate — what you owe attention to, what you asked to be
 * told about, then what came in unasked. Notes last because an agent's observation is the least
 * urgent thing on the page, however interesting it is.
 *
 * A draft ORDER is not stored as a draft. The order table already has a `drafted` state and the
 * state machine reasons about it; a second home for the same idea would let the two disagree about
 * what a draft order is. The server merges the lists instead.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import { subscribe } from './stream';

function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function Workspace() {
  const [w, setW] = useState(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ commodity: '', lane: '' });
  const [busy, setBusy] = useState(false);

  const load = () => api.workspace().then(setW).catch(() => setW({ draftOrders: [], drafts: [], watching: [], notes: [] }));

  useEffect(() => {
    load();
    // A post arriving can change a watch count, so the page reflects it without a refresh.
    return subscribe((kind) => { if (kind === 'post' || kind === 'order') load(); });
  }, []);

  async function addWatch(e) {
    e.preventDefault();
    if (!f.commodity.trim() || busy) return;
    setBusy(true);
    try {
      await api.addWatch({ commodity: f.commodity.trim(), lane: f.lane.trim() || null });
      setF({ commodity: '', lane: '' });
      setAdding(false);
      await load();
    } finally { setBusy(false); }
  }

  async function seen(id) { await api.watchSeen(id); load(); }
  async function dropWatch(id) { await api.deleteWatch(id); load(); }
  async function dropDraft(id) { await api.deleteDraft(id); load(); }

  if (!w) return <p className="app-note you-pad">Loading…</p>;

  const nothing = w.draftOrders.length === 0 && w.drafts.length === 0
    && w.watching.length === 0 && w.notes.length === 0;

  return (
    <div className="ws">
      <h1 className="set-title">Your workspace</h1>
      <p className="app-note" style={{ marginTop: -8 }}>
        Everything unfinished, and everything you asked to be told about.
      </p>

      {nothing && (
        <div className="deal-empty">
          <h2>Nothing in progress</h2>
          <p className="app-note">
            Drafts appear here as you start them — a purchase order you have not sent, a post you
            have not published. Watch a commodity below and your agent will tell you when something
            matching turns up.
          </p>
        </div>
      )}

      {(w.draftOrders.length > 0 || w.drafts.length > 0) && (
        <section className="set-group">
          <h2>Drafts</h2>
          <div className="set-rows">
            {w.draftOrders.map((o) => (
              <Link key={o.id} className="set-row" to={`/app/deals/${o.id}`}>
                <span className="set-label">
                  Purchase order · {o.commodity}
                  <span className="set-hint">
                    {o.quantity?.value} {o.quantity?.unit} · {o.price?.amount} {o.price?.currency}
                    {' · not sent — sending commits you'}
                  </span>
                </span>
                <span className="set-value">{ago(o.updatedAt)}</span>
                <span className="set-chev" aria-hidden="true">›</span>
              </Link>
            ))}
            {w.drafts.map((d) => (
              <div key={d.id} className="set-row set-inline">
                <span className="set-label">
                  {d.title || `Untitled ${d.kind}`}
                  <span className="set-hint">{d.kind} · edited {ago(d.updated_at)}</span>
                </span>
                <button className="app-link ws-drop" onClick={() => dropDraft(d.id)}>Discard</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="set-group">
        <h2>Projects</h2>
        <div className="set-rows">
          <Link className="set-row" to="/app/projects">
            <span className="set-label">
              Everything you have shared
              <span className="set-hint">Filed by subject, with the original kept beside it</span>
            </span>
            <span className="set-chev" aria-hidden="true">›</span>
          </Link>
        </div>
      </section>

      <section className="set-group">
        <h2>Watching</h2>
        <div className="set-rows">
          {w.watching.map((x) => (
            <div key={x.id} className="set-row set-inline">
              <span className="set-label">
                {x.label}
                <span className="set-hint">
                  {x.lane || 'any lane'} · {x.minTier} and above
                </span>
              </span>
              {/* "3 new" is counted from when you last looked, not stored — so it cannot drift. */}
              {x.fresh > 0
                ? <button className="ws-new" onClick={() => seen(x.id)}>{x.fresh} new</button>
                : <span className="set-value">no change</span>}
              <button className="app-link ws-drop" onClick={() => dropWatch(x.id)}>Remove</button>
            </div>
          ))}

          {adding ? (
            <form className="set-row set-inline ws-add" onSubmit={addWatch}>
              <input autoFocus placeholder="commodity — e.g. organic tomatoes"
                     value={f.commodity} onChange={(e) => setF((p) => ({ ...p, commodity: e.target.value }))} />
              <input placeholder="lane (optional)" value={f.lane}
                     onChange={(e) => setF((p) => ({ ...p, lane: e.target.value }))} />
              <button className="app-cta" disabled={busy || !f.commodity.trim()}>Watch</button>
              <button type="button" className="app-link" onClick={() => setAdding(false)}>Cancel</button>
            </form>
          ) : (
            <button className="set-row" onClick={() => setAdding(true)}>
              <span className="set-label">
                Watch something
                <span className="set-hint">Be told when a matching post appears</span>
              </span>
              <span className="set-chev" aria-hidden="true">＋</span>
            </button>
          )}
        </div>
      </section>

      {w.notes.length > 0 && (
        <section className="set-group">
          <h2>Your agent noticed</h2>
          <div className="ws-notes">
            {w.notes.map((n) => (
              <div key={n.id} className="ws-note">
                <p>{n.body}</p>
                <span className="app-meta">{ago(n.created_at)}</span>
              </div>
            ))}
          </div>
          {/* An observation is not an instruction. Nothing here changes a mandate, and the agent
              cannot act on its own notice — that is what the mandate and the proposal flow are for. */}
          <p className="app-note">
            Observations only. Nothing your agent notices can widen what it may do.
          </p>
        </section>
      )}
    </div>
  );
}
