/**
 * /app/account — how you sign in.
 *
 * Exists because of a real gap rather than for completeness: an account created through Google has
 * no password, and /api/auth/forgot has nothing to reset. Lose access to the Google account and
 * you are locked out permanently, with no route back. Setting a password gives every account a
 * second way in.
 */
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from './api';
import { checkPassword } from '../../shared/password-policy.mjs';

export default function Account() {
  const { me, setMe } = useOutletContext();
  const user = me?.user;

  const [f, setF] = useState({ currentPassword: '', password: '' });
  const [pwFocus, setPwFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const set = (k) => (e) => { setF((p) => ({ ...p, [k]: e.target.value })); setError(''); setDone(''); };

  const pw = checkPassword(f.password);
  const hasPassword = Boolean(user?.hasPassword);
  const ready = pw.ok && (!hasPassword || f.currentPassword.length > 0);

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError(''); setDone('');
    try {
      const r = await api.setPassword({
        currentPassword: hasPassword ? f.currentPassword : undefined,
        password: f.password,
      });
      // Reflect the new state immediately: the heading and copy both depend on hasPassword, and
      // leaving them stale would keep offering to "set" a password that now exists.
      setMe((m) => ({ ...m, user: r.user }));
      setF({ currentPassword: '', password: '' });
      setDone(hasPassword ? 'Password changed. Other devices have been signed out.'
                          : 'Password set. You can now sign in with your email as well as Google.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <div className="app-centre"><p className="app-note">Loading…</p></div>;

  return (
    // Locale used to live here as well. It now has one home in Settings — a switch in two places
    // is two places to look, and the second one is always the one you remember.
    <div className="app-centre" style={{ flexDirection: 'column', gap: 18 }}>
      <div className="app-card" style={{ width: '100%', maxWidth: 460 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem' }}>How you sign in</h2>
        <p className="app-note" style={{ margin: '0 0 18px' }}>{user.email}</p>

        <div className="app-anchor"><span>Method</span><span>
          {user.signInMethod === 'password' ? 'Email and password'
            : `${user.signInMethod} · no password set`}
        </span></div>

        {!hasPassword && (
          <p className="app-note" style={{ margin: '14px 0 0', lineHeight: 1.55 }}>
            This account signs in with {user.signInMethod} only. If you ever lose access to it there
            is no way back in — “forgot password” has nothing to reset. Setting a password here adds
            a second route, and does not remove the {user.signInMethod} button.
          </p>
        )}

        <form onSubmit={submit} style={{ marginTop: 20 }}>
          {hasPassword && (
            <div className="app-field">
              <label>Current password</label>
              <input
                type="password" value={f.currentPassword} onChange={set('currentPassword')}
                autoComplete="current-password"
              />
              {/* Asked for even though you are signed in: a borrowed session must not be enough to
                  seize the account permanently. */}
              <span className="app-note" style={{ marginTop: 4 }}>
                Required even while signed in, so a borrowed session cannot take the account over.
              </span>
            </div>
          )}

          <div className="app-field" style={{ marginTop: hasPassword ? 14 : 0 }}>
            <label>{hasPassword ? 'New password' : 'Choose a password'}</label>
            <input
              type="password" value={f.password} onChange={set('password')}
              onFocus={() => setPwFocus(true)} onBlur={() => setPwFocus(false)}
              autoComplete="new-password"
            />
          </div>

          {(pwFocus || (f.password && !pw.ok)) && (
            <ul className="app-pwrules">
              {pw.results.map((r) => (
                <li key={r.id} className={r.ok ? 'ok' : (f.password ? 'no' : '')}>
                  <span className="mark">{r.ok ? '✓' : '·'}</span>{r.label}
                </li>
              ))}
            </ul>
          )}

          {error && <p className="app-error">{error}</p>}
          {done && <p className="app-notice">{done}</p>}

          <button className="app-cta" style={{ width: '100%', marginTop: 16 }} disabled={!ready || busy}>
            {busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
          </button>
        </form>
      </div>
    </div>
  );
}
