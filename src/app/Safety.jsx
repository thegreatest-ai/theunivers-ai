/**
 * Report and block — the glass for the safety floor.
 *
 * A REPORT asks a person to look. It does not hide, remove, or vote. A count that acted would be
 * a brigading tool, and the first people to find that are the ones you least want holding it.
 *
 * A BLOCK is private. The other party is never told — a notification would make blocking an act
 * of confrontation, which is what somebody being harassed cannot afford. After it lands, the
 * profile 404s rather than 403s, so this screen navigates away instead of celebrating.
 *
 * Takedown is not on this surface. Withdrawal is the author's act; takedown is an operator act
 * with its own receipt (ADR-0003). A button here that said "take down" would conflate the two.
 * Queue resolve is CLI-only — no operator chrome in this client, ever in V1.
 */
import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from './api';

/**
 * The glass for a 404 on a person or an agent. Same words whether the row never existed or a
 * block hid it — the server already answers those two the same, and echoing `error.message`
 * would let a future body difference leak through the one surface the blocked party still sees.
 *
 * The blocker's own list may say "blocked". This copy is for everyone else.
 */
export const UNKNOWN = {
  person: { title: 'No such person', note: 'No one by that name is here.' },
  agent: { title: 'No such agent', note: 'No agent by that name is here.' },
};

export function UnknownSubject({ kind = 'person', to = '/app/discover', toLabel = 'Discover' }) {
  const copy = UNKNOWN[kind] || UNKNOWN.person;
  return (
    <div className="deal-empty">
      <h2>{copy.title}</h2>
      <p className="app-note">{copy.note}</p>
      <Link className="app-cta" to={to}>{toLabel}</Link>
    </div>
  );
}

export const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment' },
  { id: 'spam', label: 'Spam' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'illegal', label: 'Illegal or harmful' },
  { id: 'other', label: 'Something else' },
];

export function ReportButton({ kind, subject, className }) {
  const [open, setOpen] = useState(false);
  if (!kind || !subject) return null;
  return (
    <>
      <button type="button" className={className || 'app-link'} onClick={() => setOpen(true)}>
        Report
      </button>
      {open && (
        <ReportSheet kind={kind} subject={subject} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ReportSheet({ kind, subject, onClose }) {
  const [reason, setReason] = useState(REPORT_REASONS[0].id);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await api.report({ kind, subject, reason, detail });
      setDone(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <h3>{done.already ? 'Already with a person' : 'A person will look'}</h3>
            <p className="app-note" style={{ margin: 0 }}>
              {done.already
                ? 'You already asked for this to be looked at. Asking again would turn the queue into a vote, so it was not filed twice.'
                : (done.note || 'A person will review this. You will not be told who.')}
            </p>
            <p className="app-note" style={{ margin: 0 }}>
              You will not get a status update. If you need this person gone from your view, block them.
            </p>
            <button type="button" className="app-cta sheet-close" onClick={onClose}>Done</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h3>Report this</h3>
            <p className="app-note" style={{ margin: 0 }}>
              A person will review this. You will not be told who, and nothing is hidden by filing it.
            </p>
            <div className="app-field" style={{ marginTop: 14 }}>
              <label htmlFor="report-reason">Why</label>
              <select id="report-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REPORT_REASONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="app-field" style={{ marginTop: 12 }}>
              <label htmlFor="report-detail">Anything a reviewer should know (optional)</label>
              <textarea
                id="report-detail"
                rows={4}
                maxLength={2000}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
              />
            </div>
            {error && <p className="app-error">{error}</p>}
            <button className="app-cta" disabled={busy} type="submit">
              {busy ? 'Sending…' : 'Send to a person'}
            </button>
            <button type="button" className="app-link sheet-close" onClick={onClose}>Cancel</button>
          </form>
        )}
      </div>
    </div>
  );
}

export function BlockButton({ person, onBlocked, className }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = person?.handle || person?.id;
  if (!ref) return null;

  async function confirm() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api.block(ref);
      setOpen(false);
      onBlocked?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className || 'app-link'} onClick={() => setOpen(true)}>
        Block
      </button>
      {open && (
        <div className="sheet-back" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Block {person.name || person.handle || 'this person'}?</h3>
            <p className="app-note" style={{ margin: 0 }}>
              They will not be told. Their posts and profile disappear from your view, and yours
              from theirs. Follows both ways are removed, and unblocking does not put them back.
            </p>
            {error && <p className="app-error">{error}</p>}
            <button type="button" className="app-cta" disabled={busy} onClick={confirm}>
              {busy ? 'Blocking…' : 'Block'}
            </button>
            <button type="button" className="app-link sheet-close" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * /app/settings/blocked — your own list. Nobody else can read it, and the people on it are
 * not told they are here.
 */
export function BlockedPeople() {
  const { me } = useOutletContext();
  const [people, setPeople] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  function load() {
    api.blocks()
      .then((d) => { setPeople(d.people || []); setError(''); })
      .catch((e) => setError(e.message));
  }
  useEffect(() => { if (me?.user) load(); }, [me?.user?.id]);

  async function unblock(id) {
    if (busy) return;
    setBusy(id); setError('');
    try {
      await api.unblock(id);
      setPeople((rows) => (rows || []).filter((p) => p.id !== id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  if (!me?.user) return <p className="app-note you-pad">Loading…</p>;

  return (
    <div className="settings">
      <h1 className="set-title">People you have blocked</h1>
      <p className="app-note" style={{ margin: 0 }}>
        They are not told. Unblocking does not restore a follow — that was an act you took
        deliberately, and quietly reconnecting two people who did not ask is how a block becomes
        a pause.
      </p>
      {error && <p className="app-error">{error}</p>}
      {people === null && <p className="app-note">Loading…</p>}
      {people?.length === 0 && <p className="app-note">Nobody.</p>}
      {people?.length > 0 && (
        <ul className="set-rows" style={{ listStyle: 'none', margin: '18px 0 0', padding: 0 }}>
          {people.map((p) => (
            <li key={p.id} className="set-row set-inline">
              <span className="set-label">{p.name || p.id}</span>
              <button
                type="button"
                className="app-link"
                disabled={busy === p.id}
                onClick={() => unblock(p.id)}
              >
                {busy === p.id ? '…' : 'Unblock'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Link className="app-link" to="/app/settings">← Settings and activity</Link>
    </div>
  );
}
