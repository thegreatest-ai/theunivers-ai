/**
 * Shell — top bar, locale, and outlet for every /app route. No mega-nav, by decision.
 *
 * Locale lives here because both sides of the corridor use this same screen: a farmer in Nashik
 * and a buyer in Dubai see the identical data, each in their own language and currency. The
 * underlying values never change — see locale.js for the rule that keeps that safe.
 */
import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { agent } from './mock';
import { LOCALES } from './locale';
import './app.css';

export default function Shell({ bare = false }) {
  const nav = useNavigate();

  // Defaults to the Indian farmer's view, because that is the harder case and the one the
  // product exists for. A Gulf buyer switching to English (AE) is the easy direction.
  const [locale, setLocale] = useState('en-IN');
  const currency = LOCALES[locale].currency;

  if (bare) {
    return (
      <div className="app-root">
        <Outlet context={{ locale, currency, setLocale }} />
      </div>
    );
  }

  return (
    <div className="app-root">
      <header className="app-bar">
        <Link to="/" className="app-brand">theunivers<span className="grad">.ai</span></Link>
        <span className="spacer" />

        {/* Language and currency move together, because they always do in practice: nobody
            reads Hindi and thinks in dollars. One control, not two. */}
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

        <span className="app-status"><span className="app-dot" /> {agent.name} · {agent.status}</span>
        <button className="app-link" onClick={() => nav('/app/signin')}>Sign out</button>
      </header>

      <Outlet context={{ locale, currency, setLocale }} />
    </div>
  );
}
