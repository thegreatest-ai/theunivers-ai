# ADR-0006 — Takedown retains, purge destroys

**Status:** PROPOSED — needs the owner. Do not build the second path until this is accepted.
**Date:** 2026-08-12
**Proposed by:** claude-code, recording a position three seats converged on independently.
**Amends:** `ADR-0003-a-post-is-withdrawn-never-deleted.md`, line 22.

## The problem

ADR-0003 line 22 says a true hard delete "exists only as an **operator takedown**, which removes
the citing rows." The takedown that shipped (`6c43450`) removes nothing: it stamps, empties title
and body, and leaves every citation intact. The code and the ADR disagree, and the ADR is the one
that would destroy a third party's evidence if somebody implemented it as written.

Underneath that is a second conflation. `withdrawn_at` was one nullable timestamp carrying two
acts with **opposite obligations**:

- **An author withdrawing their own work** reasonably expects it gone. Privacy wins; nobody is
  adjudicating your own retraction.
- **An operator removing work** must leave the removal adjudicable. Evidence wins, because a
  receipt asserting something the database can no longer corroborate is escrow theatre applied to
  the audit layer — the failure mode `PLATFORM-BRIEF` names as fatal.

Same timestamp, opposite duties. That half is already fixed in the tree: `taken_down_at`,
`takedown_report_id`, and a tombstone serving `removedBy: 'operator' | 'author'`.

## Proposal

**Two acts, two names, two authorities.**

| | `takedown` | `purge` |
|---|---|---|
| Who | operator, under the standard | operator, under a court order or for CSAM |
| Served row | emptied, exactly as withdrawal empties it | emptied |
| Content | hash kept; body kept **only** if the locker below is built | destroyed, locker included |
| Citations | untouched, resolve to a tombstone | removed with the post |
| Reversal | forward `moderation.restored` append | none — it is gone |
| Built today | yes | **no, and must not be until this is accepted** |

**Retention, if it happens, is a different store — never the served row.** The first draft of this
ADR said "retain the body," and cursor was right to attack that: a removed body left in `post.body`
behind a flag is one `GET /api/posts/:id` mistake away from being served, which is the shape
ADR-0003 already refused. Whatever the answer to question 1, the served row is emptied either way.
Retention would mean an operator-only locker: a separate table, never on a public route, destroyed
on a purge. That is a third store and a real cost, which is exactly why it is the owner's call and
not a detail of the takedown route.

`purge` is the only place ADR-0003 line 22's "removes the citing rows" is correct, and it is
correct there because at that point the law is not interested in a citer's evidence.

## What is already true in the tree

- Takedown never deletes. `citation.post_id` is `ON DELETE RESTRICT`, so an attempt would raise.
- `body_sha256` is hashed **before** the row is emptied, on withdrawal and takedown alike. The
  platform holds the hash and never the bytes: an author who kept their own copy can prove what
  was removed. That is the fallback that makes today's emptying defensible; retention is strictly
  better if the owner accepts the liability.
- One-way. There is no un-takedown. A later `moderation.restored` would be a second forward
  append, never an edit of the first — a record that can be rewritten is not evidence.
- An operator removal stops paying the author (`d4c2f1c`); an author's withdrawal does not.
  Withdrawing your own work does not unmake that somebody built on it.

## What changed after the first draft: `limit` shipped

`fe02419` added the middle rung, and it mostly answers question 1 without a locker. **`limit`
hides the post and retains the body**; **`takedown` empties it and does not reverse.** Anything an
operator might reverse is a limit, so there is no reversible-takedown to fake and no shadow store
needed to support an undo — which was the pressure that would have produced one.

gemini then argued the DSA case: an operator removal must leave the content adjudicable for the
duration of a dispute window, or an appeal cannot be heard and a rogue removal cannot be traced.
That argument does not need a schema change — the non-destructive state already exists. It needs a
**procedure**: an operator limits first, and may only take down once the dispute window has closed.
Which turns question 1 into a policy question with a number in it, below.

## The questions only the owner can answer

1. **Must a takedown be preceded by a limit, and for how long?** If yes, this is a guard on the
   takedown route — refuse unless the post has been limited for N days — plus a severity bypass for
   CSAM and live exploit payloads, which must never sit in the database waiting out a window. Pick
   N, or say the operator judges it case by case and the ladder is advisory. This has replaced the
   locker question below, which the `limit` rung largely dissolved.

1b. **Is an operator-only locker built at all?** Retaining makes an appeal adjudicable and makes
   operator abuse visible. It also means a store somewhere holds content removed for being
   abusive, which is a real liability for a subset of cases — and it is a third store to secure,
   back up and eventually purge. The cheaper answer is already shipped and may be enough: the
   decision is disputed from the receipt, the stated reason, the hash taken before emptying, and
   the author own copy. Nothing about that requires us to keep the bytes.
2. **Is `purge` built at all, and who may call it?** It is the most dangerous route in this
   codebase — the only one that destroys a third party's record. It should not exist until it is
   needed, and it should never share an endpoint with `takedown`.

## What was considered and is not proposed

- **Naming the operator on the public tombstone.** Proposed as
  *"Removed by Operator <name> on <timestamp> citing <standard section>"*. Rejected, on cursor's
  argument: a public card that names a human on **every** removal is a targeting surface, and the
  people most motivated to find that name are the ones just removed. The named operator belongs
  where the person affected already sees it — the appeal path on their own account, "your appeal
  goes directly to the operator of this node" — not on a card shown to the whole audience. The
  standard's clause is recorded on the receipt (`policy`) and can surface on the tombstone once a
  published node policy exists; there is none yet, and enforcement must not block on a document
  nobody has written.

- **A `moderator` flag on `user`.** Deliberately absent; the operator token stays the gate until
  the role model is decided. Baking a role into a schema is the hardest kind of decision to undo.
- **Encrypting a removed body under an escrow key.** Proposed in review. Rejected here: this
  system has no key management of any kind, and encryption at rest against our own operator is
  theatre unless the key lives somewhere the operator cannot reach — which does not exist in a
  single-process deploy on one machine. "Retain and stop serving" is a boolean; this is a
  subsystem.
- **Signed enforcement receipts.** Also proposed. The `receipt` table is
  `(id, seq, user_id, type, payload, prev_hash, hash, created_at)` — a SHA-256 chain with no
  signature column and no key. Signing is possible future work, not a precondition, and the
  interface must not describe a takedown record as independently verifiable until the unbuilt
  Merkle anchoring exists.
