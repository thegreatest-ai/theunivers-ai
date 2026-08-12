/**
 * The moderation ladder: what an operator may do, what it writes to the chain, and what a person
 * reads when it happened to them.
 *
 * Shared because the Receipts tab renders the receipt type directly. A sentence written in the
 * client and a type written in the server are two descriptions of one act, and they drift — the
 * same reason `shared/ranking.mjs` generates both the ordering and its explanation.
 *
 * ─── Naming ──────────────────────────────────────────────────────────────────────────────
 *
 * Every receipt type in this system is `domain.pastParticiple`: `order.offered`, `order.withdrawn`,
 * `payment.released`, `dispute.opened`, `inspection.passed`. The first moderation receipt shipped
 * as `moderation.takedown` — a noun, and the only type that broke the pattern. Renamed here before
 * a chain carries enough of them to make it permanent. `takedown` stays the word for the ACT in
 * the API and the spec; `moderation.removed` is what the record calls it, in the grammar the
 * record already uses.
 *
 * ─── The rungs ───────────────────────────────────────────────────────────────────────────
 *
 * `limit` is defined here but NOT implemented, deliberately. "Demote ranking" cannot ship in this
 * product: every ranking term appears in `why`, so a silent demotion is the unexplainable score
 * that both docs/specs/KNOWLEDGE-AND-CITATION.md §5 and invariant 07 forbid. Whatever `limit`
 * becomes, it has to be a visible, stated cap — and that is an owner decision, not a route.
 */

export const MODERATION_ACTIONS = {
  dismiss: {
    rung: null,
    receipt: null, // Nothing happened to the content, so nothing is recorded against its author.
    sentence: 'A report about this was reviewed and no action was taken',
  },
  limit: {
    rung: 1,
    receipt: 'moderation.limited',
    sentence: 'Distribution of this was capped by the operator',
    implemented: false,
  },
  takedown: {
    rung: 2,
    receipt: 'moderation.removed',
    sentence: 'This was removed by the operator',
    implemented: true,
  },
  suspend: {
    rung: 3,
    receipt: 'moderation.suspended',
    sentence: 'This account was suspended by the operator',
    implemented: false,
  },
};

/** The actions a route may accept today. A rung with no implementation must not be callable. */
export const AVAILABLE_ACTIONS = Object.entries(MODERATION_ACTIONS)
  .filter(([name, a]) => name === 'dismiss' || a.implemented)
  .map(([name]) => name);

/**
 * What to show a person for a receipt on their own chain. Returns null for a type this module does
 * not own, so a caller can fall through to its own rendering rather than print a wrong sentence.
 */
export function moderationSentence(receiptType) {
  const found = Object.values(MODERATION_ACTIONS).find((a) => a.receipt === receiptType);
  return found ? found.sentence : null;
}
