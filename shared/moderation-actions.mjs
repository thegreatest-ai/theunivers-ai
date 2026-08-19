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
 * `limit` is a QUARANTINE, not a quiet demotion. It hides the post and RETAINS the body; takedown
 * empties the body and does not reverse. Those two facts being opposite is what makes the ladder
 * honest — and it is why no shadow backup store is needed to support an undo, which is the thing
 * that would otherwise get built the first time an operator regretted a takedown.
 *
 * It is deliberately not a ranking demotion. Every ranking term appears in `why`, so a silent
 * downrank is the unexplainable score that KNOWLEDGE-AND-CITATION §5 and invariant 07 both forbid.
 * Hidden-and-said-so is appealable; quietly-scored-lower is not.
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
    sentence: 'This was limited by the operator while a report was reviewed',
    implemented: true,
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
  /*
   * Not a rung. Releasing a false-positive filter hit is the reverse of the automatic limit,
   * recorded as a forward append — the same `moderation.restored` ADR-0006 already named for
   * a reversal that keeps the chain intact. It has its own route; it must not become callable
   * as a report action, which is why AVAILABLE_ACTIONS below ignores rung-less entries other
   * than dismiss.
   */
  release: {
    rung: null,
    receipt: 'moderation.restored',
    sentence: 'This was restored by the operator after a filter hid it',
    implemented: true,
  },
  /*
   * Not a rung. Contesting a limit is the author's act, recorded as a forward append — the hide
   * stays in the chain. Its own route; it must not become callable as a report action.
   */
  appeal: {
    rung: null,
    receipt: 'moderation.appealed',
    sentence: 'You asked the operator of this node to review a limit. There is no panel. The original record stays.',
    implemented: true,
  },
};

/**
 * The actions a report-resolution route may accept today. A rung with no implementation must
 * not be callable. `rung: null` is either dismiss (nothing happened) or release (its own path).
 */
export const AVAILABLE_ACTIONS = Object.entries(MODERATION_ACTIONS)
  .filter(([name, a]) => name === 'dismiss' || (a.implemented && a.rung != null))
  .map(([name]) => name);

/**
 * What to show a person for a receipt on their own chain. Returns null for a type this module does
 * not own, so a caller can fall through to its own rendering rather than print a wrong sentence.
 */
export function moderationSentence(receiptType, payload) {
  // A filter hit is the limit rung applied automatically. Calling it an operator review of a
  // report would be a lie on the chain whose claim is that it records what happened.
  if (receiptType === 'moderation.limited' && payload?.source === 'filter') {
    return 'A filter hid this from other people. It is retained in full.';
  }
  const found = Object.values(MODERATION_ACTIONS).find((a) => a.receipt === receiptType);
  return found ? found.sentence : null;
}
