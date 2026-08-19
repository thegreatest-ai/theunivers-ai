# Hidden Words: the filter that should have shipped before comments did

_Branch: `feat/hidden-words`. Second-engineer seat._

From `Instagram-Complete-Spec.pdf` v2.0 (§8.2), measured live 2026-08-18, and it is the single
strongest recommendation in the document:

> **Ship Hidden Words before you ship comments.** A default-on server-maintained slur filter is the
> single highest-leverage safety feature in a comment system, and it is far cheaper than the
> moderation team you will otherwise need. Instagram made it opt-out. Do the same.

**We shipped comments on 2026-08-16 with no content filter of any kind, and registration is OPEN.**
That is the gap. This closes it.

## What exists to build on — do not invent a parallel system

This repo already has a moderation ladder with a vocabulary, receipts and an ADR. Read before
writing: `shared/moderation-actions.mjs`, `docs/decisions/ADR-0006-takedown-retains-purge-destroys.md`,
and the `limit` rung in `server/index.mjs`.

**A filtered comment is the `limit` rung applied automatically.** Hidden from readers, retained in
full, appealable. It is not a new concept and must not become one.

## THE DECISIONS

**1. Hide, never delete, and never silently drop.** ADR-0006 is the law here: takedown retains,
purge destroys. A filtered comment is stored complete with `hidden_at` and `hidden_reason='filter'`.
Dropping it at the door would destroy the only evidence that the filter fired — and a filter nobody
can audit is a filter nobody can fix.

**2. The commenter still sees their own comment.** This is what Instagram does and the reasoning is
sound: a person told "your comment was hidden" writes it again angrier, from another account. A
person who sees their comment sitting there does not. **This is the one place in this codebase where
a viewer is deliberately shown something others cannot see**, so it must be commented as such, or
someone will "fix" it later.

**3. Default ON, per the spec.** Opt-out, not opt-in. A safety default that must be discovered is
not a safety default. A per-account `filter_comments` flag may turn it off; absent means on.

**4. The list is ours and lives in the repo, not the database.** `shared/hidden-words.mjs`, a plain
exported array, matched case-insensitively on word boundaries against a normalised body. In the repo
because it is code, reviewable in a diff, and deployable without a migration.

**Normalise before matching**, or the filter is theatre: lowercase, strip combining marks, collapse
whitespace, and fold the obvious leetspeak substitutions (`0→o`, `1→i/l`, `3→e`, `4→a`, `$→s`,
`@→a`). Do **not** attempt to be clever beyond that — an over-eager filter that hides ordinary words
is worse than a plain one, because it teaches people the product is broken.

**Word boundaries are mandatory.** The Scunthorpe problem is the canonical failure of exactly this
feature; a substring match will hide innocent words and make the product look stupid. Test it by
name.

## Build

### Shared
- `shared/hidden-words.mjs` — `WORDS` (start small and defensible: slurs and sexual harassment
  terms only, not profanity — the point is safety, not politeness), `normalise(text)`, and
  `matches(text)` returning the matched term or null.

### Server
- `comment.hidden_at`, `comment.hidden_reason` via `ensureColumn`.
- `POST /api/works/:id/comments` runs the filter and stores the hit. **It still returns 200** — the
  commenter must not learn they were filtered.
- `GET /api/works/:id/comments` excludes hidden comments **except for their own author**, in SQL,
  the same way limited posts are excluded. Not in the client.
- `commentCount()` must not count hidden comments for other viewers, or the count betrays what the
  list hides.
- The operator queue gains hidden comments so a human can release a false positive; releasing
  writes a receipt like every other moderation act.
- Per-account `filter_comments` (default 1).

### Client
- Nothing announces the filter to the commenter.
- The owner's Settings gains one switch: **Hide offensive comments**, on by default, with a sentence
  saying what it does.

## Tests
- A comment containing a listed term is stored, is `hidden_at`, and is absent from another
  viewer's list — and present in the author's own.
- The count matches the list each viewer sees.
- **The Scunthorpe test, by name**: an innocent word containing a listed term as a substring is NOT
  hidden.
- Leetspeak folding catches an obvious evasion.
- A clean comment is untouched.
- With `filter_comments` off, nothing is hidden.
- The API response is byte-identical whether or not the comment was filtered.

## Done
`npm run build && npm test` green, rules tested, commit in the house style. Do not deploy.

## Amended by `docs/specs/APPEAL.md`

Decision 2 still holds for **POST**: 200, byte-identical, no toast. The author learns a limit
happened from a receipt on their chain (ADR-0007 §4) and may contest it. GET may mark `hidden` /
`appealed` on the author's own hidden comments only — never a client-side filter of other people's
rows, never a public badge.
