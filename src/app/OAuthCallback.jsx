/** Completes OAuth redirect — stores session and continues into the app. */
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setSession } from './api';

export default function OAuthCallback() {
  const [params] = useSearchParams();
  const nav = useNavigate();

  useEffect(() => {
    const session = params.get('session');
    const next = params.get('next') || '/app/deploy';
    if (!session) {
      nav('/app/signin?error=' + encodeURIComponent('OAuth session missing'));
      return;
    }
    setSession(session);
    nav(next.startsWith('/app') ? next : '/app');
  }, [params, nav]);

  return (
    <div className="app-centre">
      <p className="kicker">theunivers.ai</p>
      <p className="app-note">Signing you in…</p>
    </div>
  );
}
