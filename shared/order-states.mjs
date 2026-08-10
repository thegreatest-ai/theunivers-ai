/**
 * The order state machine — as data, not as code scattered through route handlers.
 *
 * ─── Why a table rather than if-statements ───────────────────────────────────────────────
 *
 * Every legal move is one row here, so "what can happen next, and who may cause it" is answerable
 * by reading a table instead of tracing branches. It is also the only way to make the machine
 * testable without a database, a session, or a running server — the tests below it exercise the
 * rules directly.
 *
 * Shared with the browser for the same reason `password-policy.mjs` is: the UI needs to know which
 * buttons to show, and a second copy of that knowledge would drift from the server's.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

export const STATES = [
  'drafted',           // the buyer's agent has prepared a PO, not yet sent
  'offered',           // sent to the seller
  'accepted',          // seller agreed to the terms
  'awaiting_funding',  // waiting for a funding confirmation from OUTSIDE the platform
  'funded',            // funding confirmed — by a provider or bank, never by us
  'shipped',
  'delivered',
  'inspected',         // an inspection was submitted and accepted
  'settled',           // release conditions met; the money moved elsewhere and we recorded it
  'withdrawn',
  'disputed',
  'resolved',
];

export const TERMINAL = ['settled', 'withdrawn', 'resolved'];

/**
 * `actor`  who may cause this transition
 *            buyer | seller | either | system | arbiter
 *          `system` means it follows from a fact the platform observed rather than a party
 *          choosing — a funding confirmation arriving, an inspection being accepted.
 *
 * `binds`  whether the actor is COMMITTING themselves by doing this. A binding transition is run
 *          through that party's mandate as an `accept` intent, so scope, floor, ceiling, quantity
 *          and counterparty tier all apply. Non-binding transitions report facts ("it shipped")
 *          and need authority to act, not authority to commit.
 */
export const TRANSITIONS = [
  { from: 'drafted',          to: 'offered',          actor: 'buyer',   binds: true,  receipt: 'order.offered' },
  { from: 'drafted',          to: 'withdrawn',        actor: 'buyer',   binds: false, receipt: 'order.withdrawn' },
  { from: 'offered',          to: 'accepted',         actor: 'seller',  binds: true,  receipt: 'order.accepted' },
  { from: 'offered',          to: 'withdrawn',        actor: 'buyer',   binds: false, receipt: 'order.withdrawn' },
  { from: 'accepted',         to: 'awaiting_funding', actor: 'system',  binds: false, receipt: 'order.awaiting_funding' },
  { from: 'awaiting_funding', to: 'funded',           actor: 'system',  binds: false, receipt: 'payment.confirmed' },
  { from: 'funded',           to: 'shipped',          actor: 'seller',  binds: false, receipt: 'order.shipped' },
  { from: 'shipped',          to: 'delivered',        actor: 'buyer',   binds: false, receipt: 'order.delivered' },
  { from: 'delivered',        to: 'inspected',        actor: 'system',  binds: false, receipt: 'inspection.passed' },
  { from: 'inspected',        to: 'settled',          actor: 'system',  binds: false, receipt: 'payment.released' },
  { from: 'delivered',        to: 'disputed',         actor: 'either',  binds: false, receipt: 'dispute.opened' },
  { from: 'inspected',        to: 'disputed',         actor: 'either',  binds: false, receipt: 'dispute.opened' },
  { from: 'shipped',          to: 'disputed',         actor: 'either',  binds: false, receipt: 'dispute.opened' },
  { from: 'disputed',         to: 'resolved',         actor: 'arbiter', binds: false, receipt: 'dispute.resolved' },
];

/**
 * Note what is NOT here.
 *
 * There is no transition from `funded` or later back to `withdrawn`. Once funding is confirmed,
 * unwinding is a settlement question between the parties and their provider, not a state we can
 * flip — the platform never held the money, so it cannot give it back.
 *
 * There is no path that skips inspection when an inspection was required. A buyer who wants to
 * settle without one sets `inspection_policy` to none up front, on the record, rather than
 * choosing to skip after the goods arrive.
 */

export function transitionsFrom(state) {
  return TRANSITIONS.filter((t) => t.from === state);
}

export function findTransition(from, to) {
  return TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

export const isTerminal = (state) => TERMINAL.includes(state);

/**
 * May `role` move this order from `from` to `to`?
 *
 * Returns `{ ok }` or `{ ok:false, reason, code }`. Codes are stable so the UI can react to the
 * kind of refusal rather than matching on prose.
 */
export function canTransition(from, to, role) {
  if (!STATES.includes(from)) return { ok: false, reason: `unknown state ${from}`, code: 'BAD_STATE' };
  if (!STATES.includes(to)) return { ok: false, reason: `unknown state ${to}`, code: 'BAD_STATE' };
  if (isTerminal(from)) return { ok: false, reason: `${from} is final`, code: 'TERMINAL' };

  const t = findTransition(from, to);
  if (!t) return { ok: false, reason: `cannot go from ${from} to ${to}`, code: 'NO_TRANSITION' };

  if (t.actor === 'either') {
    if (role !== 'buyer' && role !== 'seller') {
      return { ok: false, reason: 'only a party to the order may do this', code: 'WRONG_ACTOR' };
    }
  } else if (t.actor !== role) {
    return { ok: false, reason: `only the ${t.actor} may move ${from} → ${to}`, code: 'WRONG_ACTOR' };
  }

  return { ok: true, transition: t };
}
