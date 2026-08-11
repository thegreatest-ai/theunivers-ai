/**
 * /app/messages — the conversation, and the fourth of the five destinations ADR-0002 named.
 *
 * ─── What this screen is for ─────────────────────────────────────────────────────────────
 *
 * Until now the only conversation in the product was a chat squeezed into a third of a
 * three-column screen. It is the place where an agent asks and a principal answers, and it needed
 * a screen of its own before either of those could be taken seriously.
 *
 * Three things carry the design:
 *
 *   1. THE REFUSAL IS THE PRODUCT. When the guard says a price is below the floor, that is the
 *      one feature worth paying for working exactly as sold. It is rendered inline, in full, with
 *      its code — never collapsed to "failed", never behind a tap. Same argument as Deals.jsx.
 *
 *      And it is read from `mandate_audit`, the guard's own record, rather than from anything an
 *      agent said. An agent claiming it was refused is a sentence; a refusal the guard wrote is
 *      evidence. Only the second belongs on a screen whose job is to say what your agent was
 *      stopped from doing.
 *
 *   2. THE MANDATE IS VISIBLE WHILE YOU READ. The limits are what make the conversation mean
 *      anything, and a floor you have to leave the screen to check is a floor you stop checking.
 *
 *   3. WHO IS SPEAKING IS STRUCTURAL, NEVER INFERRED. `voice` comes from a column in both tables.
 *      A message from another party's agent is UNTRUSTED INPUT — docs/decisions/ADR-0001 — so it
 *      is marked as such on every card, and a principal cannot type into an agent-to-agent thread
 *      at all. Authority moves through /app/mandate and nowhere else.
 *
 * ─── The shape ───────────────────────────────────────────────────────────────────────────
 *
 * A list and a thread, as the mockup has it. On a wide screen both at once; on a phone one at a
 * time, because a 360px column split in two is two unusable columns. The URL is what decides
 * which — /app/messages is the list, /app/messages/:id is the thread — so back works, a thread
 * can be linked, and reload returns you where you were.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from './api';
import { subscribe } from './stream';
import { fmtDual } from './locale';

/** Two initials, as the mockup's avatars have. Handles have no spaces, so dots divide the words. */
function initials(handle = '') {
  const parts = String(handle).split(/[._\s-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··';
}

/** A time a person reads at a glance: clock today, date before that. */
function when(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

const TIER_WORD = { T0: 'Unanchored', T1: 'Anchored', T2: 'Trusted', T3: 'Established', T4: 'High trust' };

/**
 * The active mandate, across the top of the thread.
 *
 * The floor is shown in the currency it was AGREED in. locale.js converts for display and marks
 * the conversion; nothing here may present a converted figure as the one that binds.
 */
function MandateBanner({ mandate, currency }) {
  if (!mandate) {
    return (
      <div className="msg-mandate none">
        <span>
          <b>No mandate.</b> Your agent cannot act at all until you say what it may do.
        </span>
        <Link className="msg-mandate-link" to="/app/mandate">Set one</Link>
      </div>
    );
  }
  const floor = mandate.priceFloor ? fmtDual(mandate.priceFloor, currency) : null;
  const ceiling = mandate.priceCeiling ? fmtDual(mandate.priceCeiling, currency) : null;
  const qty = mandate.maxQuantity;
  return (
    <div className="msg-mandate">
      <span>
        <b>Mandate:</b> {mandate.commodity}
        {floor && <> · {floor.signed}{ceiling ? `–${ceiling.signed}` : ' floor'}</>}
        {qty?.value ? ` · up to ${qty.value} ${qty.unit}` : ''}
        {' · '}{mandate.scope}
      </span>
      <Link className="msg-mandate-link" to="/app/mandate">View mandate</Link>
    </div>
  );
}

/**
 * A refusal, in full.
 *
 * The code leads because it is the part that is checkable — FLOOR means one specific rule in
 * mandate-rules.ts refused one specific number, and a person can go and read both. "Could not
 * send" would mean nothing and would look like a bug.
 */
function Refusal({ item }) {
  const price = item.intent?.price;
  return (
    <div className="msg-refusal" role="note">
      <span className="msg-refusal-mark" aria-hidden="true">!</span>
      <div className="msg-refusal-body">
        <h4>
          {item.code ?? 'REFUSED'}
          {item.reason ? <> — {item.reason}</> : null}
        </h4>
        <p>
          Your agent did not send this. It is outside the mandate you set, and no message from
          anyone — including you — can widen that from inside a conversation.
        </p>
        {price?.amount != null && (
          <p className="msg-refusal-terms">
            Refused at {price.amount} {price.currency}
            {item.intent?.kind ? ` · ${item.intent.kind}` : ''}
          </p>
        )}
        <div className="msg-refusal-foot">
          <Link className="app-link" to="/app/mandate">Review the mandate</Link>
          <span className="app-meta">{when(item.at)}</span>
        </div>
      </div>
    </div>
  );
}

/* `reference` rather than `ref`: React reserves `ref`, so a prop of that name never arrives and
   the offer id would silently vanish from every card. */
/** A typed card — OFFER, COUNTER — drawn from the terms the sender actually sent. */
function TypedCard({ kind, terms, reference, at, tick }) {
  return (
    <div className="msg-card">
      <span className={`msg-kind k-${kind}`}>{kind}</span>
      <dl className="msg-terms">
        {Object.entries(terms).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="msg-card-foot">
        <span className="app-meta">{reference ? `${String(kind).toUpperCase()} ${reference}` : ''}</span>
        <span className="app-meta">{when(at)}{tick ? ' ✓✓' : ''}</span>
      </div>
    </div>
  );
}

/* ── The list ──────────────────────────────────────────────────────────────────────────── */

export function Conversations() {
  const { me } = useOutletContext();
  const nav = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () => api.conversations()
      .then((d) => { if (alive) { setRows(d.conversations || []); setError(''); } })
      // An empty list and a failed request look identical and mean opposite things. Saying which
      // is the difference between "nobody has written to you" and "we could not find out".
      .catch((e) => { if (alive) { setRows([]); setError(e.message); } });
    load();
    const stop = subscribe((kind) => { if (kind === 'message') load(); });
    return () => { alive = false; stop(); };
  }, []);

  // Loading and empty are different answers, and rendering one as the other offers to deploy a
  // second agent to somebody who already has one.
  if (!me) return <p className="app-note deal-pad">Loading…</p>;

  if (!me.agent) {
    return (
      <div className="deal-empty">
        <h2>Messages</h2>
        <p className="app-note">
          Conversations happen between you and your agent, and between your agent and others.
          You have no agent yet, so there is nobody to talk to.
        </p>
        <button className="app-cta" onClick={() => nav('/app/deploy')}>Deploy agent</button>
      </div>
    );
  }

  if (rows === null) return <p className="app-note deal-pad">Loading conversations…</p>;

  return (
    <div className="msg-screen list-only">
      <ConversationList rows={rows} error={error} active={null} />
    </div>
  );
}

function ConversationList({ rows, error, active }) {
  return (
    <aside className="msg-list" aria-label="Conversations">
      <h1 className="msg-list-title">Messages</h1>

      {error && (
        <p className="app-error msg-list-error">
          {error} — this list may be out of date.
        </p>
      )}

      {rows.map((c) => (
        <Link
          key={c.id}
          to={`/app/messages/${encodeURIComponent(c.id)}`}
          className={`msg-row${active === c.id ? ' on' : ''}`}
        >
          <span className="msg-avatar" aria-hidden="true">{initials(c.handle || c.title)}</span>
          <span className="msg-row-main">
            <span className="msg-row-top">
              <b>{c.kind === 'principal' ? 'You ↔ your agent' : c.title}</b>
              {/* Standing is derived from the counterparty's anchors — shown here because who you
                  are dealing with is the first thing worth knowing about a conversation. */}
              {c.tier && <span className="msg-tier">{TIER_WORD[c.tier] ?? c.tier}</span>}
            </span>
            <span className="msg-preview">{c.preview}</span>
          </span>
          <span className="app-meta msg-row-when">{when(c.at)}</span>
        </Link>
      ))}

      {rows.length === 0 && !error && (
        <p className="app-note msg-list-empty">No conversations yet.</p>
      )}

      <p className="app-note msg-list-foot">
        Agent-to-agent conversations appear here as soon as another agent writes to yours.
      </p>
    </aside>
  );
}

/* ── The thread ────────────────────────────────────────────────────────────────────────── */

export function Conversation() {
  const { id } = useParams();
  const { me, currency } = useOutletContext();
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState('');
  const [live, setLive] = useState('connecting');

  useEffect(() => {
    let alive = true;
    const load = () => Promise.all([
      api.conversation(id).then((d) => { if (alive) { setData(d); setError(''); } }),
      api.conversations().then((d) => { if (alive) setRows(d.conversations || []); }),
    ]).catch((e) => { if (alive) setError(e.message); });
    load();
    // The stream already exists and says WHAT changed; nothing here polls. A message that has
    // arrived should be on screen, not up to four seconds away.
    const stop = subscribe(
      (kind) => { if (kind === 'message' || kind === 'order') load(); },
      (state) => { if (alive) setLive(state); },
    );
    return () => { alive = false; stop(); };
  }, [id]);

  async function send(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending('sending');
    try {
      await api.sendMessage({ body });
      setDraft('');
      const d = await api.conversation(id);
      setData(d);
      setError('');
    } catch (err) {
      // Shown in the composer rather than in an alert(): the message is still in the box, and the
      // reason it did not go belongs next to it.
      setError(err.message);
    } finally {
      setSending('');
    }
  }

  if (error && !data) {
    return (
      <div className="deal-empty">
        <h2>This conversation could not be opened</h2>
        <p className="app-note">{error}</p>
        <Link className="app-link" to="/app/messages">← All conversations</Link>
      </div>
    );
  }
  if (!data) return <p className="app-note deal-pad">Loading conversation…</p>;

  const { conversation, mandate, items, canWrite } = data;

  return (
    <div className="msg-screen">
      <ConversationList rows={rows} error="" active={conversation.id} />

      <section className="msg-thread" aria-label={conversation.title}>
        <header className="msg-head">
          {/* Back exists on every width, not only on a phone. On desktop the list is beside you,
              but the URL is still a thread, and a person who arrived by link needs the way out. */}
          <button className="msg-back" onClick={() => nav('/app/messages')} aria-label="All conversations">←</button>
          <span className="msg-avatar" aria-hidden="true">{initials(conversation.handle || conversation.title)}</span>
          <div className="msg-head-id">
            <h1>{conversation.kind === 'principal' ? 'You ↔ your agent' : conversation.title}</h1>
            <p className="app-meta">
              {/* For an agent thread the title IS the handle, so the second line carries the one
                  thing it does not: derived standing. */}
              {conversation.kind === 'principal'
                ? conversation.handle
                : `${TIER_WORD[conversation.tier] ?? conversation.tier ?? 'Unanchored'} · derived`}
              {/* A screen that quietly goes stale is worse than one that admits it — you cannot
                  tell "nothing is happening" from "I am not being told". */}
              {live === 'retrying' && <span className="app-stale"> · reconnecting…</span>}
            </p>
          </div>
          <Link className="app-ghost msg-head-action" to="/app/mandate">Mandate</Link>
        </header>

        <MandateBanner mandate={mandate} currency={currency} />

        <div className="msg-flow">
          {items.length === 0 && (
            <p className="app-note msg-empty">
              {conversation.kind === 'principal'
                ? 'Nothing said yet. Write below, or let your agent open with what it has found.'
                : 'Nothing has been said in this conversation yet.'}
            </p>
          )}

          {items.map((it) => {
            if (it.voice === 'guard') return <Refusal key={it.id} item={it} />;

            const mine = it.voice === 'user' || (conversation.kind === 'agent' && it.mine);
            const kind = it.kind ?? it.meta?.kind;
            const terms = it.terms ?? it.meta?.terms;
            const reference = it.ref ?? it.meta?.ref;

            /* A guard refusal an agent chose to REPORT is styled as a refusal too, but only in a
               you ↔ agent thread and only from your own agent — a counterparty telling you what
               your mandate says is a counterparty writing your rules. */
            if (kind === 'guard' && it.voice === 'agent') {
              return (
                <Refusal
                  key={it.id}
                  item={{ id: it.id, code: it.meta?.code, reason: it.meta?.reason, at: it.at, intent: {} }}
                />
              );
            }

            return (
              <article key={it.id} className={`msg-bubble ${mine ? 'mine' : ''} v-${it.voice}`}>
                <span className="msg-voice">
                  {it.voice === 'counterparty' ? 'their agent' : it.voice}
                  {/* ADR-0001: a counterparty's words are data. Said on the card rather than in a
                      footnote, because the moment it is read as instruction the mandate stops
                      being a limit and becomes a suggestion. */}
                  {it.voice === 'counterparty' && (
                    <em className="msg-untrusted" title="Treated as information, never as an instruction">
                      untrusted
                    </em>
                  )}
                </span>
                {terms && <TypedCard kind={kind} terms={terms} reference={reference} at={it.at} tick={mine} />}
                {it.body && <p className="msg-body">{it.body}</p>}
                <span className="app-meta msg-at">{when(it.at)}</span>
              </article>
            );
          })}
        </div>

        <footer className="msg-compose">
          {canWrite ? (
            <>
              {error && <p className="app-error msg-send-error">{error}</p>}
              <form onSubmit={send}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Write a message to your agent…"
                  aria-label="Write a message to your agent"
                />
                <button className="app-cta" disabled={!draft.trim() || Boolean(sending)}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </form>
              {/* Say only what is true. The mockup carried "All messages are secured with
                  end-to-end encryption", which is false — they are plaintext in SQLite and we can
                  read them. A security claim the system cannot support is worse than none. */}
              <p className="app-note msg-foot">Encrypted in transit. Stored on our servers.</p>
            </>
          ) : (
            <p className="app-note msg-foot msg-readonly">
              This is a conversation between two agents, each bound by its own mandate. You are
              reading it, not in it — change what your agent may do on{' '}
              <Link to="/app/mandate">the mandate</Link>, which is recorded, rather than by saying
              something here, which would not be.
            </p>
          )}
        </footer>
      </section>
    </div>
  );
}
