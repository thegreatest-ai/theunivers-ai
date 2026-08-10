/**
 * Shell — auth gate + top bar. Loads /api/me for agent status.
 */
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { api, clearAuth, hasSession, getAgentToken } from './api';
import { LOCALES } from './locale';
import './app.css';

export default function Shell({ bare = false }) {
  const nav = useNavigate();
  const loc = useLocation();
  // Persisted. It was component state, so every reload reset a Hindi reader to English (IN) —
  // and moving the control into Account would have been pointless while the choice did not last.
  const [locale, setLocale] = useState(() => {
    const saved = localStorage.getItem('tu_locale');
    return saved && LOCALES[saved] ? saved : 'en-IN';
  });
  useEffect(() => { localStorage.setItem('tu_locale', locale); }, [locale]);
  const [me, setMe] = useState(null);
  const currency = LOCALES[locale].currency;

  useEffect(() => {
    if (bare) return;
    if (!hasSession()) {
      nav('/app/signin');
      return;
    }
    api.me()
      .then((data) => {
        setMe(data);
        if (!data.agent && loc.pathname === '/app') nav('/app/deploy');
      })
      .catch(() => {
        clearAuth();
        nav('/app/signin');
      });
  }, [bare, nav, loc.pathname]);

  if (bare) {
    return (
      <div className="app-root">
        <Outlet context={{ locale, currency, setLocale, me, setMe }} />
      </div>
    );
  }

  return (
    <div className="app-root">
      <header className="app-bar">
        <Link to="/" className="app-brand">theunivers<span className="grad">.ai</span></Link>
        <span className="spacer" />
        <select
          className="app-locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          aria-label="Language and currency"
        >
          {Object.entries(LOCALES).map(([k, v]) => (
            <option key={k} value={k}>{v.label} · {v.currency}</option>
          ))}
        </select>
        {me?.agent && (
          <span className="app-status">
            <span className="app-dot" /> {me.agent.name} · {me.agent.status}
          </span>
        )}
        <Link to="/app/account" className="app-link">Account</Link>
        <button
          className="app-link"
          onClick={() => { clearAuth(); nav('/app/signin'); }}
        >
          Sign out
        </button>
      </header>

      {getAgentToken() && (
        <div className="app-token-bar">
          Agent token saved in this browser — connect your AI with{' '}
          <a href="/agent/skill.md" target="_blank" rel="noreferrer">skill.md</a>
        </div>
      )}

      <Outlet context={{ locale, currency, setLocale, me, setMe }} />
    </div>
  );
}
