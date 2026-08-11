/**
 * /app/settings — Settings and activity.
 *
 * ─── The shape, and why ──────────────────────────────────────────────────────────────────
 *
 * One grouped list, as Instagram does it. The value of that pattern is not the styling: it is that
 * there is exactly ONE place a person looks for a switch. Settings scattered across the screens
 * they affect are unfindable the second time, because you have to remember which screen it was.
 *
 * Groups are named for what a person WANTS, not for the subsystem that implements it. "Who you
 * are" rather than "Account", "What you see" rather than "Locale". Somebody looking for the
 * currency toggle is not thinking about internationalisation.
 *
 * Simple switches resolve inline. Anything with consequences — a mandate, a password, becoming a
 * business — opens its own screen, so a decision that matters is never one stray tap away.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api, clearAuth } from './api';
import { LOCALES } from './locale';
import Select from './Select';
import { COUNTRIES } from './countries';
import { registrationFor } from './registrations';

function Row({ to, onClick, label, value, hint, danger }) {
  const inner = (
    <>
      <span className="set-label">
        {label}
        {hint && <span className="set-hint">{hint}</span>}
      </span>
      {value && <span className="set-value">{value}</span>}
      <span className="set-chev" aria-hidden="true">›</span>
    </>
  );
  const cls = `set-row${danger ? ' danger' : ''}`;
  return to
    ? <Link className={cls} to={to}>{inner}</Link>
    : <button type="button" className={cls} onClick={onClick}>{inner}</button>;
}

function Group({ title, children }) {
  return (
    <section className="set-group">
      <h2>{title}</h2>
      <div className="set-rows">{children}</div>
    </section>
  );
}

export default function Settings() {
  const { me, setMe, locale, setLocale } = useOutletContext();
  const nav = useNavigate();
  const user = me?.user;

  const [switching, setSwitching] = useState(false);
  const [f, setF] = useState({ jurisdiction: user?.jurisdiction ?? 'AE', licenceNo: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reg = registrationFor(f.jurisdiction);
  const isBusiness = user?.kind === 'business';

  async function setKind(kind) {
    setBusy(true); setError('');
    try {
      const r = await api.setKind(kind === 'business'
        ? { kind, jurisdiction: f.jurisdiction, licenceNo: f.licenceNo.trim(), licenceType: reg.anchorType }
        : { kind });
      setMe((m) => ({ ...m, user: r.user }));
      setSwitching(false);
      setF((p) => ({ ...p, licenceNo: '' }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <p className="app-note you-pad">Loading…</p>;

  return (
    <div className="settings">
      <h1 className="set-title">Settings and activity</h1>

      <Group title="Who you are">
        <Row to="/app/account" label="Profile" value={user.name || user.email} />
        <Row to="/app/account" label="Standing and anchors" hint="Derived from evidence, never granted" />
        <Row
          label="Acting as"
          value={isBusiness ? 'Registered business' : 'Individual'}
          onClick={() => setSwitching((v) => !v)}
        />
      </Group>

      {switching && (
        <div className="app-card set-panel">
          {isBusiness ? (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '.9rem', lineHeight: 1.55 }}>
                Switch back to acting as an individual? Your registration stays on record — it is
                retired, not deleted, because receipts may already point at standing derived while
                it was live.
              </p>
              <button className="app-cta" disabled={busy} onClick={() => setKind('individual')}>
                {busy ? 'Saving…' : 'Act as an individual'}
              </button>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 4px', fontSize: '.9rem', lineHeight: 1.55 }}>
                Acting as a business is a claim that a registration exists, so it needs the number.
                It is recorded as <b>pending</b> until somebody checks it — nothing is granted on
                your own say-so.
              </p>
              <div className="app-field" style={{ marginTop: 14 }}>
                <label>Country</label>
                <Select
                  value={f.jurisdiction}
                  onChange={(v) => setF((p) => ({ ...p, jurisdiction: v }))}
                  options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
                />
              </div>
              <div className="app-field" style={{ marginTop: 12 }}>
                <label>{reg.label}</label>
                <input value={f.licenceNo} onChange={(e) => setF((p) => ({ ...p, licenceNo: e.target.value }))}
                       placeholder={reg.placeholder} />
                <span className="app-note" style={{ marginTop: 4 }}>{reg.hint}</span>
              </div>
              {error && <p className="app-error">{error}</p>}
              <button className="app-cta" style={{ width: '100%', marginTop: 14 }}
                      disabled={busy || !f.licenceNo.trim()} onClick={() => setKind('business')}>
                {busy ? 'Saving…' : 'Act as a registered business'}
              </button>
            </>
          )}
        </div>
      )}

      <Group title="Your agent">
        <Row to="/app/mandate" label="What it may do" hint="Floor, scope, who it deals with" />
        <Row to="/app/deals" label="Deals" hint="Orders you are party to" />
      </Group>

      <Group title="What you see">
        <div className="set-row set-inline">
          <span className="set-label">
            Language and currency
            <span className="set-hint">
              Amounts always show the currency they were agreed in as well
            </span>
          </span>
          <div style={{ minWidth: 190 }}>
            <Select
              value={locale}
              onChange={setLocale}
              options={Object.entries(LOCALES).map(([k, v]) => ({
                value: k, label: `${v.label} · ${v.currency}`,
              }))}
            />
          </div>
        </div>
      </Group>

      <Group title="Privacy and your data">
        <Row to="/app/settings/privacy" label="What we store, and what we cannot delete" />
        <Row to="/app/account/signin" label="How you sign in" value={user.signInMethod === 'password' ? 'Password' : user.signInMethod} />
      </Group>

      <Group title="Session">
        <Row label="Sign out" danger onClick={() => { clearAuth(); nav('/app/signin'); }} />
      </Group>

      <p className="app-note set-foot">
        theunivers.ai · <a href="/agent/skill.md" target="_blank" rel="noreferrer">connect your own AI</a>
      </p>
    </div>
  );
}

/**
 * The privacy page.
 *
 * Written plainly and without reassurance, because the interesting parts are the limits. A page
 * that only lists protections is marketing; the useful thing is what we cannot do for you.
 */
export function Privacy() {
  return (
    <div className="settings">
      <h1 className="set-title">What we store</h1>

      <div className="app-card">
        <h3 style={{ marginTop: 0 }}>Your messages</h3>
        <p>
          Stored on our servers as ordinary text, and encrypted in transit. They are not end-to-end
          encrypted, which means we are technically able to read them. We say so rather than imply
          otherwise.
        </p>
      </div>

      <div className="app-card">
        <h3 style={{ marginTop: 0 }}>Your receipts</h3>
        <p>
          Every step of a deal is written to an append-only chain, each entry hashed with the one
          before it. <b>This is the part we cannot delete for you.</b> Removing an entry would
          invalidate every later one and destroy the record's whole purpose — for you as much as
          for a counterparty.
        </p>
        <p className="app-note">
          If you close your account we can remove your personal details. The chain retains the
          hashes and the shape of what happened, because the other party's copy depends on it.
        </p>
      </div>

      <div className="app-card">
        <h3 style={{ marginTop: 0 }}>Your standing</h3>
        <p>
          Your tier is computed from your anchors and completed deals every time it is read. It is
          not stored, cannot be set, and cannot be bought. If it is wrong, the reason it is wrong is
          shown on your profile — a score that cannot be explained cannot be appealed.
        </p>
      </div>

      <div className="app-card">
        <h3 style={{ marginTop: 0 }}>What we do not have</h3>
        <p>
          We never receive, hold or transmit money. We have no card details and no balances. When a
          deal settles, we record that it settled — the payment happens somewhere we do not reach.
        </p>
      </div>

      <Link className="app-link" to="/app/settings">← Settings and activity</Link>
    </div>
  );
}
