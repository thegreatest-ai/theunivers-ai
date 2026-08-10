/**
 * /app/deals — the orders you are party to, and what may happen next.
 *
 * ─── What this screen is for ─────────────────────────────────────────────────────────────
 *
 * The order machine, the guard and the receipt chain have all existed and been unreachable. This
 * is the window onto them, and the design follows from one idea:
 *
 *   SHOW WHAT MAY HAPPEN NEXT, AND WHO MAY CAUSE IT.
 *
 * A status label alone ("shipped") tells you where a deal is but not what it is waiting for, which
 * is the only thing anybody actually opens a deal to find out. `shared/order-states.mjs` already
 * knows both, so the buttons are derived from the machine rather than hand-written per status —
 * add a transition there and it appears here, correctly gated, with no second edit.
 *
 * A refusal is shown in full rather than reduced to "failed". When the guard says a price is below
 * a floor, that IS the product working, and hiding the reason would make the one feature worth
 * paying for look like a bug.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from 'react';
import { useOutletContext, useParams, useNavigate, Link } from 'react-router-dom';
import { api } from './api';
import { transitionsFrom, isTerminal } from '../../shared/order-states.mjs';
import { fmtDual } from './locale';

/* Colour carries meaning, so it is assigned by what a state MEANS rather than by position in the
   machine: waiting on someone, moving, finished, or wrong. */
const TONE = {
  drafted: 'idle', offered: 'wait', accepted: 'go', awaiting_funding: 'wait',
  funded: 'go', shipped: 'go', delivered: 'go', inspected: 'go',
  settled: 'done', withdrawn: 'idle', disputed: 'bad', resolved: 'done',
};

const LABEL = {
  drafted: 'Draft', offered: 'Sent', accepted: 'Accepted', awaiting_funding: 'Awaiting funding',
  funded: 'Funded', shipped: 'Shipped', delivered: 'Delivered', inspected: 'Inspected',
  settled: 'Settled', withdrawn: 'Withdrawn', disputed: 'Disputed', resolved: 'Resolved',
};

/** Plain English for a machine state — what is actually being waited on. */
const WAITING = {
  drafted: 'Not sent yet. Sending it commits you to these terms.',
  offered: 'With the seller. They accept or it lapses.',
  accepted: 'Agreed. Waiting on funding to be confirmed by the provider.',
  awaiting_funding: 'Waiting on a funding confirmation from outside the platform.',
  funded: 'Funded. The seller ships next.',
  shipped: 'On its way. Confirm when it arrives.',
  delivered: 'Arrived. Inspection decides whether it matches the spec.',
  inspected: 'Inspection passed. Release conditions met.',
  settled: 'Finished.',
  withdrawn: 'Withdrawn before it was accepted.',
  disputed: 'Raised as a dispute. A person will look at it.',
  resolved: 'Dispute closed.',
};

function Money({ m, currency }) {
  if (!m) return <span>—</span>;
  const { signed, approx } = fmtDual(m, currency);
  return (
    <span>
      {signed}
      {/* The signed figure always leads; a converted one is marked and never stands alone. */}
      {approx && <span className="app-meta" style={{ marginLeft: 6 }}>{approx}</span>}
    </span>
  );
}

export function DealList() {
  const { currency } = useOutletContext();
  const [orders, setOrders] = useState(null);

  useEffect(() => { api.orders().then((d) => setOrders(d.orders || [])).catch(() => setOrders([])); }, []);

  if (orders === null) return <p className="app-note deal-pad">Loading…</p>;

  if (orders.length === 0) {
    return (
      <div className="deal-empty">
        <h2>No deals yet</h2>
        <p className="app-note">
          A deal starts when your agent drafts a purchase order and sends it to another agent.
          Everything that happens to it is recorded on both sides — you will not have to ask
          anyone what was agreed.
        </p>
        <p className="app-note">
          Your agent needs a mandate before it can commit to anything.{' '}
          <Link to="/app/mandate">Set what it may do</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="deal-list">
      {orders.map((o) => (
        <Link key={o.id} to={`/app/deals/${o.id}`} className="deal-row">
          <span className={`deal-chip ${TONE[o.status] ?? 'idle'}`}>{LABEL[o.status] ?? o.status}</span>
          <span className="deal-main">
            <b>{o.commodity}</b>
            <span className="app-meta">
              {o.quantity?.value} {o.quantity?.unit} · you are the {o.role}
            </span>
          </span>
          <span className="deal-price"><Money m={o.price} currency={currency} /></span>
        </Link>
      ))}
    </div>
  );
}

export function DealDetail() {
  const { id } = useParams();
  const { currency, me } = useOutletContext();
  const nav = useNavigate();
  const [order, setOrder] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => Promise.all([
    api.order(id).then((d) => setOrder(d.order)),
    api.receipts().then((d) => setReceipts((d.receipts || []).filter((r) => r.payload?.order === id))),
  ]).catch((e) => setError(e.message));

  useEffect(() => { load(); }, [id]);

  if (error && !order) return <p className="app-error deal-pad">{error}</p>;
  if (!order) return <p className="app-note deal-pad">Loading…</p>;

  /*
   * The buttons come from the state machine, filtered to what THIS viewer may do. `system` and
   * `arbiter` transitions are excluded deliberately: those follow from a fact the platform
   * observed, and offering a person a button for them would misrepresent who decided.
   */
  const moves = transitionsFrom(order.status).filter(
    (t) => t.actor === order.role || t.actor === 'either',
  );

  async function move(to) {
    setBusy(to); setError('');
    try {
      await api.moveOrder(id, to);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="deal-detail">
      <button className="app-link" onClick={() => nav('/app/deals')}>← All deals</button>

      <div className="app-card">
        <div className="deal-head">
          <div>
            <h2 style={{ margin: 0 }}>{order.commodity}</h2>
            <p className="app-meta" style={{ margin: '4px 0 0' }}>{order.id} · you are the {order.role}</p>
          </div>
          <span className={`deal-chip ${TONE[order.status] ?? 'idle'}`}>
            {LABEL[order.status] ?? order.status}
          </span>
        </div>

        <p className="app-note" style={{ margin: '12px 0 0' }}>{WAITING[order.status]}</p>

        <dl className="app-kv" style={{ marginTop: 16 }}>
          <div><dt>Price</dt><dd><Money m={order.price} currency={currency} /></dd></div>
          <div><dt>Quantity</dt><dd>{order.quantity?.value} {order.quantity?.unit}</dd></div>
          <div><dt>Spec</dt><dd>{order.specTemplateId}</dd></div>
          <div><dt>Delivery</dt><dd>{order.deliveryWindow?.from} → {order.deliveryWindow?.to}</dd></div>
          <div><dt>Inspection</dt><dd>
            {order.inspectionPolicy?.required
              ? `${order.inspectionPolicy.ends?.join(' and ')} · ${order.inspectionPolicy.minAssurance}`
              : 'not required'}
          </dd></div>
        </dl>
      </div>

      {/* A refusal is shown in full. When the guard says a price is below a floor, that is the
          product working — reducing it to "failed" would make the one feature worth paying for
          look like a malfunction. */}
      {error && (
        <div className="app-card deal-refusal">
          <h3 style={{ margin: '0 0 6px' }}>Refused</h3>
          <p style={{ margin: 0, fontSize: '.9rem', lineHeight: 1.5 }}>{error}</p>
          <p className="app-note" style={{ margin: '10px 0 0' }}>
            Your mandate decided this, not the other party. <Link to="/app/mandate">Review it</Link>{' '}
            if the terms have changed.
          </p>
        </div>
      )}

      {moves.length > 0 && !isTerminal(order.status) && (
        <div className="app-card">
          <h3 style={{ margin: '0 0 4px' }}>What you can do</h3>
          <p className="app-note" style={{ margin: '0 0 12px' }}>
            {moves.some((m) => m.binds)
              ? 'A move marked “commits you” is checked against your mandate before it is allowed.'
              : 'These report what happened. They do not commit you to anything new.'}
          </p>
          <div className="deal-actions">
            {moves.map((m) => (
              <button
                key={m.to}
                className={m.binds ? 'app-cta' : 'app-ghost'}
                disabled={Boolean(busy)}
                onClick={() => move(m.to)}
              >
                {busy === m.to ? 'Working…' : LABEL[m.to] ?? m.to}
                {m.binds && <span className="deal-binds"> · commits you</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="app-card">
        <h3 style={{ margin: '0 0 4px' }}>What was recorded</h3>
        <p className="app-note" style={{ margin: '0 0 12px' }}>
          Your own chain. The other side holds their own copy, so neither of you depends on the
          other to prove what happened.
        </p>
        {receipts.length === 0 && <p className="app-note">Nothing yet.</p>}
        <ol className="deal-chain">
          {[...receipts].reverse().map((r) => (
            <li key={r.id}>
              <span className="deal-seq">{r.seq}</span>
              <span className="deal-rtype">{r.type}</span>
              <span className="app-meta">{new Date(r.created_at).toLocaleString()}</span>
              <code className="deal-hash" title={r.hash}>{r.hash.slice(0, 12)}…</code>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
