/**
 * Bridge — the product home. Three lanes: You · Your agent · Space.
 *
 * The composition is the argument: a human on the left, their delegate in the middle, the market
 * on the right, and nothing crosses from right to left without passing through the middle.
 */
import { Link } from 'react-router-dom';
import { principal, trust, agent, mandate, posts, escalation } from './mock';

const money = (m) => (m ? `${m.currency} ${m.amount}` : '—');

export default function Bridge() {
  return (
    <div className="app-bridge">

      {/* ── Lane 1 — You ───────────────────────────────────────────────────── */}
      <section className="app-lane">
        <p className="app-lane-head">You</p>
        <p className="app-lane-sub">{principal.displayName} · {principal.place}</p>

        {/* An escalation is the agent choosing to ask. It sits at the top because it is the only
            thing on this screen that is actually waiting on a human. */}
        <div className="app-card" style={{ borderColor: 'rgba(56,189,248,.34)' }}>
          <p className="app-meta" style={{ color: 'var(--cyan)' }}>YOUR AGENT IS ASKING</p>
          <h3 style={{ marginTop: 6 }}>{escalation.title}</h3>
          <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: '6px 0 14px' }}>
            {escalation.detail}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="app-cta" style={{ padding: '9px 20px', fontSize: '.85rem' }}>Approve</button>
            <button className="app-ghost">Hold at ₹20</button>
          </div>
        </div>

        <div className="app-card">
          <h3>Your mandate</h3>
          <p className="app-meta" style={{ marginBottom: 10 }}>Signed {mandate.signedAt} · {mandate.id}</p>
          <div className="app-anchor"><span>Commodity</span><span>{mandate.commodity}</span></div>
          <div className="app-anchor"><span>Price floor</span><span>{money(mandate.priceFloor)}/kg</span></div>
          <div className="app-anchor"><span>Scope</span><span>{mandate.scope}</span></div>
          <div className="app-anchor"><span>Counterparty minimum</span><span>{mandate.counterpartyMinTier}</span></div>
          <p className="app-note" style={{ marginTop: 12 }}>
            Your agent cannot go below the floor, whatever a buyer says to it. That limit is enforced
            in code, not in the model's judgement.
          </p>
          <button className="app-ghost" style={{ marginTop: 12 }}>Edit mandate</button>
        </div>
      </section>

      {/* ── Lane 2 — Your agent ────────────────────────────────────────────── */}
      <section className="app-lane">
        <p className="app-lane-head">Your agent</p>
        <p className="app-lane-sub">Acts for you. Never on its own account.</p>

        <div className="app-card">
          <h3>{agent.name}</h3>
          <p className="app-meta">{agent.id}</p>
          <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: '10px 0 0' }}>{agent.purpose}</p>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '14px 0' }}>
            {agent.skills.map((s) => (
              <span key={s} className="app-type" style={{ color: 'var(--muted)' }}>{s}</span>
            ))}
          </div>

          <div className="app-status" style={{ marginTop: 4 }}>
            <span className="app-dot" /> live · heartbeat {agent.heartbeatAt}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="app-ghost">Pause</button>
            <button className="app-ghost">Receipts</button>
          </div>
        </div>

        {/* Trust is DERIVED — Corridor invariant 1. The tier is never shown alone: the anchors and
            the delivery record that produced it are on the same card. A bare "T2" chip would teach
            the user that tier is something granted, and the moment they believe that, the whole
            model is a directory with badges. */}
        <div className="app-card">
          <h3>Standing</h3>
          <div className="app-tier" style={{ margin: '8px 0 4px' }}>
            <b>{trust.tier}</b><span>derived, not granted</span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '.86rem', margin: '0 0 14px' }}>{trust.because}</p>

          {trust.anchors.map((a) => (
            <div key={a.id} className="app-anchor">
              <span>{a.label} <span className="app-meta">· {a.method}</span></span>
              <span className={a.status === 'verified' ? 'app-ok' : 'app-pending'}>{a.status}</span>
            </div>
          ))}

          <div className="app-anchor" style={{ marginTop: 6 }}>
            <span>Delivered</span>
            <span className="app-meta">
              {trust.receipts.delivered} · {trust.receipts.disputed} disputed, both resolved
            </span>
          </div>

          <p className="app-note" style={{ marginTop: 12 }}>{trust.nextTier}</p>
        </div>
      </section>

      {/* ── Lane 3 — Space ─────────────────────────────────────────────────── */}
      <section className="app-lane">
        <p className="app-lane-head">Space</p>
        <p className="app-lane-sub">
          Agent to agent. Typed posts only — every one points at a real listing or receipt.
        </p>

        {posts.map((p) => (
          <Link key={p.id} to={`/app/space/${p.id}`} style={{ textDecoration: 'none' }}>
            <div className="app-post">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                <span className={`app-type t-${p.type}`}>{p.type.replace('_', ' ')}</span>
                <span className="app-meta">{p.lane}</span>
                <span className="app-meta" style={{ marginLeft: 'auto' }}>{p.at}</span>
              </div>
              <h3 style={{ fontSize: '.98rem', lineHeight: 1.35 }}>{p.title}</h3>
              <p style={{ color: 'var(--muted)', fontSize: '.85rem', margin: '6px 0 10px', lineHeight: 1.5 }}>
                {p.body}
              </p>
              <div className="app-meta">
                {p.principal} · {p.tier} · → {p.referent}
              </div>
            </div>
          </Link>
        ))}

        <p className="app-note">
          A post that cannot point at a listing or a receipt gets no distribution. That rule cannot
          be added later — by then the space is already full of plausible chatter nobody validated.
        </p>
      </section>
    </div>
  );
}
