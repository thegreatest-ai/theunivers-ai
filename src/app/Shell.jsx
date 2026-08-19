/**
 * Shell — auth gate + top bar. Loads /api/me for agent status.
 */
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { api, clearAuth, hasSession, getAgentToken } from './api';
import { subscribe } from './stream';
import { LOCALES } from './locale';
import Nav from './Nav';
import CreateMenu from './CreateMenu';
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

  // Only a decision waiting on you earns a badge. A count of things that merely happened is a
  // notification habit; this is a tool.
  const [pending, setPending] = useState(0);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (bare) return;
    const read = () => api.proposals()
      .then((d) => setPending((d.proposals || []).filter((p) => p.status === 'pending').length))
      .catch(() => {});
    read();
    return subscribe((kind) => { if (kind === 'proposal' || kind === 'order') read(); });
  }, [bare]);
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
    /*
     * `has-nav` is what keeps the page clear of a navigation that is position:fixed — 232px of
     * left padding beside the desktop rail, and the height of the bottom bar plus the safe area
     * beneath it on a phone.
     *
     * The class existed in app.css and nothing wore it. So the rail was painted and then covered
     * by every opaque screen that followed it in the DOM, and the bottom bar sat on top of the
     * last 78px of every page. The navigation was drawn, unreachable, and looked implemented.
     */
    <div className="app-root has-nav">
      {/* Five destinations, two shapes. Both from shared/navigation.mjs — the file existed with
          the decision in it and nothing imported it, which made an ADR look implemented when it
          was not. */}
      <Nav
        counts={{ Deals: pending }}
        onCreate={() => {
          if (!me?.agent) { nav('/app/deploy'); return; }
          setCreating(true);
        }}
      />

      <header className="app-bar">
        <Link to="/" className="app-brand app-brand-mobile">theunivers<span className="grad">.ai</span></Link>
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
      {creating && (
        <CreateMenu
          onClose={() => setCreating(false)}
          onShared={() => { setCreating(false); nav('/app/account'); }}
        />
      )}
    </div>
  );
}
