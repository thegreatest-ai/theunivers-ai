/**
 * Orders — the spine of a deal.
 *
 * An order is the customised purchase order from the buyer scenario: agreed commodity, price,
 * quantity, delivery window and quality spec, moving through the state machine in
 * `shared/order-states.mjs` with a receipt written at every step.
 *
 * ─── The two rules that make this more than a status column ──────────────────────────────
 *
 * 1. A BINDING transition runs through the actor's own mandate. Sending an offer commits the buyer
 *    to it; accepting commits the seller. Both are checked as `accept` intents, so floor, ceiling,
 *    quantity, commodity, spec, expiry and counterparty tier all apply — and a party whose scope is
 *    only `negotiate` cannot bind themselves at all. That is not a special case: it is the same
 *    SCOPE refusal the proposal flow turns into a question for the principal.
 *
 * 2. EVERY transition writes a receipt to BOTH chains. Not for symmetry — so that neither party
 *    depends on the other's copy to prove their own history.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { randomUUID } from 'node:crypto';
import { one, all, run } from './db.mjs';
import { canTransition, isTerminal } from '../shared/order-states.mjs';
import { checkMandates, resolveTier } from './guard.mjs';
import { appendBoth } from './receipts.mjs';

const now = () => new Date().toISOString();

/** Which side of this order is the given agent on? `null` means: not a party, so not involved. */
export function roleOf(order, agentId) {
  if (order.buyer_agent_id === agentId) return 'buyer';
  if (order.seller_agent_id === agentId) return 'seller';
  return null;
}

export function orderRow(id) {
  return one('SELECT * FROM "order" WHERE id = ?', id);
}

/** Both principals, for writing receipts. Derived from the agents, never taken from a request. */
function principals(order) {
  const b = one('SELECT user_id FROM agent WHERE id = ?', order.buyer_agent_id);
  const s = one('SELECT user_id FROM agent WHERE id = ?', order.seller_agent_id);
  return [b?.user_id, s?.user_id].filter(Boolean);
}

/** The terms, in the shape the mandate guard understands. */
function asIntent(order, kind = 'accept') {
  return {
    kind,
    commodity: order.commodity,
    price: { amount: Number(order.price_amount), currency: order.price_currency },
    quantity: JSON.parse(order.quantity),
    specTemplateId: order.spec_template_id,
    deliveryDate: JSON.parse(order.delivery_window).to,
  };
}

/** Active mandates for one agent. Rows, not ids — `checkMandates` takes rows. */
const mandatesOf = (agentId) =>
  all("SELECT * FROM mandate WHERE agent_id = ? AND status = 'active'", agentId);

export function createOrder({ buyerAgentId, sellerAgentId, commodity, price, quantity,
                              deliveryWindow, specTemplateId, inspectionPolicy }) {
  const id = `ord_${randomUUID().slice(0, 8)}`;
  run(
    `INSERT INTO "order" (
       id, buyer_agent_id, seller_agent_id, commodity, spec_template_id,
       price_amount, price_currency, quantity, delivery_window, inspection_policy,
       status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'drafted', ?, ?)`,
    id, buyerAgentId, sellerAgentId, commodity, specTemplateId ?? 'default',
    Number(price.amount), String(price.currency),
    JSON.stringify(quantity), JSON.stringify(deliveryWindow),
    JSON.stringify(inspectionPolicy ?? { required: true, ends: ['arrival'], minAssurance: 'web-attested' }),
    now(), now(),
  );
  return orderRow(id);
}

/**
 * Attempt a transition.
 *
 * `actorAgentId` is resolved to a role from the order itself — never read from the caller — so an
 * agent cannot claim to be the other side.
 *
 * Returns `{ ok:true, order }` or `{ ok:false, reason, code }`. `code` is stable: the caller uses
 * it to tell a scope escalation (which the principal may answer) from a substantive refusal
 * (which nobody may).
 */
export function transition(orderId, actorAgentId, to, { system = false, arbiter = false } = {}) {
  const order = orderRow(orderId);
  if (!order) return { ok: false, reason: 'no such order', code: 'NOT_FOUND' };
  if (isTerminal(order.status)) {
    return { ok: false, reason: `order is ${order.status}`, code: 'TERMINAL' };
  }

  const role = system ? 'system' : arbiter ? 'arbiter' : roleOf(order, actorAgentId);
  if (!role) return { ok: false, reason: 'not a party to this order', code: 'NOT_A_PARTY' };

  const allowed = canTransition(order.status, to, role);
  if (!allowed.ok) return allowed;

  // A binding move is the actor committing themselves, so it goes through THEIR mandate.
  if (allowed.transition.binds) {
    const other = role === 'buyer' ? order.seller_agent_id : order.buyer_agent_id;
    const counterparty = one('SELECT user_id FROM agent WHERE id = ?', other);
    const check = checkMandates(
      mandatesOf(actorAgentId), asIntent(order),
      { counterpartyTier: resolveTier(counterparty?.user_id) },
    );
    if (!check.ok) {
      return { ok: false, reason: check.reason, code: check.code, mandate: true };
    }
  }

  run('UPDATE "order" SET status = ?, updated_at = ? WHERE id = ? AND status = ?',
      to, now(), orderId, order.status);

  const receipts = appendBoth(principals(order), allowed.transition.receipt, {
    order: orderId,
    from: order.status,
    to,
    by: role,
    agent: system || arbiter ? null : actorAgentId,
    terms: {
      commodity: order.commodity,
      price: { amount: Number(order.price_amount), currency: order.price_currency },
      quantity: JSON.parse(order.quantity),
      spec: order.spec_template_id,
    },
    at: now(),
  });

  return { ok: true, order: orderRow(orderId), receipts };
}

export function ordersFor(agentId, limit = 50) {
  return all(
    `SELECT * FROM "order" WHERE buyer_agent_id = ? OR seller_agent_id = ?
     ORDER BY created_at DESC LIMIT ?`, agentId, agentId, limit);
}

/** Shape sent to a client. Parses the JSON columns so the UI never has to. */
export function publicOrder(o, viewerAgentId) {
  if (!o) return null;
  return {
    id: o.id,
    role: viewerAgentId ? roleOf(o, viewerAgentId) : null,
    commodity: o.commodity,
    specTemplateId: o.spec_template_id,
    price: { amount: Number(o.price_amount), currency: o.price_currency },
    quantity: JSON.parse(o.quantity),
    deliveryWindow: JSON.parse(o.delivery_window),
    inspectionPolicy: JSON.parse(o.inspection_policy),
    status: o.status,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}
