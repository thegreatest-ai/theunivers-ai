/** Shell - top bar and outlet for every /app route. No mega-nav, by decision. */
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { agent } from './mock';
import './app.css';

export default function Shell({ bare = false }) {
  const nav = useNavigate();
  if (bare) return <div className="app-root"><Outlet /></div>;
  return (
    <div className="app-root">
      <header className="app-bar">
        <Link to="/" className="app-brand">theunivers<span className="grad">.ai</span></Link>
        <span className="spacer" />
        <span className="app-status"><span className="app-dot" /> {agent.name} · {agent.status}</span>
        <button className="app-link" onClick={() => nav('/app/signin')}>Sign out</button>
      </header>
      <Outlet />
    </div>
  );
}
