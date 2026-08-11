/**
 * The inspection-job state machine — as data, the same shape as `order-states.mjs`.
 *
 * An inspection is a JOB an ordinary agent (the inspector) takes on. No new party machinery: an
 * inspector is an individual with a mandate whose `spec_template_id` says which forms they are
 * competent to complete, and the guard already refuses an intent whose spec does not match. See
 * docs/specs/ORDER-AND-INSPECTION.md.
 *
 * Shared with the browser so the capture screen knows which action is next without a second copy
 * of these rules drifting from the server's.
 *
 *   posted      commissioned against an order + spec, fee offered, not yet claimed
 *   claimed     an inspector took it (subject to their mandate — fee floor, spec, scope, tier)
 *   checked_in  the inspector is on site and captured evidence — the getUserMedia step
 *   submitted   the completed form + evidence handed back
 *   accepted    the commissioner accepted the finding
 *   rejected    the commissioner rejected it
 *   disputed    a rejection the inspector contests → arbiter
 *   expired     nobody claimed it, or a claim lapsed before check-in
 *   fee_due     a RECEIPT, not a transfer — the platform records that a fee is owed, never moves it
 */

export const STATES = [
  'posted',
  'claimed',
  'checked_in',
  'submitted',
  'accepted',
  'rejected',
  'disputed',
  'expired',
  'fee_due',
];

export const TERMINAL = ['fee_due', 'expired'];

/**
 * `actor` — who may cause this transition:
 *   inspector   the agent who claimed the job
 *   commissioner the party who posted it (buyer or seller of the order)
 *   arbiter     the platform authorised person
 *   system      follows from a fact the platform observed (a claim window lapsing, acceptance
 *               becoming a fee owed) rather than a party choosing
 *
 * `binds` — whether the actor COMMITS themselves by doing this, and must therefore pass their own
 *   mandate as an `accept` intent. Claiming a job binds the inspector to a fee floor and a spec
 *   they are competent to judge; nothing else here binds.
 */
export const TRANSITIONS = [
  { from: 'posted',     to: 'claimed',    actor: 'inspector',    binds: true,  receipt: 'inspection.claimed' },
  { from: 'posted',     to: 'expired',    actor: 'system',       binds: false, receipt: 'inspection.expired' },
  { from: 'claimed',    to: 'checked_in', actor: 'inspector',    binds: false, receipt: 'inspection.checked_in' },
  { from: 'claimed',    to: 'expired',    actor: 'system',       binds: false, receipt: 'inspection.expired' },
  { from: 'checked_in', to: 'submitted',  actor: 'inspector',    binds: false, receipt: 'inspection.submitted' },
  { from: 'submitted',  to: 'accepted',   actor: 'commissioner', binds: false, receipt: 'inspection.accepted' },
  { from: 'submitted',  to: 'rejected',   actor: 'commissioner', binds: false, receipt: 'inspection.rejected' },
  { from: 'accepted',   to: 'fee_due',    actor: 'system',       binds: false, receipt: 'inspection.fee_due' },
  { from: 'rejected',   to: 'disputed',   actor: 'inspector',    binds: false, receipt: 'dispute.opened' },
  { from: 'disputed',   to: 'accepted',   actor: 'arbiter',      binds: false, receipt: 'dispute.resolved' },
  { from: 'disputed',   to: 'rejected',   actor: 'arbiter',      binds: false, receipt: 'dispute.resolved' },
];

/**
 * What is NOT here, on purpose.
 *
 * There is no path from `checked_in` back to `posted` or `claimed`. Evidence was captured; a job
 * that could be un-checked-in would let an inspector discard an inconvenient reading and try again
 * for a better one, which is exactly the manufactured result the capture step exists to prevent.
 *
 * There is no `submitted → accepted` by the inspector. The commissioner accepts, never the party
 * being paid — an inspector who could accept their own finding is not an inspection.
 */

export function transitionsFrom(state) {
  return TRANSITIONS.filter((t) => t.from === state);
}

export function findTransition(from, to) {
  return TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

export const isTerminal = (state) => TERMINAL.includes(state);

/**
 * May `role` move this job from `from` to `to`? Returns `{ ok }` or `{ ok:false, reason, code }`
 * with a stable code, the same contract as `canTransition` in `order-states.mjs`.
 */
export function canTransition(from, to, role) {
  if (!STATES.includes(from)) return { ok: false, reason: `unknown state ${from}`, code: 'BAD_STATE' };
  if (!STATES.includes(to)) return { ok: false, reason: `unknown state ${to}`, code: 'BAD_STATE' };
  if (isTerminal(from)) return { ok: false, reason: `${from} is final`, code: 'TERMINAL' };

  const t = findTransition(from, to);
  if (!t) return { ok: false, reason: `cannot go from ${from} to ${to}`, code: 'NO_TRANSITION' };

  if (t.actor !== role) {
    return { ok: false, reason: `only the ${t.actor} may move ${from} → ${to}`, code: 'WRONG_ACTOR' };
  }
  return { ok: true, transition: t };
}
