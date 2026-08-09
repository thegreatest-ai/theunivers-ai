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

/**
 * Inline SVG marks rather than image files: no extra request, no flash of a missing logo, and
 * nothing to break if an asset path changes. Google's is the official four-colour "G" and must
 * keep its own colours — their brand guidelines do not permit recolouring it. GitHub's mark is
 * monochrome and inherits currentColor, so it follows the button's text in either theme.
 */
const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z"/>
    <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z"/>
    <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.5C3 17.1 2.1 20.4 2.1 24s.9 6.9 2.4 9.9l7.3-5.7z"/>
    <path fill="#EA4335" d="M24 10.6c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9.2 12.2-9.2z"/>
  </svg>
);

const GitHubMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.5 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.2.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z"/>
  </svg>
);

const PROVIDERS = [
  { key: 'google', label: 'Google', Mark: GoogleMark },
  { key: 'github', label: 'GitHub', Mark: GitHubMark },
];

export default function SignIn() {
  const nav = useNavigate();
  // A reset link lands here as /app/signin?token=… , so the mode is picked from the URL.
  const initialToken = new URLSearchParams(window.location.search).get('token') || '';
  const [mode, setMode] = useState(initialToken ? 'reset' : 'signin');  // signin | create | forgot | reset
  const [resetToken, setResetToken] = useState(initialToken);
  const [oauth, setOauth] = useState({});
  const [f, setF] = useState({ name: '', email: '', password: '', invite: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [blurred, setBlurred] = useState({});      // per field, so nothing turns red before use
  const [pwFocus, setPwFocus] = useState(false);

  useEffect(() => { api.providers().then(setOauth).catch(() => setOauth({ failed: true })); }, []);

  // The OAuth callback redirects here with ?error=… when it refuses. Without reading it the user
  // is simply bounced back to sign-in with no explanation — which is exactly what happened: the
  // server said "an invite is needed to create an account" and nobody ever saw it.
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('error');
    if (!e) return;
    setError(e);
    setMode('create');   // the refusals are all about joining, so land them where they can fix it
    window.history.replaceState({}, '', '/app/signin');   // don't let a reload re-raise it
  }, []);

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setError(''); };
  const blur = (k) => () => setBlurred({ ...blurred, [k]: true });

  const pw = checkPassword(f.password);
  const anyProvider = PROVIDERS.some((p) => oauth[p.key]);

  // Deliberately permissive: one @, something either side, a dot in the domain. Stricter regexes
  // reject addresses that are perfectly valid and the only real test is whether mail arrives.
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const nameOk = f.name.trim().length > 0;

  // A field turns red only after it has been used and left — not while someone is still typing
  // their first character, which is the most common way validation feels hostile.
  const badName = mode === 'create' && blurred.name && !nameOk;
  // Empty counts as invalid once the field has been left, same as the name — an untouched form
  // stays neutral, a form you have been through and left incomplete shows you where.
  const badEmail = blurred.email && !emailOk;

  // The checklist appears when the box is selected, and stays if they leave it unsatisfied —
  // otherwise the reason the button is disabled disappears at the moment they need it.
  const showRules = (mode === 'create' || mode === 'reset') && (pwFocus || (blurred.password && f.password && !pw.ok));

  const canSubmit =
    mode === 'reset' ? pw.ok
    : mode === 'forgot' ? emailOk
    : mode === 'signin' ? Boolean(emailOk && f.password)
    : Boolean(nameOk && emailOk && (!oauth.inviteRequired || f.invite) && pw.ok);   // create: the gate

  async function submit(e) {
    e.preventDefault();
    setBlurred({ name: true, email: true, password: true });
    if (!canSubmit || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'forgot') {
        const r = await api.forgot({ email: f.email });
        // With no mailer, the server hands the token straight back. Rather than printing it and
        // leaving the user at a dead end, walk them into the reset step — the same screen a real
        // email link would open. When SMTP exists, this branch stops firing on its own.
        if (r.__pilotOnly?.resetToken) {
          setResetToken(r.__pilotOnly.resetToken);
          setF({ ...f, password: '' });
          setMode('reset');
          setNotice('No mail is configured yet, so you have been taken straight to the reset step.');
        } else {
          setNotice(r.message);
        }
      } else if (mode === 'reset') {
        const r = await api.reset({ token: resetToken, password: f.password });
        setSession(r.sessionToken);
        nav(r.hasAgent ? '/app' : '/app/deploy');
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
    // Creating an account needs an invite; signing in does not. The server enforces the same
    // split at the callback, once the provider has said who this is.
    // `oauth` is {} until /api/auth/providers answers, so inviteRequired is undefined on the
    // first render. Guarding on it directly let a fast click send an EMPTY invite to Google —
    // the account was then refused at the callback and the user bounced back here silently.
    // Treat "not yet known" as "required": the safe direction is to ask.
    const knowsConfig = 'inviteRequired' in oauth;
    if (mode === 'create' && (!knowsConfig || oauth.inviteRequired) && !f.invite.trim()) {
      setError(knowsConfig
        ? 'Enter your invite code first — it is only needed to create an account.'
        : 'One moment — still checking whether an invite is needed.');
      return;
    }
    window.location.href = `/api/auth/${key}?invite=${encodeURIComponent(f.invite.trim())}`;
  }

  return (
    <div className="app-centre">
      <p className="kicker">theunivers.ai</p>
      <h1 className="app-hero" style={{ fontSize: 'clamp(2.1rem,5vw,3.4rem)' }}>
        {mode === 'create' ? <>Merge the <span className="grad">universes</span></>
          : mode === 'forgot' ? 'Reset your password.'
          : mode === 'reset' ? <>Set a new <span className="grad">password</span>.</>
          : <>Welcome <span className="grad">back</span>.</>}
      </h1>
      <p className="app-note">
        {mode === 'create' ? (oauth.inviteRequired ? 'Invite-only while we run the pilot.' : 'Create your account and merge the universes.')
          : mode === 'forgot' ? (oauth.mailer
              ? 'We’ll send a link to set a new one.'
              : 'Enter your email and we’ll take you straight to the reset step.')
          : mode === 'reset' ? 'Choose something you haven’t used elsewhere.'
          : 'Sign in to your univers.'}
      </p>

      <form className="app-form" onSubmit={submit} noValidate>
        {mode === 'create' && (
          <>
            {/* Shown only when the server says joining needs a code (INVITE_REQUIRED). The form
                is drawn from /api/auth/providers so it can never ask for something the server
                does not want, or omit something it does. */}
            {oauth.inviteRequired && (
              <div className="app-field"><label>Invite code</label>
                <input value={f.invite} onChange={set('invite')} placeholder="univers-pilot" autoComplete="off" /></div>
            )}
            <div className="app-field">
              <label>Name</label>
              <input
                className={badName ? 'bad' : ''}
                value={f.name} onChange={set('name')} onBlur={blur('name')} autoComplete="name"
              />
              {badName && <span className="app-bad">Your name is required.</span>}
            </div>
          </>
        )}

        {mode !== 'reset' && (
        <div className="app-field">
          <label>Email</label>
          <input
            className={badEmail ? 'bad' : ''}
            type="email" value={f.email} onChange={set('email')} onBlur={blur('email')}
            autoComplete="email"
          />
          {badEmail && (
            <span className="app-bad">
              {f.email.trim() ? 'That doesn’t look like an email address.' : 'Your email is required.'}
            </span>
          )}
        </div>
        )}

        {mode !== 'forgot' && (
          <div className="app-field">
            <label>{mode === 'reset' ? 'New password' : 'Password'}</label>
            <input
              type="password" value={f.password} onChange={set('password')}
              onFocus={() => setPwFocus(true)}
              onBlur={() => { setPwFocus(false); blur('password')(); }}
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            />
          </div>
        )}

        {/* Live checklist — the same rules the server enforces, shown as you type rather than
            thrown back after submit. Nothing is marked failed until the field has been used. */}
        {showRules && (
          <ul className="app-pwrules">
            {pw.results.map((r) => (
              <li key={r.id} className={r.ok ? 'ok' : (f.password ? 'no' : '')}>
                <span className="mark">{r.ok ? '✓' : '·'}</span>{r.label}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="app-error">{error}</p>}
        {notice && <p className="app-notice">{notice}</p>}

        <button className="app-cta" type="submit" disabled={!canSubmit || busy}>
          {busy ? 'One moment…'
            : mode === 'create' ? 'Create account'
            : mode === 'forgot' ? (oauth.mailer ? 'Send reset link' : 'Continue')
            : mode === 'reset' ? 'Set new password'
            : 'Sign in'}
        </button>


      </form>

      {anyProvider && mode !== 'forgot' && mode !== 'reset' && (
        <>
          <div className="divider" style={{ maxWidth: 440, width: '100%' }}>
            <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />or<span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          </div>
          <div className="sso" style={{ maxWidth: 440, width: '100%' }}>
            {PROVIDERS.filter((p) => oauth[p.key]).map((p) => (
              <button key={p.key} type="button" className="sso-btn" onClick={() => startOAuth(p.key)}>
                <p.Mark /> Continue with {p.label}
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
