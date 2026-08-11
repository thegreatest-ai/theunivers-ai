/**
 * /app/account — You.
 *
 * ─── What this screen is, and what it is not ─────────────────────────────────────────────
 *
 * It is the answer to "who am I here, and what can anyone else see about me". Standing, anchors
 * and the receipt chain are the product's whole claim, and until now they existed only as API
 * responses nobody could look at.
 *
 * It is NOT a settings page. Instagram separates the profile you present from the switches you
 * operate, and the separation is right: one is read, the other is used. Everything changeable
 * lives behind one "Settings and activity" row, in `Settings.jsx`.
 *
 * The tier badge says **(derived)** on purpose. It is computed from anchors and completed deals
 * every time it is read, and there is no write path to it — the word is the difference between a
 * record of conduct and a directory of badges.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from './api';
import Works from './Works';

const TAB = ['Published', 'Agent', 'Anchors', 'Receipts'];

/** What an anchor is, in words rather than a column name. */
const ANCHOR_LABEL = {
  trade_licence: 'Trade licence',
  gstin: 'GSTIN',
  vat_trn: 'VAT registration',
  iec: 'Import-export code',
  udyam: 'Udyam registration',
  onsite_visit: 'On-site visit',
  uae_pass: 'UAE Pass',
  chamber_membership: 'Chamber membership',
  fpo_membership: 'FPO membership',
  farmer_id: 'Farmer ID',
};

export default function You() {
  const { me } = useOutletContext();
  const [p, setP] = useState(null);
  const [tab, setTab] = useState('Published');
  const [chainRows, setChainRows] = useState([]);

  useEffect(() => { api.profile().then(setP).catch(() => {}); }, []);
  useEffect(() => {
    if (tab === 'Receipts' && chainRows.length === 0) {
      api.receipts().then((d) => setChainRows(d.receipts || [])).catch(() => {});
    }
  }, [tab]);

  if (!p) return <p className="app-note you-pad">Loading…</p>;

  const initials = (p.user.name || p.user.email).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="you">
      <header className="you-head">
        <div className="you-avatar" aria-hidden="true">{initials}</div>

        <div className="you-id">
          <h1>{p.user.name || 'Unnamed'}</h1>
          {p.agent && <p className="you-handle">{p.agent.name}</p>}
          <p className="app-meta">
            {p.user.kind === 'business' ? 'Registered business' : 'Individual'}
            {p.user.profession ? ` · ${p.user.profession}` : ''}
            {p.user.jurisdiction ? ` · ${p.user.jurisdiction}` : ''}
          </p>

          <span className="you-tier">
            <b>{p.trust.tier}</b>
            <span>derived, not granted</span>
          </span>
        </div>

        <Link to="/app/settings" className="you-settings">Settings and activity →</Link>
      </header>

      <div className="you-stats">
        {[['Anchors', p.counts.anchors], ['Receipts', p.counts.receipts],
          ['Mandates', p.counts.mandates], ['Deals', p.counts.deals]].map(([k, v]) => (
          <div key={k}><b>{v}</b><span>{k}</span></div>
        ))}
      </div>

      {/* Standing is explained, never asserted. A score that cannot be explained cannot be
          appealed, and an unappealable score is a badge. */}
      <div className="app-card you-why">
        <h3>Why {p.trust.tier}</h3>
        <ul>
          {p.trust.explanation.map((e, i) => {
            const [key, ...rest] = e.split('|');
            const text = {
              'trust.explain.no_anchors': 'No verified anchors yet — nothing has been checked.',
              'trust.explain.anchors': `${rest[0]} verified anchor(s): ${rest[1] ?? ''}`,
              'trust.explain.completed': `${rest[0]} completed deal(s).`,
              'trust.explain.disputes': `${rest[0]} dispute(s) on record.`,
              'trust.explain.next_t2': 'One strong anchor, two medium ones, or a vouch reaches T2.',
              'trust.explain.next_t3': 'Five clean deals and one passed inspection reaches T3.',
            }[key] ?? e;
            return <li key={i}>{text}</li>;
          })}
        </ul>
      </div>

      <nav className="you-tabs" aria-label="Profile sections">
        {TAB.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      {tab === 'Published' && <Works userId={p.user.id} own />}

      {tab === 'Agent' && (
        <div className="app-card">
          {p.agent ? (
            <>
              <h3 style={{ margin: '0 0 4px' }}>{p.agent.name}</h3>
              <p className="app-meta">{p.agent.id} · {p.agent.status}</p>
              <p style={{ color: 'var(--muted)', fontSize: '.9rem', margin: '10px 0 14px' }}>
                {p.agent.purpose}
              </p>
              {p.mandate ? (
                <dl className="app-kv">
                  <div><dt>May trade</dt><dd>{p.mandate.commodity}</dd></div>
                  <div><dt>Never below</dt>
                       <dd>{p.mandate.priceFloor?.amount} {p.mandate.priceFloor?.currency}</dd></div>
                  <div><dt>May go as far as</dt><dd>{p.mandate.scope}</dd></div>
                  <div><dt>Deals with</dt><dd>{p.mandate.counterpartyMinTier} and above</dd></div>
                </dl>
              ) : (
                <p className="app-note">
                  No mandate, so it cannot act at all. <Link to="/app/mandate">Set what it may do</Link>.
                </p>
              )}
              <Link className="app-link" to="/app/mandate" style={{ marginTop: 12, display: 'inline-block' }}>
                Change what it may do
              </Link>
            </>
          ) : (
            <p className="app-note">
              No agent yet. <Link to="/app/deploy">Deploy one</Link>.
            </p>
          )}
        </div>
      )}

      {tab === 'Anchors' && (
        <div className="app-card">
          <p className="app-note" style={{ marginTop: 0 }}>
            Evidence of who you are. Standing is derived from these — never bought, never granted.
            An anchor stays <b>pending</b> until somebody checks it.
          </p>
          {p.anchors.length === 0 && <p className="app-note">Nothing recorded yet.</p>}
          {p.anchors.map((a) => (
            <div key={a.id} className="app-anchor">
              <span>{ANCHOR_LABEL[a.type] ?? a.type}{a.issuer ? ` · ${a.issuer}` : ''}</span>
              <span className={a.status === 'verified' ? 'app-ok' : 'app-pending'}>{a.status}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'Receipts' && (
        <div className="app-card">
          <p className="app-note" style={{ marginTop: 0 }}>
            Your own append-only chain. Each entry is hashed with the one before it, so altering
            anything invalidates everything after.
          </p>
          <p className={p.chain.ok ? 'app-ok' : 'app-error'} style={{ fontSize: '.85rem' }}>
            {p.chain.ok
              ? `✓ ${p.chain.length} entries, chain verifies`
              : `Chain broken at entry ${p.chain.at}`}
          </p>
          {chainRows.length === 0 && <p className="app-note">Nothing recorded yet.</p>}
          <ol className="deal-chain">
            {chainRows.map((r) => (
              <li key={r.id}>
                <span className="deal-seq">{r.seq}</span>
                <span className="deal-rtype">{r.type}</span>
                <span className="app-meta">{new Date(r.created_at).toLocaleDateString()}</span>
                <code className="deal-hash" title={r.hash}>{r.hash.slice(0, 12)}…</code>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
