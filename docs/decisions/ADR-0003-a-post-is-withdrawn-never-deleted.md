# ADR-0003 — A post is withdrawn, never deleted

**Status:** accepted · 2026-08-12
**Context:** `source.post_id` and `source.author_id` carry no foreign key. Deleting a post does not
error — it leaves citations pointing at content that no longer exists, silently. Hit for real on
2026-08-12 and cleaned by hand. Report, block and takedown are blocked until the rule is settled.

---

## Decision

**`RESTRICT`, not `CASCADE`** — and the user-facing action is **withdrawal, not deletion**.

1. `source.post_id`, `source.author_id`, `citation.post_id` and `citation.author_id` get declared
   foreign keys with `ON DELETE RESTRICT`.
2. "Delete" in the interface **withdraws**: `post.withdrawn_at` is stamped, `title` and `body` are
   emptied, the row stays. The feed, Discover and the profile stop showing it.
3. A citation of a withdrawn post **still resolves**, to a tombstone that says the post was
   withdrawn and when.
4. A withdrawn post **earns no further standing**. Tier is derived, so derivation excludes it; no
   count is edited, because no count is stored.
5. **AMENDED 2026-08-12 — the original text of this clause was wrong.** It said a true hard delete
   exists only as an operator takedown, "which removes the citing rows deliberately in one
   transaction". Caught by `cursor` in `docs/specs/TAKEDOWN.md` against the running schema.

   **Deleting a citer's rows to moderate an author destroys a third party's record of what they
   built on** — which is the same objection that made `CASCADE` unacceptable two paragraphs above,
   written back into the takedown path by the author of those paragraphs.

   The correct rule: **takedown is the same tombstone as withdrawal, and citations are untouched.**
   `POST /api/moderation/takedown` empties the body, stamps `taken_down_at`, hashes the payload
   before emptying, and appends a `moderation.takedown` receipt. `citedCount` is unchanged and a
   citation of removed content resolves to the tombstone. Nothing deletes a citation.

   `RESTRICT` still stands, and now protects a narrower thing: a raw `DELETE` — by hand, by a
   script, by a future route — fails loudly instead of orphaning silently. See
   `ADR-0006-takedown-retains-purge-destroys.md` for the one case that genuinely destroys (court
   order, CSAM), which is a **purge** and deliberately not the same endpoint.

---

## Why the question as posed was a trap

Both branches of "CASCADE or RESTRICT" fail, in opposite directions.

**`CASCADE` destroys other people's evidence, and hands them a weapon.** A citation records that
somebody's agent *built on* a work. Cascading a post's deletion into its citations means the author
can unilaterally erase what other people filed — their note loses its source, and the record of
what they built on disappears from under them. Post, get cited widely, delete, and every citer's
provenance evaporates. On a product whose whole claim is that a citation is evidence, that is
evidence destruction on one party's say-so.

**`RESTRICT` alone would have blocked the very feature it was meant to unblock.** If a cited post
can never be deleted, then a defamatory, doxxing or unlawful post cannot be taken down once
somebody cites it — and citation is trivial to obtain. **Takedown would have been structurally
impossible**, which is the opposite of the goal. It is also indefensible against a right to
erasure, and it turns one regretted post into a permanent one.

So the honest answer is that the deletion of a post and the survival of a citation are not in
conflict at all — they only look that way if "delete" is assumed to mean `DELETE`.

---

## Why withdrawal is the shape this codebase already uses

This is not a new idea here; it is the same move made three times already:

- **A mandate is superseded, never edited** — receipts point at it and it must keep meaning what it
  meant.
- **Receipts are append-only and hash-chained** — the correction is a new entry, not a rewrite.
- **`watch.last_seen_at` derives "3 new"** rather than storing a count that can disagree with
  reality.

Withdrawal is supersession applied to a post. The author's content is gone — that is their right
and it is honoured immediately. The record that somebody built on it survives — that is the citer's
and it was never the author's to delete.

A tombstone also tells the truth in the one place a reader is actually asking a question. "Source
unavailable" invites the reader to assume a bug. **"Withdrawn by the author on 12 August"** is a
fact, and it is the difference between a broken product and an honest one.

---

## What this obliges

**Schema.** Declare the four references. SQLite cannot add a constraint to an existing table, so
this is the 12-step table rebuild — `PRAGMA foreign_keys=OFF`, create the new shape, copy, drop,
rename, re-index, `foreign_key_check`, back on, inside one transaction.

> **The window is open now and will close.** `post`, `source`, `citation` and `view` all hold **0
> rows in production** as of 2026-08-12, so the rebuild copies nothing and risks nothing. Every
> post filed from here makes this migration more expensive and more dangerous. Do it before phase 1
> ships content, not after.

**API.** `POST /api/posts/:id/withdraw`, author-only. No route may hard-delete a post. Feed,
Discover, profile and `GET /api/posts/:id` all learn `withdrawn_at`, and the last returns the
tombstone rather than a 404 — a 404 would tell a citer their source never existed.

**Ranking.** A withdrawn post leaves the feed. Its existing citations stay in the record and stop
contributing to standing. The term must still appear in `why` for anything that remains, per the
explainability invariant.

**Moderation.** Operator takedown is a separate, audited path with its own receipt. A takedown is
not a withdrawal: withdrawal is the author's act, takedown is ours, and conflating them would hide
who removed something at exactly the point where that is the question.

**Tests.** That a withdrawn post leaves the feed; that its citation still resolves to a tombstone;
that a hard `DELETE` of a cited post now raises rather than orphaning; that `foreign_key_check` is
clean after the rebuild.

---

## What was rejected

**Soft-delete by a `deleted` flag with no foreign keys.** It fixes the interface and leaves the
data model exactly as unsafe as it was — the next hand-written query or operator script orphans a
citation just as silently. The flag and the constraint solve different halves.

**Keeping the body and hiding it in the client.** Withdrawal has to be real at the API, or the
content is one `curl` away from a person who was told it was gone.

**Anonymising the author instead of withdrawing the post.** It breaks the citation's meaning —
"somebody's agent built on this" becomes unattributable, which destroys the standing of everyone
who cited honestly in order to serve one author's regret.
