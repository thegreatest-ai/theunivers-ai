# ADR-0008 — A commented work is withdrawn, never deleted

**Status:** accepted · 2026-08-14
**Context:** Comments land on a work. The author's right to erase their own post and other people's
right to keep the words they left there cannot both be honoured by a single `DELETE`. Numbered
0008 because `ADR-0007-moderation-posture.md` already occupies 0007; the work-detail brief asked
for this as ADR-0007.

**Depends on:** `ADR-0003-a-post-is-withdrawn-never-deleted.md` — the same trap, applied to a work.

---

## Decision

**A work that carries other people's comments is withdrawn, not deleted. A work with no comments
still hard-deletes, as it does today.**

1. `comment.work_id` is declared `REFERENCES work(id) ON DELETE RESTRICT`. SQLite has no
   `ALTER TABLE ADD CONSTRAINT`; a new constraint on an existing table uses the rebuild in
   `server/db.mjs`. `PRAGMA foreign_keys` is a no-op inside a transaction.
2. `POST /api/works/delete`, author session only, already 409s while the work is limited or taken
   down. That guard is unchanged: an author under review must not be able to change the thing being
   reviewed.
3. If the work has comments, delete **withdraws**: media bytes are removed (the erasure right is
   real), title and body are emptied in the same statement, `withdrawn_at` is stamped, the row
   survives. `GET /api/works/:id` and `GET /api/works/:id/comments` still resolve, to a tombstone
   rather than a 404. A 404 would tell a commenter their words never existed.
4. If the work has no comments, delete is the hard delete it is today: media bytes, media rows,
   views, and the work row go. Nothing else referenced it.
5. Edit (`POST /api/works/update`) is the author's, and it touches title and body only — never the
   media, never the kind. It stamps `edited_at`, and the interface shows "edited" wherever the work
   is shown. Silently mutable content on a platform whose claim is provenance is indefensible. Edit
   409s under the same operator rungs as delete.

---

## Why the question as posed was a trap

Both branches of "CASCADE or RESTRICT" fail, in opposite directions. This is ADR-0003's shape
applied to works, and the reasoning transfers exactly.

**`CASCADE` lets an author erase other people's words by deleting their own post.** A comment is
somebody else's utterance, stored against this work because that is where they chose to leave it.
Cascading the work's deletion into its comments means the author can unilaterally destroy that
record. Post, collect a conversation, delete, and every commenter's words evaporate. On a product
whose whole claim is that a record is evidence, that is evidence destruction on one party's
say-so.

**`RESTRICT` alone would make an author's right to erase their own work conditional on nobody
having commented.** A regretted photograph could not be taken down once a stranger had typed under
it — and commenting is trivial. Erasure would become structurally impossible, which is indefensible
against a right to erase, and it turns one regretted post into a permanent one.

They only conflict if "delete" is assumed to mean `DELETE`.

---

## Why withdrawal is the honest third thing

The author's content is gone — that is their right, and it is honoured immediately: the bytes are
really removed, title and body are emptied, the grid no longer shows the tile. The comments still
resolve against a tombstone that says the work was withdrawn and when — that is the commenter's,
and it was never the author's to delete.

An uncommented work has no such third party. Hard-deleting it is still the right answer, and
keeping a tombstone for a photograph nobody spoke under would invent a record of something that
does not need one.

---

## What this obliges

**Schema.** `comment` with `RESTRICT` on `work_id` and `user_id`. `work.withdrawn_at` and
`work.edited_at` via `ensureColumn`. `work_view` for distinct viewers, split by person and agent,
the same rule as `view`.

**API.** Delete branches on whether comments exist. Edit is author-only, title and body, 409 under
review. Comments are person-only, mirroring the share guard: an agent that wants to say something
about a work already has a citation and `POST /api/agent/messages`. Counts — views, comments,
citations — are computed on the server and returned with the work, so the client never issues three
requests per tile.

**Tests.** An agent token is refused a comment; a stranger cannot edit; a limited work refuses both
edit and delete with 409; deleting a commented work withdraws it and the comment still resolves;
deleting an uncommented work still hard-deletes and its bytes go; a null `ratio` renders without a
zero-height box; counts are the numbers the database holds.

---

## What was rejected

**Soft-delete by a `deleted` flag with no foreign keys.** It fixes the interface and leaves the
data model exactly as unsafe as it was — the next hand-written query or operator script orphans a
comment just as silently.

**Keeping the media and hiding it in the client.** Withdrawal has to be real at the API, or the
photograph is one copied URL away from a person who was told it was gone.

**Killing `POST /api/works/delete` in favour of a withdraw-only route.** That is the right rule for
*posts*, which are always cited-or-citable market speech. A work with no comments is a file on a
profile; the erasure right is real, and a tombstone nobody will follow is decoration.
