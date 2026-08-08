/**
 * /app/signin — sign in, create an account, or reset a password.
 *
 * The password rules come from shared/password-policy.mjs, the SAME module the server enforces.
 * Two copies would drift: the form would accept what the API rejects, or someone would "fix" the
 * API to match the form. What you see live here is exactly what /api/auth/register applies.
 *
 * The live checklist is a courtesy, not a gate. The gate is server-side — this form is not a
 * security boundary and anyone can POST straight to the endpoint.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from './api';
import { checkPassword } from '../../shared/password-policy.mjs';

const PROVIDERS = [
  { key: 'google', label: 'Google' },
  { key: 'github', label: 'GitHub' },
];

export default function SignIn() {
  const nav = useNavigate();
  const [mode, setMode] = useState('signin');        // signin | create | forgot
  const [oauth, setOauth] = useState({});
  const [f, setF] = useState({ name: '', email: '', password: '', invite: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => { api.providers().then(setOauth).catch(() => setOauth({})); }, []);

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setError(''); };
  const pw = checkPassword(f.password);
  const anyProvider = PROVIDERS.some((p) => oauth[p.key]);

  const canSubmit =
    mode === 'forgot' ? Boolean(f.email)
    : mode === 'signin' ? Boolean(f.email && f.password)
    : Boolean(f.name && f.email && f.invite && pw.ok);   // create: the gate

  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'forgot') {
        const r = await api.forgot({ email: f.email });
        setNotice(r.message);
        // No mailer is wired up in the pilot, so the server hands the token back. Shown as a
        // link rather than hidden, and clearly labelled as a pilot-only shortcut.
        if (r.__pilotOnly?.resetToken) {
          setNotice(`${r.message}  ·  Pilot shortcut: token ${r.__pilotOnly.resetToken}`);
        }
      } else if (mode === 'signin') {
        const r = await api.login({ email: f.email, password: f.password });
        setSession(r.sessionToken);
        nav(r.hasAgent ? '/app' : '/app/deploy');
      } else {
        const r = await api.register({
          name: f.name, email: f.email, password: f.password, inviteCode: f.invite,
        });
        setSession(r.sessionToken);
        nav('/app/deploy');
      }
    } catch (e2) {
      setError(e2.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function startOAuth(key) {
    if (!f.invite.trim() && mode === 'create') {
      setError('Enter your invite code first.');
      return;
    }
    window.location.href = `/api/auth/${key}?invite=${encodeURIComponent(f.invite.trim())}`;
  }

  return (
    <div className="app-centre">
      <p className="kicker">theunivers.ai</p>
      <h1 className="app-hero" style={{ fontSize: 'clamp(2.1rem,5vw,3.4rem)' }}>
        {mode === 'create' ? <>Deploy your <span className="grad">agent</span>.</>
          : mode === 'forgot' ? 'Reset your password.'
          : <>Welcome <span className="grad">back</span>.</>}
      </h1>
      <p className="app-note">
        {mode === 'create' ? 'Invite-only while we run the pilot.'
          : mode === 'forgot' ? 'We’ll send a link to set a new one.'
          : 'Sign in to your agent.'}
      </p>

      <form className="app-form" onSubmit={submit} noValidate>
        {mode === 'create' && (
          <>
            <div className="app-field"><label>Invite code</label>
              <input value={f.invite} onChange={set('invite')} placeholder="univers-pilot" autoComplete="off" /></div>
            <div className="app-field"><label>Name</label>
              <input value={f.name} onChange={set('name')} autoComplete="name" /></div>
          </>
        )}

        <div className="app-field"><label>Email</label>
          <input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></div>

        {mode !== 'forgot' && (
          <div className="app-field">
            <label>Password</label>
            <input
              type="password" value={f.password} onChange={set('password')}
              onBlur={() => setTouched(true)}
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            />
          </div>
        )}

        {/* Live checklist — the same rules the server enforces, shown as you type rather than
            thrown back after submit. Nothing is marked failed until the field has been used. */}
        {mode === 'create' && (
          <ul className="app-pwrules">
            {pw.results.map((r) => (
              <li key={r.id} className={r.ok ? 'ok' : (touched || f.password ? 'no' : '')}>
                <span className="mark">{r.ok ? '✓' : '·'}</span> {r.label}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="app-error">{error}</p>}
        {notice && <p className="app-notice">{notice}</p>}

        <button className="app-cta" type="submit" disabled={!canSubmit || busy}>
          {busy ? 'One moment…'
            : mode === 'create' ? 'Create account'
            : mode === 'forgot' ? 'Send reset link'
            : 'Sign in'}
        </button>

        {mode === 'create' && !pw.ok && f.password && (
          <p className="app-note" style={{ margin: 0 }}>
            The button unlocks when every rule above is met.
          </p>
        )}
      </form>

      {anyProvider && mode !== 'forgot' && (
        <>
          <div className="divider" style={{ maxWidth: 440, width: '100%' }}>
            <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />or<span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          </div>
          <div className="sso" style={{ maxWidth: 440, width: '100%' }}>
            {PROVIDERS.filter((p) => oauth[p.key]).map((p) => (
              <button key={p.key} type="button" className="sso-btn" onClick={() => startOAuth(p.key)}>
                Continue with {p.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="app-switch">
        {mode !== 'signin' && <button type="button" onClick={() => { setMode('signin'); setError(''); }}>Sign in</button>}
        {mode !== 'create' && <button type="button" onClick={() => { setMode('create'); setError(''); }}>Create an account</button>}
        {mode !== 'forgot' && <button type="button" onClick={() => { setMode('forgot'); setError(''); }}>Forgot my password</button>}
      </div>

      {!anyProvider && (
        <p className="app-note">
          Google and GitHub sign-in appear here once their credentials are in <code>.env</code>.
        </p>
      )}
    </div>
  );
}
