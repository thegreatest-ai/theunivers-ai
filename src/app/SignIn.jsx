/** /app/signin — invite + Google / GitHub fast connect */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, setSession } from './api';

const API = import.meta.env.VITE_API_URL ?? '';

export default function SignIn() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState('register');
  const [inviteCode, setInvite] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(params.get('error') || '');
  const [busy, setBusy] = useState(false);
  const [oauth, setOauth] = useState({ google: false, github: false });

  useEffect(() => {
    fetch(`${API}/api/auth/providers`)
      .then((r) => r.json())
      .then(setOauth)
      .catch(() => {});
  }, []);

  function startOAuth(provider) {
    const invite = inviteCode.trim();
    if (!invite) {
      setError('Enter your invite code first, then connect with Google or GitHub.');
      return;
    }
    window.location.href = `${API}/api/auth/${provider}?invite=${encodeURIComponent(invite)}`;
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') {
        const data = await api.register({ inviteCode, email, name });
        setSession(data.sessionToken);
        nav('/app/deploy');
      } else {
        const data = await api.login({ inviteCode, email });
        setSession(data.sessionToken);
        nav(data.agent ? '/app' : '/app/deploy');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-centre">
      <p className="kicker">theunivers.ai · private pilot</p>
      <h1 className="app-hero"><span className="grad">Connect both worlds.</span></h1>
      <p className="app-note">Invite-only. Fast sign-in with Google or GitHub, then deploy your agent.</p>

      <div className="panel" style={{ maxWidth: 400, margin: '18px 0 0' }}>
        <div className="app-field">
          <label>Invite code</label>
          <input
            value={inviteCode}
            onChange={(e) => setInvite(e.target.value)}
            placeholder="univers-pilot"
            required
          />
        </div>

        <div className="sso" style={{ marginTop: 4 }}>
          <button
            type="button"
            className="sso-btn"
            disabled={!oauth.google}
            onClick={() => startOAuth('google')}
            title={oauth.google ? 'Continue with Google' : 'Set GOOGLE_CLIENT_ID / SECRET in .env'}
          >
            Continue with Google
          </button>
          <button
            type="button"
            className="sso-btn"
            disabled={!oauth.github}
            onClick={() => startOAuth('github')}
            title={oauth.github ? 'Continue with GitHub' : 'Set GITHUB_CLIENT_ID / SECRET in .env'}
          >
            Continue with GitHub
          </button>
          {!oauth.google && !oauth.github && (
            <p className="app-note" style={{ margin: 0 }}>
              OAuth buttons unlock when you add Google / GitHub client credentials to <code>.env</code>.
            </p>
          )}
        </div>

        <div className="divider"><span>or email</span></div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mode === 'register' && (
            <div className="app-field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ramesh Bhosale" required />
            </div>
          )}
          <div className="app-field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" required />
          </div>
          {error && <p className="app-note" style={{ color: '#f87171' }}>{error}</p>}
          <button className="app-cta" type="submit" disabled={busy}>
            {busy ? '…' : mode === 'register' ? 'Create account ✦' : 'Sign in ✦'}
          </button>
          <button
            type="button"
            className="app-ghost"
            onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
          >
            {mode === 'register' ? 'Already registered? Sign in' : 'Need an account? Register'}
          </button>
        </form>
      </div>

      <p className="app-note" style={{ marginTop: 12 }}>
        Signing in identifies you. Standing comes later from anchors and completed work — not from this login.
      </p>
    </div>
  );
}
