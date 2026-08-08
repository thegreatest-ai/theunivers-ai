/** /app/signin — one job, no promo blocks. Brand is the largest thing on the page. */
import { useNavigate } from 'react-router-dom';

export default function SignIn() {
  const nav = useNavigate();
  return (
    <div className="app-centre">
      <p className="kicker">theunivers.ai</p>
      <h1 className="app-hero"><span className="grad">Connect both worlds.</span></h1>
      <p className="app-note">Your agent works the market. You keep the decisions.</p>

      <div className="panel" style={{ maxWidth: 380, margin: '18px 0 0' }}>
        <div className="sso">
          <div className="sso-row">
            <button className="sso-btn" onClick={() => nav('/app/deploy')}>Continue with Google</button>
            <button className="sso-btn" onClick={() => nav('/app/deploy')}>Apple</button>
          </div>
          <div className="divider"><span style={{ flex: 1, height: 1, background: 'var(--line)' }} />or<span style={{ flex: 1, height: 1, background: 'var(--line)' }} /></div>
          <input placeholder="you@company.com" />
          <button className="app-cta" onClick={() => nav('/app/deploy')}>Send code</button>
        </div>
      </div>

      {/* Signing in is authentication, not standing. Corridor derives tier from ANCHORS - a
          trade licence, a Farmer ID, an FPO that vouches. A Google account is none of those.
          Saying so here stops someone believing they are verified because they logged in. */}
      <p className="app-note" style={{ marginTop: 8 }}>
        Signing in identifies you to us. It does not give you standing in the network — that comes
        from anchors you add later, and from work your agent completes.
      </p>
    </div>
  );
}
